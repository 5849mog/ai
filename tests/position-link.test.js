import assert from "node:assert/strict";
import test from "node:test";
import { OpeningSession, canManualTurn, isAutomaticTurn } from "../opening-session.js";
import { encodePositionLink, decodePositionLink } from "../position-link.js";
import { openingFlow } from "../opening-flow.js";

const origin = "https://example.com/ai/?view=simple#guide";
const roundTrip = session => {
  const link = encodePositionLink(session.record(), origin);
  assert.equal(link.search, "");
  const copy = decodePositionLink(link.hash);
  assert.deepEqual(copy.record(), session.record());
  assert.deepEqual(copy.board, session.board);
  assert.deepEqual(copy.candidates, session.candidates);
};

test("a shared link round-trips an opening with an explicitly selected seat and pending fifth proposals", () => {
  const session = new OpeningSession({ rule: "rif", workflow: "local", initialBlackSeat: null });
  assert.match(openingFlow(session).title, /先手/);
  session.apply({ type: "start", initialBlackSeat: 1 });
  for (const index of [112, 97, 96]) session.apply({ type: "stone", index }, { automatic: index === 112 });
  assert.equal(session.actor, 0);
  assert.equal(canManualTurn(session), true);
  assert.equal(isAutomaticTurn(session), false);
  session.apply({ type: "decision", choice: "swap" });
  session.apply({ type: "stone", index: 110 });
  const index = session.allowedMoves()[0];
  session.apply({ type: "offer", index });
  roundTrip(session);
  assert.equal(session.undo().board[index], 0);
});

test("shared seeded positions preserve both corners and reject invalid or truncated data", () => {
  const board = new Uint8Array(225);
  board[0] = board[113] = 1; board[224] = 2;
  const session = new OpeningSession({ rule: "renju", workflow: "duel", initialBlackSeat: 1, seed: { board, sideToMove: 2 } });
  session.apply({ type: "stone", index: 112 });
  roundTrip(session);
  const link = encodePositionLink(session.record(), origin);
  assert.throws(() => decodePositionLink(link.hash.slice(0, -2)));
  assert.throws(() => decodePositionLink("#position=rrrrrrrrrr"));
  assert.equal(decodePositionLink("#guide"), null);
});
