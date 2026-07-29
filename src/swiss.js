export const DEFAULT_CONFIG = Object.freeze({
  entrantCount: 16,
  winsToQualify: 3,
  lossesToEliminate: 3,
  maxRounds: 5,
});

export const DEFAULT_ROUND_FORMATS = Object.freeze([
  "一局定胜负",
  "一局定胜负",
  "一局定胜负",
  "三局两胜",
  "三局两胜",
]);

export function createTournament(options) {
  const names = options.names.map((name) => name.trim());
  const uniqueNames = new Set(names);

  if (names.length !== DEFAULT_CONFIG.entrantCount) {
    throw new Error(`首版固定需要 ${DEFAULT_CONFIG.entrantCount} 个参赛单位。`);
  }
  if (names.some((name) => !name)) {
    throw new Error("参赛单位名称不能为空。");
  }
  if (uniqueNames.size !== names.length) {
    throw new Error("参赛单位名称不能重复。");
  }

  const tournament = {
    version: 1,
    id: makeId("event"),
    eventName: options.eventName?.trim() || "Zoo 瑞士轮",
    entrantType: options.entrantType || "单打",
    seed: options.seed?.trim() || new Date().toISOString().slice(0, 10),
    config: { ...DEFAULT_CONFIG },
    roundFormats:
      options.roundFormats?.length === DEFAULT_CONFIG.maxRounds
        ? [...options.roundFormats]
        : [...DEFAULT_ROUND_FORMATS],
    participants: names.map((name, index) => ({
      id: `p-${index + 1}`,
      name,
      seed: index + 1,
      wins: 0,
      losses: 0,
      opponents: [],
      status: "active",
    })),
    rounds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  tournament.rounds.push(buildRound(tournament));
  return tournament;
}

export function buildRound(tournament) {
  const roundNumber = tournament.rounds.length + 1;
  const active = tournament.participants.filter(
    (participant) => participant.status === "active",
  );

  if (active.length === 0) {
    throw new Error("赛事已经结束，没有可继续配对的参赛单位。");
  }
  if (active.length % 2 !== 0) {
    throw new Error("当前参赛单位为奇数，首版暂不支持轮空。");
  }
  if (roundNumber > tournament.config.maxRounds) {
    throw new Error("已达到赛事最大轮数。");
  }

  const pairs =
    roundNumber === 1
      ? firstRoundPairs(active, tournament.seed)
      : optimalSwissPairs(active, tournament.seed, roundNumber);

  return {
    number: roundNumber,
    format:
      tournament.roundFormats[roundNumber - 1] || DEFAULT_ROUND_FORMATS[0],
    finalized: false,
    warnings: pairs.some(([a, b]) => a.opponents.includes(b.id))
      ? ["本轮无法完全避免重复交手，已采用重复场次最少的配对。"]
      : [],
    matches: pairs.map(([a, b], index) => ({
      id: `r${roundNumber}-m${index + 1}`,
      court: index + 1,
      aId: a.id,
      bId: b.id,
      winnerId: null,
    })),
  };
}

export function selectWinner(tournament, matchId, winnerId) {
  const currentRound = tournament.rounds.at(-1);
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

export function finalizeCurrentRound(tournament) {
  const currentRound = tournament.rounds.at(-1);
  if (!currentRound || currentRound.finalized) {
    throw new Error("当前轮次已经结算。");
  }
  if (currentRound.matches.some((match) => !match.winnerId)) {
    throw new Error("请先录入本轮所有比赛结果。");
  }

  currentRound.finalized = true;
  recalculateParticipants(tournament);

  const activeCount = tournament.participants.filter(
    (participant) => participant.status === "active",
  ).length;
  if (activeCount > 0 && tournament.rounds.length < tournament.config.maxRounds) {
    tournament.rounds.push(buildRound(tournament));
  }

  tournament.updatedAt = new Date().toISOString();
  return tournament;
}

export function undoLastSettlement(tournament) {
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
  const byId = new Map(
    tournament.participants.map((participant) => [participant.id, participant]),
  );

  return tournament.participants
    .map((participant) => ({
      ...participant,
      buchholz: participant.opponents.reduce(
        (sum, opponentId) => sum + (byId.get(opponentId)?.wins || 0),
        0,
      ),
    }))
    .sort(
      (a, b) =>
        statusOrder(a.status) - statusOrder(b.status) ||
        b.wins - a.wins ||
        a.losses - b.losses ||
        b.buchholz - a.buchholz ||
        a.seed - b.seed,
    );
}

export function tournamentIsComplete(tournament) {
  return tournament.participants.every(
    (participant) => participant.status !== "active",
  );
}

function firstRoundPairs(participants, seed) {
  const shuffled = shuffle(participants, seededRandom(`${seed}:round-1`));
  const pairs = [];
  for (let index = 0; index < shuffled.length; index += 2) {
    pairs.push([shuffled[index], shuffled[index + 1]]);
  }
  return pairs;
}

function optimalSwissPairs(participants, seed, roundNumber) {
  const ordered = [...participants].sort(
    (a, b) =>
      b.wins - a.wins ||
      a.losses - b.losses ||
      a.seed - b.seed,
  );
  const random = seededRandom(`${seed}:round-${roundNumber}`);
  const tieBreaks = Array.from({ length: ordered.length }, () =>
    Array.from({ length: ordered.length }, () => Math.floor(random() * 17)),
  );
  const fullMask = (1 << ordered.length) - 1;
  const memo = new Map();

  function solve(mask) {
    if (mask === 0) return { cost: 0, pairs: [] };
    if (memo.has(mask)) return memo.get(mask);

    let first = 0;
    while ((mask & (1 << first)) === 0) first += 1;

    let best = { cost: Number.POSITIVE_INFINITY, pairs: [] };
    const withoutFirst = mask & ~(1 << first);

    for (let second = first + 1; second < ordered.length; second += 1) {
      if ((withoutFirst & (1 << second)) === 0) continue;

      const a = ordered[first];
      const b = ordered[second];
      const scoreGap =
        Math.abs(a.wins - b.wins) + Math.abs(a.losses - b.losses);
      const repeated = a.opponents.includes(b.id);
      const pairCost =
        scoreGap * 10_000 +
        (repeated ? 1_000_000 : 0) +
        Math.abs(first - second) * 10 +
        tieBreaks[first][second];
      const remainder = solve(withoutFirst & ~(1 << second));
      const totalCost = pairCost + remainder.cost;

      if (totalCost < best.cost) {
        best = {
          cost: totalCost,
          pairs: [[a, b], ...remainder.pairs],
        };
      }
    }

    memo.set(mask, best);
    return best;
  }

  return solve(fullMask).pairs;
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

function statusOrder(status) {
  return { qualified: 0, active: 1, eliminated: 2 }[status] ?? 3;
}

function makeId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
