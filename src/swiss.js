export const DEFAULT_CONFIG = Object.freeze({
  entrantCount: 16,
  winsToQualify: 3,
  lossesToEliminate: 3,
  maxSwissRounds: 5,
  knockoutFormat: "15 分三局两胜",
});

export const MATCH_RULES = Object.freeze({
  swiss: Object.freeze({
    label: "21 分一局定胜负",
    targetPoints: 21,
    bestOf: 1,
  }),
  swissDecider: Object.freeze({
    label: "31 分生死战 · 一局定胜负",
    targetPoints: 31,
    bestOf: 1,
  }),
  knockout: Object.freeze({
    label: "每局 15 分 · 三局两胜",
    targetPoints: 15,
    bestOf: 3,
  }),
});

export function createTournament(options) {
  const names = options.names.map((name) => name.trim());
  const affiliations = (options.affiliations || names.map(() => "")).map(
    (value) => value.trim(),
  );

  validateEntrants(names);

  const tournament = {
    version: 2,
    id: makeId("event"),
    eventName: options.eventName?.trim() || "Zoo 瑞士轮",
    entrantType: options.entrantType || "单打",
    seed: options.seed?.trim() || new Date().toISOString().slice(0, 10),
    phase: "swiss",
    config: { ...DEFAULT_CONFIG },
    participants: names.map((name, index) => ({
      id: `p-${index + 1}`,
      name,
      affiliation: affiliations[index] || "",
      seed: index + 1,
      wins: 0,
      losses: 0,
      opponents: [],
      status: "active",
    })),
    rounds: [],
    knockout: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  tournament.rounds.push(buildSwissRound(tournament));
  return tournament;
}

export function buildSwissRound(tournament) {
  const roundNumber = tournament.rounds.length + 1;
  const active = tournament.participants.filter(
    (participant) => participant.status === "active",
  );

  if (active.length === 0) {
    throw new Error("瑞士轮已经结束，没有可继续配对的参赛单位。");
  }
  if (active.length % 2 !== 0) {
    throw new Error("当前参赛单位为奇数，16 人版本不应出现轮空。");
  }
  if (roundNumber > tournament.config.maxSwissRounds) {
    throw new Error("已达到瑞士轮最大轮数。");
  }

  const pairs =
    roundNumber === 1
      ? firstRoundPairs(active, tournament.seed)
      : optimalSwissPairs(active, tournament.seed, roundNumber);

  return {
    type: "swiss",
    number: roundNumber,
    name: `瑞士轮第 ${roundNumber} 轮`,
    finalized: false,
    warnings: buildSwissWarnings(pairs, roundNumber),
    matches: pairs.map(([a, b], index) => {
      const rule = swissMatchRule(a, b, roundNumber);
      return {
        id: `swiss-r${roundNumber}-m${index + 1}`,
        court: index + 1,
        aId: a.id,
        bId: b.id,
        winnerId: null,
        ...matchScoring(rule),
      };
    }),
  };
}

export function selectWinner(tournament, matchId, winnerId) {
  const currentRound = getCurrentRound(tournament);
  if (!currentRound || currentRound.finalized) {
    throw new Error("当前没有可录入结果的轮次。");
  }

  const match = currentRound.matches.find((item) => item.id === matchId);
  if (!match || ![match.aId, match.bId].includes(winnerId)) {
    throw new Error("比赛或胜者信息无效。");
  }

  match.winnerId = winnerId;
  tournament.updatedAt = new Date().toISOString();
  return tournament;
}

export function updateGameScore(
  tournament,
  matchId,
  gameIndex,
  side,
  value,
) {
  const currentRound = getCurrentRound(tournament);
  if (!currentRound || currentRound.finalized) {
    throw new Error("当前没有可录入比分的轮次。");
  }

  const match = currentRound.matches.find((item) => item.id === matchId);
  if (!match || !["a", "b"].includes(side) || !match.games[gameIndex]) {
    throw new Error("比赛、局数或计分方无效。");
  }

  const numericValue = Number.parseInt(value, 10);
  match.games[gameIndex][side] = Number.isFinite(numericValue)
    ? Math.max(0, numericValue)
    : 0;
  tournament.updatedAt = new Date().toISOString();
  return tournament;
}

export function finalizeCurrentRound(tournament) {
  if (tournament.phase === "swiss") {
    return finalizeSwissRound(tournament);
  }
  if (tournament.phase === "knockout") {
    return finalizeKnockoutRound(tournament);
  }
  throw new Error("赛事已经全部结束。");
}

export function finalizeSwissRound(tournament) {
  const currentRound = tournament.rounds.at(-1);
  validateRoundReady(currentRound);

  currentRound.finalized = true;
  recalculateParticipants(tournament);

  const activeCount = tournament.participants.filter(
    (participant) => participant.status === "active",
  ).length;

  if (activeCount > 0) {
    tournament.rounds.push(buildSwissRound(tournament));
  } else {
    tournament.knockout = buildKnockout(tournament);
    tournament.phase = "knockout";
  }

  tournament.updatedAt = new Date().toISOString();
  return tournament;
}

export function finalizeKnockoutRound(tournament) {
  const currentRound = tournament.knockout?.rounds.at(-1);
  validateRoundReady(currentRound);
  currentRound.finalized = true;

  const winners = currentRound.matches.map((match) => match.winnerId);
  if (currentRound.stage === "quarterfinal") {
    tournament.knockout.rounds.push(
      buildKnockoutRound("semifinal", "半决赛", winners, 2),
    );
  } else if (currentRound.stage === "semifinal") {
    tournament.knockout.rounds.push(
      buildKnockoutRound("final", "决赛", winners, 1),
    );
  } else {
    tournament.knockout.championId = winners[0];
    tournament.phase = "complete";
  }

  tournament.updatedAt = new Date().toISOString();
  return tournament;
}

export function undoLastSettlement(tournament) {
  if (tournament.phase === "complete") {
    tournament.phase = "knockout";
    tournament.knockout.championId = null;
    tournament.knockout.rounds.at(-1).finalized = false;
    tournament.updatedAt = new Date().toISOString();
    return tournament;
  }

  if (tournament.phase === "knockout") {
    const knockoutRounds = tournament.knockout.rounds;
    const currentRound = knockoutRounds.at(-1);

    if (!currentRound.finalized && knockoutRounds.length > 1) {
      knockoutRounds.pop();
      knockoutRounds.at(-1).finalized = false;
    } else if (!currentRound.finalized && knockoutRounds.length === 1) {
      tournament.knockout = null;
      tournament.phase = "swiss";
      tournament.rounds.at(-1).finalized = false;
      recalculateParticipants(tournament);
    } else {
      currentRound.finalized = false;
    }

    tournament.updatedAt = new Date().toISOString();
    return tournament;
  }

  if (tournament.rounds.length === 0) {
    throw new Error("没有可以撤回的轮次。");
  }

  const currentRound = tournament.rounds.at(-1);
  if (!currentRound.finalized && tournament.rounds.length > 1) {
    tournament.rounds.pop();
  }

  const previousRound = tournament.rounds.at(-1);
  if (!previousRound?.finalized) {
    throw new Error("当前轮次尚未结算。");
  }

  previousRound.finalized = false;
  recalculateParticipants(tournament);
  tournament.updatedAt = new Date().toISOString();
  return tournament;
}

export function recalculateParticipants(tournament) {
  for (const participant of tournament.participants) {
    participant.wins = 0;
    participant.losses = 0;
    participant.opponents = [];
    participant.status = "active";
  }

  for (const round of tournament.rounds.filter((item) => item.finalized)) {
    for (const match of round.matches) {
      const a = participantById(tournament, match.aId);
      const b = participantById(tournament, match.bId);
      const winner = participantById(tournament, match.winnerId);
      const loser = winner.id === a.id ? b : a;

      winner.wins += 1;
      loser.losses += 1;
      a.opponents.push(b.id);
      b.opponents.push(a.id);
    }
  }

  for (const participant of tournament.participants) {
    if (participant.wins >= tournament.config.winsToQualify) {
      participant.status = "qualified";
    } else if (participant.losses >= tournament.config.lossesToEliminate) {
      participant.status = "eliminated";
    }
  }
}

export function getStandings(tournament) {
  const swissNetPoints = new Map(
    tournament.participants.map((participant) => [participant.id, 0]),
  );

  for (const round of tournament.rounds.filter((item) => item.finalized)) {
    for (const match of round.matches) {
      const pointDifference = match.games.reduce(
        (sum, game) => sum + game.a - game.b,
        0,
      );
      swissNetPoints.set(
        match.aId,
        (swissNetPoints.get(match.aId) || 0) + pointDifference,
      );
      swissNetPoints.set(
        match.bId,
        (swissNetPoints.get(match.bId) || 0) - pointDifference,
      );
    }
  }

  return tournament.participants
    .map((participant) => ({
      ...participant,
      netPoints: swissNetPoints.get(participant.id) || 0,
    }))
    .sort(
      (a, b) =>
        statusOrder(a.status) - statusOrder(b.status) ||
        b.wins - a.wins ||
        a.losses - b.losses ||
        b.netPoints - a.netPoints ||
        a.seed - b.seed,
    );
}

export function getCurrentRound(tournament) {
  if (tournament.phase === "swiss") return tournament.rounds.at(-1);
  if (tournament.phase === "knockout" || tournament.phase === "complete") {
    return tournament.knockout?.rounds.at(-1) || null;
  }
  return null;
}

export function tournamentIsComplete(tournament) {
  return tournament.phase === "complete";
}

export function swissIsComplete(tournament) {
  return tournament.participants.every(
    (participant) => participant.status !== "active",
  );
}

function buildKnockout(tournament) {
  const qualifiers = tournament.participants.filter(
    (participant) => participant.status === "qualified",
  );
  const undefeated = qualifiers.filter(
    (participant) => participant.wins === 3 && participant.losses === 0,
  );
  const threeTwo = qualifiers.filter(
    (participant) => participant.wins === 3 && participant.losses === 2,
  );
  const remaining = qualifiers.filter(
    (participant) => !undefeated.includes(participant) && !threeTwo.includes(participant),
  );

  if (qualifiers.length !== 8 || undefeated.length !== 2 || threeTwo.length !== 3) {
    throw new Error("晋级战绩分布异常，无法按视频规则生成淘汰赛。");
  }

  const random = seededRandom(`${tournament.seed}:knockout-draw`);
  const topSeeds = shuffle(undefeated, random);
  const bottomSeeds = shuffle(threeTwo, random);
  const protectedPairs = [
    [topSeeds[0], bottomSeeds[0]],
    [topSeeds[1], bottomSeeds[1]],
  ];
  const openDraw = shuffle([...remaining, bottomSeeds[2]], random);
  const openPairs = [
    [openDraw[0], openDraw[1]],
    [openDraw[2], openDraw[3]],
  ];
  const quarterfinalPairs = shuffle([...protectedPairs, ...openPairs], random);

  return {
    format: tournament.config.knockoutFormat,
    championId: null,
    rounds: [
      {
        type: "knockout",
        stage: "quarterfinal",
        name: "四分之一决赛",
        number: 1,
        finalized: false,
        warnings: [],
        matches: quarterfinalPairs.map(([a, b], index) => ({
          id: `knockout-qf-m${index + 1}`,
          court: index + 1,
          aId: a.id,
          bId: b.id,
          winnerId: null,
          ...matchScoring(MATCH_RULES.knockout),
        })),
      },
    ],
  };
}

function buildKnockoutRound(stage, name, participantIds, matchCount) {
  const matches = [];
  for (let index = 0; index < matchCount; index += 1) {
    matches.push({
      id: `knockout-${stage}-m${index + 1}`,
      court: index + 1,
      aId: participantIds[index * 2],
      bId: participantIds[index * 2 + 1],
      winnerId: null,
      ...matchScoring(MATCH_RULES.knockout),
    });
  }

  return {
    type: "knockout",
    stage,
    name,
    number: stage === "semifinal" ? 2 : 3,
    finalized: false,
    warnings: [],
    matches,
  };
}

function firstRoundPairs(participants, seed) {
  const random = seededRandom(`${seed}:swiss-round-1`);
  const tieBreaks = buildTieBreaks(participants.length, random);

  return solveOptimalPairs(participants, (a, b, aIndex, bIndex) => {
    const sameAffiliation =
      a.affiliation &&
      b.affiliation &&
      normalized(a.affiliation) === normalized(b.affiliation);
    return (sameAffiliation ? 1_000_000 : 0) + tieBreaks[aIndex][bIndex];
  });
}

function optimalSwissPairs(participants, seed, roundNumber) {
  const ordered = [...participants].sort(
    (a, b) =>
      b.wins - a.wins ||
      a.losses - b.losses ||
      a.seed - b.seed,
  );
  const random = seededRandom(`${seed}:swiss-round-${roundNumber}`);
  const tieBreaks = buildTieBreaks(ordered.length, random);

  return solveOptimalPairs(ordered, (a, b, aIndex, bIndex) => {
    const scoreGap =
      Math.abs(a.wins - b.wins) + Math.abs(a.losses - b.losses);
    const repeated = a.opponents.includes(b.id);
    return (
      scoreGap * 10_000 +
      (repeated ? 1_000_000 : 0) +
      tieBreaks[aIndex][bIndex]
    );
  });
}

function solveOptimalPairs(participants, pairCost) {
  const fullMask = (1 << participants.length) - 1;
  const memo = new Map();

  function solve(mask) {
    if (mask === 0) return { cost: 0, pairs: [] };
    if (memo.has(mask)) return memo.get(mask);

    let first = 0;
    while ((mask & (1 << first)) === 0) first += 1;
    const withoutFirst = mask & ~(1 << first);
    let best = { cost: Number.POSITIVE_INFINITY, pairs: [] };

    for (let second = first + 1; second < participants.length; second += 1) {
      if ((withoutFirst & (1 << second)) === 0) continue;

      const remainder = solve(withoutFirst & ~(1 << second));
      const totalCost =
        pairCost(
          participants[first],
          participants[second],
          first,
          second,
        ) + remainder.cost;

      if (totalCost < best.cost) {
        best = {
          cost: totalCost,
          pairs: [
            [participants[first], participants[second]],
            ...remainder.pairs,
          ],
        };
      }
    }

    memo.set(mask, best);
    return best;
  }

  return solve(fullMask).pairs;
}

function swissMatchRule(a, b, roundNumber) {
  if (roundNumber <= 2) return MATCH_RULES.swiss;
  const isAdvancementOrEliminationMatch = [a, b].some(
    (participant) => participant.wins === 2 || participant.losses === 2,
  );
  return isAdvancementOrEliminationMatch
    ? MATCH_RULES.swissDecider
    : MATCH_RULES.swiss;
}

function matchScoring(rule) {
  return {
    format: rule.label,
    targetPoints: rule.targetPoints,
    bestOf: rule.bestOf,
    games: Array.from({ length: rule.bestOf }, () => ({ a: 0, b: 0 })),
  };
}

function buildSwissWarnings(pairs, roundNumber) {
  const warnings = [];
  if (pairs.some(([a, b]) => a.opponents.includes(b.id))) {
    warnings.push("无法完全避免重复交手，已采用重复场次最少的配对。");
  }
  if (
    roundNumber === 1 &&
    pairs.some(
      ([a, b]) =>
        a.affiliation &&
        b.affiliation &&
        normalized(a.affiliation) === normalized(b.affiliation),
    )
  ) {
    warnings.push("无法完全避免同俱乐部或同小组首轮相遇。");
  }
  return warnings;
}

function validateEntrants(names) {
  if (names.length !== DEFAULT_CONFIG.entrantCount) {
    throw new Error(`当前版本固定需要 ${DEFAULT_CONFIG.entrantCount} 个参赛单位。`);
  }
  if (names.some((name) => !name)) {
    throw new Error("参赛单位名称不能为空。");
  }
  if (new Set(names).size !== names.length) {
    throw new Error("参赛单位名称不能重复。");
  }
}

function validateRoundReady(round) {
  if (!round || round.finalized) {
    throw new Error("当前轮次已经结算。");
  }
  if (round.matches.some((match) => !match.winnerId)) {
    throw new Error("请先录入本轮所有比赛结果。");
  }
}

function buildTieBreaks(size, random) {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => Math.floor(random() * 10_000)),
  );
}

function shuffle(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function seededRandom(seed) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return () => {
    hash += 0x6d2b79f5;
    let value = hash;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function participantById(tournament, id) {
  const participant = tournament.participants.find((item) => item.id === id);
  if (!participant) throw new Error(`找不到参赛单位：${id}`);
  return participant;
}

function normalized(value) {
  return value.trim().toLocaleLowerCase();
}

function statusOrder(status) {
  return { qualified: 0, active: 1, eliminated: 2 }[status] ?? 3;
}

function makeId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
