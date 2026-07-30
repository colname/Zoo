export function getFinalPlacements(tournament, standings) {
  if (tournament.phase !== "complete" || !tournament.knockout?.championId) {
    return [];
  }

  const participantMap = new Map(
    tournament.participants.map((participant) => [participant.id, participant]),
  );
  const roundMap = new Map(
    tournament.knockout.rounds.map((round) => [round.stage, round]),
  );
  const finalMatch = roundMap.get("final")?.matches[0];
  const semifinal = roundMap.get("semifinal");
  const quarterfinal = roundMap.get("quarterfinal");

  const championId = tournament.knockout.championId;
  const runnerUpId = opponentId(finalMatch, championId);
  const semifinalistIds = losersFromRound(semifinal);
  const quarterfinalistIds = losersFromRound(quarterfinal);
  const knockoutIds = new Set([
    championId,
    runnerUpId,
    ...semifinalistIds,
    ...quarterfinalistIds,
  ]);

  const placements = [
    makePlacement(participantMap, championId, 1, "1", "冠军"),
    makePlacement(participantMap, runnerUpId, 2, "2", "亚军"),
    ...semifinalistIds.map((id) =>
      makePlacement(participantMap, id, 3, "3", "并列季军"),
    ),
    ...quarterfinalistIds.map((id) =>
      makePlacement(participantMap, id, 5, "5", "八强"),
    ),
  ].filter(Boolean);

  const standingIndex = new Map(
    standings.map((participant, index) => [participant.id, index + 1]),
  );
  const swissOnly = standings
    .filter((participant) => !knockoutIds.has(participant.id))
    .map((participant, index) => ({
      participant,
      rank: 9 + index,
      rankText: `${9 + index}`,
      label: `瑞士轮第 ${standingIndex.get(participant.id)} 名`,
      stage: "瑞士轮",
    }));

  return [...placements, ...swissOnly];
}

export function getPerformanceStats(tournament) {
  const stats = new Map(
    tournament.participants.map((participant) => [
      participant.id,
      {
        participant,
        swissWins: 0,
        swissLosses: 0,
        knockoutWins: 0,
        knockoutLosses: 0,
        swissNetPoints: 0,
        knockoutNetPoints: 0,
      },
    ]),
  );

  for (const round of allRounds(tournament)) {
    for (const match of round.matches) {
      if (!match.winnerId) continue;
      const aStats = stats.get(match.aId);
      const bStats = stats.get(match.bId);
      const winnerStats = stats.get(match.winnerId);
      const loserStats = match.winnerId === match.aId ? bStats : aStats;
      const prefix = round.type === "knockout" ? "knockout" : "swiss";
      winnerStats[`${prefix}Wins`] += 1;
      loserStats[`${prefix}Losses`] += 1;

      const difference = match.games.reduce(
        (sum, game) => sum + game.a - game.b,
        0,
      );
      aStats[`${prefix}NetPoints`] += difference;
      bStats[`${prefix}NetPoints`] -= difference;
    }
  }

  return [...stats.values()].map((item) => ({
    ...item,
    totalWins: item.swissWins + item.knockoutWins,
    totalLosses: item.swissLosses + item.knockoutLosses,
    totalNetPoints: item.swissNetPoints + item.knockoutNetPoints,
  }));
}

export function getScoringLeaders(tournament) {
  if (tournament.phase !== "complete") return [];
  const qualifierIds = new Set(
    tournament.participants
      .filter((participant) => participant.status === "qualified")
      .map((participant) => participant.id),
  );
  const qualifierStats = getPerformanceStats(tournament).filter((item) =>
    qualifierIds.has(item.participant.id),
  );
  const topNetPoints = Math.max(
    ...qualifierStats.map((item) => item.totalNetPoints),
  );
  return qualifierStats.filter((item) => item.totalNetPoints === topNetPoints);
}

export function getKnockoutBracket(tournament) {
  if (tournament.phase !== "complete" || !tournament.knockout?.championId) {
    return null;
  }

  const participantMap = new Map(
    tournament.participants.map((participant) => [participant.id, participant]),
  );
  const roundMap = new Map(
    tournament.knockout.rounds.map((round) => [round.stage, round]),
  );
  const quarterfinal = roundMap.get("quarterfinal");
  const semifinal = roundMap.get("semifinal");
  const finalMatch = roundMap.get("final")?.matches[0];
  const knockoutSeedMap = new Map(
    (tournament.knockout.seedOrder || []).map((participantId, index) => [
      participantId,
      index + 1,
    ]),
  );

  if (
    quarterfinal?.matches.length !== 4 ||
    semifinal?.matches.length !== 2 ||
    !finalMatch
  ) {
    return null;
  }

  const makeEntry = (participantId, sourceMatch = null) => ({
    participant: participantMap.get(participantId),
    seed:
      knockoutSeedMap.get(participantId) ||
      participantMap.get(participantId)?.seed,
    score: sourceMatch ? scoreText(sourceMatch) : "",
  });

  return {
    championId: tournament.knockout.championId,
    champion: makeEntry(tournament.knockout.championId, finalMatch),
    finalists: [finalMatch.aId, finalMatch.bId].map((participantId, index) =>
      makeEntry(participantId, semifinal.matches[index]),
    ),
    semifinalists: semifinal.matches
      .flatMap((match) => [match.aId, match.bId])
      .map((participantId, index) =>
        makeEntry(participantId, quarterfinal.matches[index]),
      ),
    quarterfinalists: quarterfinal.matches.flatMap((match) => [
      makeEntry(match.aId),
      makeEntry(match.bId),
    ]),
  };
}

export function buildResultsCsv(tournament, standings) {
  const placements = getFinalPlacements(tournament, standings);
  const performance = getPerformanceStats(tournament);
  const performanceMap = new Map(
    performance.map((item) => [item.participant.id, item]),
  );
  const scoringLeaderIds = new Set(
    getScoringLeaders(tournament).map((item) => item.participant.id),
  );
  const participantMap = new Map(
    tournament.participants.map((participant) => [participant.id, participant]),
  );
  const lines = [
    ["Zoo 赛事结果"],
    ["赛事名称", tournament.eventName],
    ["参赛类型", tournament.entrantType],
    ["比赛状态", tournament.phase === "complete" ? "已完赛" : "进行中"],
    ["更新时间", formatDateTime(tournament.updatedAt)],
    [],
    [tournament.phase === "complete" ? "最终名次" : "当前排名"],
    [
      "名次",
      "成绩",
      "额外荣誉",
      "参赛单位",
      "俱乐部/小组",
      "瑞士轮战绩",
      "淘汰赛战绩",
      "总战绩",
      "瑞士轮净胜分",
      "淘汰赛净胜分",
      "总净胜分",
    ],
  ];

  if (placements.length > 0) {
    for (const placement of placements) {
      const stats = performanceMap.get(placement.participant.id);
      lines.push([
        placement.rankText,
        placement.label,
        scoringLeaderIds.has(placement.participant.id) ? "得分王" : "",
        placement.participant.name,
        placement.participant.affiliation,
        recordText(stats.swissWins, stats.swissLosses),
        recordText(stats.knockoutWins, stats.knockoutLosses),
        recordText(stats.totalWins, stats.totalLosses),
        signedNumber(stats.swissNetPoints),
        signedNumber(stats.knockoutNetPoints),
        signedNumber(stats.totalNetPoints),
      ]);
    }
  } else {
    standings.forEach((participant, index) => {
      const stats = performanceMap.get(participant.id);
      lines.push([
        index + 1,
        statusLabel(participant.status, tournament.config.swissMode),
        "",
        participant.name,
        participant.affiliation,
        recordText(stats.swissWins, stats.swissLosses),
        recordText(stats.knockoutWins, stats.knockoutLosses),
        recordText(stats.totalWins, stats.totalLosses),
        signedNumber(stats.swissNetPoints),
        signedNumber(stats.knockoutNetPoints),
        signedNumber(stats.totalNetPoints),
      ]);
    });
  }

  const scoringLeaders = getScoringLeaders(tournament);
  if (scoringLeaders.length > 0) {
    lines.push(
      [],
      ["得分王"],
      ["参赛单位", "总净胜分"],
      ...scoringLeaders.map((item) => [
        item.participant.name,
        signedNumber(item.totalNetPoints),
      ]),
    );
  }

  lines.push(
    [],
    ["完整赛果"],
    [
      "阶段",
      "场地",
      "A 方",
      "A 方俱乐部/小组",
      "比分",
      "B 方",
      "B 方俱乐部/小组",
      "胜者",
      "赛制",
    ],
  );

  for (const round of allRounds(tournament)) {
    for (const match of round.matches) {
      const a = participantMap.get(match.aId);
      const b = participantMap.get(match.bId);
      const winner = participantMap.get(match.winnerId);
      lines.push([
        round.name,
        match.court,
        a?.name ?? "",
        a?.affiliation ?? "",
        scoreText(match),
        b?.name ?? "",
        b?.affiliation ?? "",
        winner?.name ?? "",
        match.format,
      ]);
    }
  }

  return `\uFEFF${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}`;
}

export function scoreText(match) {
  const playedGames = match.games.filter((game) => game.a !== 0 || game.b !== 0);
  if (playedGames.length === 0) return "未记录";
  return playedGames.map((game) => `${game.a}-${game.b}`).join(" / ");
}

export function recordText(wins, losses) {
  return `${wins}-${losses}`;
}

export function signedNumber(value) {
  if (value > 0) return `+${value}`;
  return `${value}`;
}

function makePlacement(participantMap, id, rank, rankText, label) {
  const participant = participantMap.get(id);
  if (!participant) return null;
  return { participant, rank, rankText, label, stage: label };
}

function losersFromRound(round) {
  if (!round) return [];
  return round.matches
    .map((match) => opponentId(match, match.winnerId))
    .filter(Boolean);
}

function opponentId(match, participantId) {
  if (!match || !participantId) return null;
  return match.aId === participantId ? match.bId : match.aId;
}

function allRounds(tournament) {
  return [...tournament.rounds, ...(tournament.knockout?.rounds || [])];
}

function statusLabel(status, swissMode) {
  return {
    active: swissMode === "seeding" ? "排种中" : "比赛中",
    qualified: "已晋级",
    eliminated: "已淘汰",
  }[status] ?? status;
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}
