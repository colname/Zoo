import test from "node:test";
import assert from "node:assert/strict";

import {
  createTournament,
  finalizeCurrentRound,
  getCurrentRound,
  selectWinner,
  tournamentIsComplete,
  undoLastSettlement,
  updateGameScore,
} from "../src/swiss.js";

function makeTournament() {
  return createTournament({
    eventName: "测试赛",
    entrantType: "单打",
    seed: "zoo-test",
    names: Array.from({ length: 16 }, (_, index) => `选手 ${index + 1}`),
    affiliations: Array.from(
      { length: 16 },
      (_, index) => `俱乐部 ${Math.floor(index / 2) + 1}`,
    ),
  });
}

function chooseAllWinners(tournament, side = "a") {
  const round = getCurrentRound(tournament);
  for (const match of round.matches) {
    selectWinner(
      tournament,
      match.id,
      side === "a" ? match.aId : match.bId,
    );
  }
  finalizeCurrentRound(tournament);
}

function completeSwiss(tournament) {
  while (tournament.phase === "swiss") {
    chooseAllWinners(tournament);
  }
}

test("first round avoids same-club pairings when a valid draw exists", () => {
  const tournament = makeTournament();
  const byId = new Map(tournament.participants.map((item) => [item.id, item]));

  assert.equal(tournament.rounds[0].matches.length, 8);
  for (const match of tournament.rounds[0].matches) {
    assert.notEqual(
      byId.get(match.aId).affiliation,
      byId.get(match.bId).affiliation,
    );
  }
});

test("uses 21-point BO1 normally and 31-point BO1 for decider matches", () => {
  const tournament = makeTournament();

  assert.ok(
    tournament.rounds[0].matches.every(
      (match) =>
        match.targetPoints === 21 &&
        match.bestOf === 1 &&
        match.games.length === 1,
    ),
  );

  chooseAllWinners(tournament);
  assert.ok(
    getCurrentRound(tournament).matches.every(
      (match) => match.targetPoints === 21 && match.bestOf === 1,
    ),
  );

  chooseAllWinners(tournament);
  const thirdRound = getCurrentRound(tournament);
  const byId = new Map(tournament.participants.map((item) => [item.id, item]));

  for (const match of thirdRound.matches) {
    const a = byId.get(match.aId);
    const b = byId.get(match.bId);
    const isDecider = [a, b].some(
      (participant) => participant.wins === 2 || participant.losses === 2,
    );
    assert.equal(match.targetPoints, isDecider ? 31 : 21);
    assert.equal(match.bestOf, 1);
  }
});

test("accepts arbitrary scores and only requires a selected winner to settle", () => {
  const tournament = makeTournament();
  const round = getCurrentRound(tournament);
  const firstMatch = round.matches[0];

  updateGameScore(tournament, firstMatch.id, 0, "a", 7);
  updateGameScore(tournament, firstMatch.id, 0, "b", 4);
  for (const match of round.matches) {
    selectWinner(tournament, match.id, match.aId);
  }

  assert.doesNotThrow(() => finalizeCurrentRound(tournament));
  assert.deepEqual(tournament.rounds[0].matches[0].games[0], { a: 7, b: 4 });
});

test("Swiss completion creates eight quarterfinalists with protected 3-0 draws", () => {
  const tournament = makeTournament();
  completeSwiss(tournament);

  assert.equal(tournament.phase, "knockout");
  assert.ok(tournament.rounds.length <= 5);
  assert.equal(
    tournament.participants.filter((item) => item.status === "qualified").length,
    8,
  );
  assert.equal(
    tournament.participants.filter((item) => item.status === "eliminated").length,
    8,
  );

  const byId = new Map(tournament.participants.map((item) => [item.id, item]));
  const quarterfinal = getCurrentRound(tournament);
  const protectedPairCount = quarterfinal.matches.filter((match) => {
    const records = [byId.get(match.aId), byId.get(match.bId)].map(
      (item) => `${item.wins}-${item.losses}`,
    );
    return records.includes("3-0") && records.includes("3-2");
  }).length;

  assert.equal(protectedPairCount, 2);
});

test("knockout uses 15-point BO3 and produces one champion", () => {
  const tournament = makeTournament();
  completeSwiss(tournament);

  while (!tournamentIsComplete(tournament)) {
    const round = getCurrentRound(tournament);
    assert.ok(
      round.matches.every(
        (match) =>
          match.targetPoints === 15 &&
          match.bestOf === 3 &&
          match.games.length === 3,
      ),
    );
    chooseAllWinners(tournament);
  }

  assert.equal(tournament.phase, "complete");
  assert.ok(tournament.knockout.championId);
  assert.equal(tournament.knockout.rounds.length, 3);
});

test("undo can return from quarterfinals to the final Swiss round", () => {
  const tournament = makeTournament();
  completeSwiss(tournament);

  undoLastSettlement(tournament);

  assert.equal(tournament.phase, "swiss");
  assert.equal(tournament.knockout, null);
  assert.equal(tournament.rounds.at(-1).finalized, false);
});
