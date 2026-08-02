import test from "node:test";
import assert from "node:assert/strict";

import {
  createTournament,
  finalizeCurrentRound,
  getCurrentRound,
  getStandings,
  regenerateCurrentRound,
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

function makeEightTournament() {
  return createTournament({
    entrantCount: 8,
    eventName: "八单位测试赛",
    entrantType: "双打",
    seed: "zoo-eight-test",
    names: Array.from({ length: 8 }, (_, index) => `组合 ${index + 1}`),
    affiliations: Array.from(
      { length: 8 },
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

test("an unfinalized Swiss round can be redrawn without keeping entered results", () => {
  const tournament = makeTournament();
  const originalRound = getCurrentRound(tournament);
  const originalPairing = originalRound.matches
    .map((match) => [match.aId, match.bId].sort().join(":"))
    .sort()
    .join("|");

  selectWinner(tournament, originalRound.matches[0].id, originalRound.matches[0].aId);
  updateGameScore(tournament, originalRound.matches[0].id, 0, "a", 11);
  regenerateCurrentRound(tournament);

  const redrawnRound = getCurrentRound(tournament);
  const redrawnPairing = redrawnRound.matches
    .map((match) => [match.aId, match.bId].sort().join(":"))
    .sort()
    .join("|");
  assert.notEqual(redrawnPairing, originalPairing);
  assert.ok(redrawnRound.drawRevision > 0);
  assert.ok(redrawnRound.matches.every((match) => !match.winnerId));
  assert.ok(
    redrawnRound.matches.every((match) =>
      match.games.every((game) => game.a === 0 && game.b === 0),
    ),
  );
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

test("uses point differential instead of opponent score for Swiss standings", () => {
  const tournament = makeTournament();
  const round = getCurrentRound(tournament);
  const firstMatch = round.matches[0];

  updateGameScore(tournament, firstMatch.id, 0, "a", 21);
  updateGameScore(tournament, firstMatch.id, 0, "b", 16);
  for (const match of round.matches) {
    selectWinner(tournament, match.id, match.aId);
  }
  finalizeCurrentRound(tournament);

  const standings = getStandings(tournament);
  assert.equal(
    standings.find((participant) => participant.id === firstMatch.aId).netPoints,
    5,
  );
  assert.equal(
    standings.find((participant) => participant.id === firstMatch.bId).netPoints,
    -5,
  );
  assert.equal(standings[0].id, firstMatch.aId);
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

  const undefeatedIds = new Set(
    tournament.participants
      .filter((participant) => participant.wins === 3 && participant.losses === 0)
      .map((participant) => participant.id),
  );
  const protectedMatchIndexes = quarterfinal.matches
    .map((match, index) =>
      undefeatedIds.has(match.aId) || undefeatedIds.has(match.bId) ? index : -1,
    )
    .filter((index) => index >= 0);
  assert.equal(protectedMatchIndexes.length, 2);
  assert.notEqual(
    Math.floor(protectedMatchIndexes[0] / 2),
    Math.floor(protectedMatchIndexes[1] / 2),
  );

  for (const match of quarterfinal.matches) {
    const protectedSeed = [match.aId, match.bId].find((id) => undefeatedIds.has(id));
    selectWinner(tournament, match.id, protectedSeed || match.aId);
  }
  finalizeCurrentRound(tournament);
  const semifinal = getCurrentRound(tournament);
  for (const match of semifinal.matches) {
    const protectedSeed = [match.aId, match.bId].find((id) => undefeatedIds.has(id));
    selectWinner(tournament, match.id, protectedSeed || match.aId);
  }
  finalizeCurrentRound(tournament);
  const final = getCurrentRound(tournament);
  assert.deepEqual(
    new Set([final.matches[0].aId, final.matches[0].bId]),
    undefeatedIds,
  );
});

test("redrawing the 16 entrant quarterfinal keeps both 3-0 seeds in separate halves", () => {
  const tournament = makeTournament();
  completeSwiss(tournament);

  regenerateCurrentRound(tournament);
  const quarterfinal = getCurrentRound(tournament);
  const undefeatedIds = new Set(
    tournament.participants
      .filter((participant) => participant.wins === 3 && participant.losses === 0)
      .map((participant) => participant.id),
  );
  const matchIndexes = quarterfinal.matches
    .map((match, index) =>
      undefeatedIds.has(match.aId) || undefeatedIds.has(match.bId) ? index : -1,
    )
    .filter((index) => index >= 0);

  assert.equal(matchIndexes.length, 2);
  assert.notEqual(Math.floor(matchIndexes[0] / 2), Math.floor(matchIndexes[1] / 2));
  const byId = new Map(tournament.participants.map((participant) => [participant.id, participant]));
  assert.equal(
    quarterfinal.matches.filter((match) => {
      const records = [byId.get(match.aId), byId.get(match.bId)].map(
        (participant) => `${participant.wins}-${participant.losses}`,
      );
      return records.includes("3-0") && records.includes("3-2");
    }).length,
    2,
  );
  assert.ok(quarterfinal.drawRevision > 0);
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

test("8 entrant mode uses three 21-point Swiss rounds and qualifies everyone", () => {
  const tournament = makeEightTournament();

  while (tournament.phase === "swiss") {
    const round = getCurrentRound(tournament);
    assert.ok(
      round.matches.every(
        (match) => match.targetPoints === 21 && match.bestOf === 1,
      ),
    );
    chooseAllWinners(tournament);
  }

  const recordDistribution = tournament.participants
    .map((participant) => `${participant.wins}-${participant.losses}`)
    .sort();

  assert.equal(tournament.rounds.length, 3);
  assert.equal(
    tournament.participants.filter(
      (participant) => participant.status === "qualified",
    ).length,
    8,
  );
  assert.equal(
    tournament.participants.filter(
      (participant) => participant.status === "eliminated",
    ).length,
    0,
  );
  assert.deepEqual(recordDistribution, [
    "0-3",
    "1-2",
    "1-2",
    "1-2",
    "2-1",
    "2-1",
    "2-1",
    "3-0",
  ]);
});

test("8 entrant mode creates fixed 1-8, 4-5, 2-7 and 3-6 quarterfinals", () => {
  const tournament = makeEightTournament();
  completeSwiss(tournament);

  const standings = getStandings(tournament);
  const quarterfinal = getCurrentRound(tournament);
  const expectedPairs = [
    [standings[0].id, standings[7].id],
    [standings[3].id, standings[4].id],
    [standings[1].id, standings[6].id],
    [standings[2].id, standings[5].id],
  ];

  assert.deepEqual(
    quarterfinal.matches.map((match) => [match.aId, match.bId]),
    expectedPairs,
  );
  assert.deepEqual(
    tournament.knockout.seedOrder,
    standings.map((participant) => participant.id),
  );
});

test("8 entrant mode can undo the seeded quarterfinal draw", () => {
  const tournament = makeEightTournament();
  completeSwiss(tournament);

  undoLastSettlement(tournament);

  assert.equal(tournament.phase, "swiss");
  assert.equal(tournament.knockout, null);
  assert.equal(tournament.rounds.length, 3);
  assert.equal(tournament.rounds.at(-1).finalized, false);
  assert.ok(
    tournament.participants.every(
      (participant) => participant.status === "active",
    ),
  );
});
