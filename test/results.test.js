import test from "node:test";
import assert from "node:assert/strict";

import {
  createTournament,
  finalizeCurrentRound,
  getCurrentRound,
  getStandings,
  selectWinner,
  updateGameScore,
} from "../src/swiss.js";
import {
  buildResultsCsv,
  getFinalPlacements,
  getKnockoutBracket,
  getPerformanceStats,
  getScoringLeaders,
} from "../src/results.js";

function completedTournament(entrantCount = 16) {
  const tournament = createTournament({
    entrantCount,
    eventName: "结果导出测试赛",
    entrantType: "双打",
    seed: `results-test-${entrantCount}`,
    names: Array.from({ length: entrantCount }, (_, index) => `组合 ${index + 1}`),
    affiliations: Array.from(
      { length: entrantCount },
      (_, index) => `俱乐部 ${index + 1}`,
    ),
  });

  while (tournament.phase !== "complete") {
    const round = getCurrentRound(tournament);
    for (const match of round.matches) {
      match.games.forEach((game, gameIndex) => {
        updateGameScore(
          tournament,
          match.id,
          gameIndex,
          "a",
          match.targetPoints,
        );
        updateGameScore(
          tournament,
          match.id,
          gameIndex,
          "b",
          match.targetPoints - 5,
        );
      });
      selectWinner(tournament, match.id, match.aId);
    }
    finalizeCurrentRound(tournament);
  }
  return tournament;
}

test("final placements contain one champion, one runner-up and tied semifinalists", () => {
  const tournament = completedTournament();
  const placements = getFinalPlacements(tournament, getStandings(tournament));

  assert.equal(placements.length, 16);
  assert.equal(placements.filter((item) => item.rank === 1).length, 1);
  assert.equal(placements.filter((item) => item.rank === 2).length, 1);
  assert.equal(placements.filter((item) => item.rank === 3).length, 2);
  assert.equal(placements.filter((item) => item.rank === 5).length, 4);
  assert.equal(new Set(placements.map((item) => item.participant.id)).size, 16);
});

test("CSV export includes a BOM, final placements and complete match results", () => {
  const tournament = completedTournament();
  const csv = buildResultsCsv(tournament, getStandings(tournament));

  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"最终名次"/);
  assert.match(csv, /"完整赛果"/);
  assert.match(csv, /"冠军"/);
  assert.match(csv, /"得分王"/);
  assert.match(csv, /"淘汰赛战绩"/);
  assert.match(csv, /"总战绩"/);
  assert.match(csv, /"总净胜分"/);
  assert.doesNotMatch(csv, /"对手分"/);
  assert.match(csv, /"决赛"/);
  assert.match(csv, /"结果导出测试赛"/);
});

test("performance separates Swiss, knockout and total records", () => {
  const tournament = completedTournament();
  const stats = getPerformanceStats(tournament);
  const champion = stats.find(
    (item) => item.participant.id === tournament.knockout.championId,
  );

  assert.deepEqual(
    [champion.swissWins, champion.swissLosses],
    [champion.participant.wins, champion.participant.losses],
  );
  assert.deepEqual(
    [champion.knockoutWins, champion.knockoutLosses],
    [3, 0],
  );
  assert.equal(
    champion.totalWins,
    champion.swissWins + champion.knockoutWins,
  );
  assert.equal(
    champion.totalLosses,
    champion.swissLosses + champion.knockoutLosses,
  );
  assert.equal(
    champion.totalNetPoints,
    champion.swissNetPoints + champion.knockoutNetPoints,
  );
});

test("scoring leaders are selected only from the final eight by total net points", () => {
  const tournament = completedTournament();
  const leaders = getScoringLeaders(tournament);
  const qualifierIds = new Set(
    tournament.participants
      .filter((participant) => participant.status === "qualified")
      .map((participant) => participant.id),
  );
  const qualifierStats = getPerformanceStats(tournament).filter((item) =>
    qualifierIds.has(item.participant.id),
  );
  const maximum = Math.max(
    ...qualifierStats.map((item) => item.totalNetPoints),
  );

  assert.ok(leaders.length >= 1);
  assert.ok(leaders.every((item) => qualifierIds.has(item.participant.id)));
  assert.ok(leaders.every((item) => item.totalNetPoints === maximum));
});

test("knockout bracket preserves the 8-to-4-to-2-to-1 progression", () => {
  const tournament = completedTournament();
  const bracket = getKnockoutBracket(tournament);

  assert.ok(bracket);
  assert.equal(bracket.quarterfinalists.length, 8);
  assert.equal(bracket.semifinalists.length, 4);
  assert.equal(bracket.finalists.length, 2);
  assert.equal(bracket.champion.participant.id, tournament.knockout.championId);
  assert.ok(bracket.champion.score);
  assert.equal(
    new Set(bracket.quarterfinalists.map((item) => item.participant.id)).size,
    8,
  );
  assert.deepEqual(
    bracket.semifinalists.map((item) => item.participant.id),
    tournament.knockout.rounds[0].matches.map((match) => match.winnerId),
  );
  assert.deepEqual(
    bracket.finalists.map((item) => item.participant.id),
    tournament.knockout.rounds[1].matches.map((match) => match.winnerId),
  );
});

test("8 entrant results contain eight placements and final seeding labels", () => {
  const tournament = completedTournament(8);
  const placements = getFinalPlacements(tournament, getStandings(tournament));
  const bracket = getKnockoutBracket(tournament);

  assert.equal(placements.length, 8);
  assert.deepEqual(
    bracket.quarterfinalists.map((entry) => entry.seed).sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.equal(bracket.champion.participant.id, tournament.knockout.championId);
});
