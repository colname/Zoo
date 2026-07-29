import test from "node:test";
import assert from "node:assert/strict";

import {
  createTournament,
  finalizeCurrentRound,
  getCurrentRound,
  getStandings,
  selectWinner,
} from "../src/swiss.js";
import { buildResultsCsv, getFinalPlacements } from "../src/results.js";

function completedTournament() {
  const tournament = createTournament({
    eventName: "结果导出测试赛",
    entrantType: "双打",
    seed: "results-test",
    names: Array.from({ length: 16 }, (_, index) => `组合 ${index + 1}`),
    affiliations: Array.from({ length: 16 }, (_, index) => `俱乐部 ${index + 1}`),
  });

  while (tournament.phase !== "complete") {
    const round = getCurrentRound(tournament);
    for (const match of round.matches) {
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
  assert.match(csv, /"决赛"/);
  assert.match(csv, /"结果导出测试赛"/);
});
