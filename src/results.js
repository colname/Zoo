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

export function buildResultsCsv(tournament, standings) {
  const placements = getFinalPlacements(tournament, standings);
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
    ["名次", "成绩", "参赛单位", "俱乐部/小组", "瑞士轮战绩", "对手分"],
  ];

  if (placements.length > 0) {
    for (const placement of placements) {
      const standing = standings.find(
        (participant) => participant.id === placement.participant.id,
      );
      lines.push([
        placement.rankText,
        placement.label,
        placement.participant.name,
        placement.participant.affiliation,
        `${placement.participant.wins}-${placement.participant.losses}`,
        standing?.buchholz ?? "",
      ]);
    }
  } else {
    standings.forEach((participant, index) => {
      lines.push([
        index + 1,
        statusLabel(participant.status),
        participant.name,
        participant.affiliation,
        `${participant.wins}-${participant.losses}`,
        participant.buchholz,
      ]);
    });
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

function statusLabel(status) {
  return {
    active: "比赛中",
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
