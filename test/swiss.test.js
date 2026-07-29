import test from "node:test";
import assert from "node:assert/strict";

import {
  createTournament,
  finalizeCurrentRound,
  getStandings,
  selectWinner,
  tournamentIsComplete,
  undoLastSettlement,
} from "../src/swiss.js";

function makeTournament() {
  return createTournament({
    eventName: "测试赛",
    entrantType: "单打",
    seed: "zoo-test",
    names: Array.from({ length: 16 }, (_, index) => `选手 ${index + 1}`),
  });
}

function chooseAllWinners(tournament, side = "a") {
  const round = tournament.rounds.at(-1);
  for (const match of round.matches) {
    selectWinner(
      tournament,
      match.id,
      side === "a" ? match.aId : match.bId,
    );
  }
  finalizeCurrentRound(tournament);
}

test("creates eight deterministic first-round matches", () => {
  const first = makeTournament();
  const second = makeTournament();

  assert.equal(first.rounds[0].matches.length, 8);
  assert.deepEqual(first.rounds[0].matches, second.rounds[0].matches);
});

test("second round pairs entrants with identical records and no rematches", () => {
  const tournament = makeTournament();
  const firstRoundPairs = new Set(
    tournament.rounds[0].matches.map((match) =>
      [match.aId, match.bId].sort().join(":"),
    ),
  );

  chooseAllWinners(tournament);

  const round = tournament.rounds.at(-1);
  assert.equal(round.number, 2);
  for (const match of round.matches) {
    const a = tournament.participants.find((item) => item.id === match.aId);
    const b = tournament.participants.find((item) => item.id === match.bId);
    assert.equal(a.wins, b.wins);
    assert.equal(a.losses, b.losses);
    assert.equal(firstRoundPairs.has([a.id, b.id].sort().join(":")), false);
  }
});

test("a full 16-entrant event ends after at most five rounds with eight qualifiers", () => {
  const tournament = makeTournament();

  while (!tournamentIsComplete(tournament)) {
    chooseAllWinners(tournament);
  }

  assert.ok(tournament.rounds.length <= 5);
  assert.equal(
    tournament.participants.filter((item) => item.status === "qualified").length,
    8,
  );
  assert.equal(
    tournament.participants.filter((item) => item.status === "eliminated").length,
    8,
  );
  assert.equal(getStandings(tournament).length, 16);
});

test("undo reopens the previous round and recalculates records", () => {
  const tournament = makeTournament();
  chooseAllWinners(tournament);

  undoLastSettlement(tournament);

  assert.equal(tournament.rounds.length, 1);
  assert.equal(tournament.rounds[0].finalized, false);
  assert.equal(
    tournament.participants.reduce((sum, item) => sum + item.wins, 0),
    0,
  );
});
