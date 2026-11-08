import { createRecord } from './game-record.js';
import { replaySession } from './opening-session.js';
import { reviewFrames } from './game-review.js';

// One review frame is created for every recorded event, including proposals
// and swaps. Replaying the prefix preserves those rules and ownership changes.
export function reviewBranch(record, step) {
  const review = reviewFrames(record);
  if (!Number.isInteger(step) || step < 0 || step >= review.frames.length || review.frames[step].winner) throw new Error('请选择尚未结束的局面');
  if (record.format === 'gomoku-opening') return replaySession({ ...record, events: record.events.slice(0, step) }).record();
  return createRecord(record.moves.slice(0, step), record.playerColor, record.setup);
}
