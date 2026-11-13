import { replayRecord } from "./game-record.js";
import { OpeningSession, replaySession, colorName, coordinate } from "./opening-session.js";
import { moveVerdict } from "./renju-rules.js";

// Mirrors the frame reconstruction in game-review.js, but also permits a game
// still in progress. Keep the two reconstruction paths in sync.
// Keep ownership and candidate choices in their original order. A proposed
// fifth is an action, not a stone; the selected fifth is placed exactly once.
export function reviewFramesIncludingUnfinished(record) {
  const frames = [], moves = [], openings = [];
  let rule = "freestyle", winner;
  if (record?.format === "gomoku-opening") {
    const final = replaySession(record); winner = final.winner; rule = final.rule;
    const session = new OpeningSession(record);
    const frame = label => ({ board: session.board.slice(), lastMove: session.lastMove, candidates: [...session.candidates],
      label: label + (session.forbidden ? ` · ${session.forbidden}禁手（白胜）` : ""), winner: session.winner, forbidden: session.forbidden });
    frames.push(frame(record.seed ? "起始摆局" : "开局"));
    for (const event of record.events) {
      const before = frame(""), stage = session.stage, color = session.color, actor = session.actor, prefix = session.record();
      session.apply(event);
      const label = event.type === "stone" || event.type === "select" ? `第 ${session.moves.length} 手 · ${colorName(color)} ${coordinate(event.index)}`
        : event.type === "offer" ? `第五手候选 A${session.candidates.length} · ${coordinate(event.index)}`
          : event.type === "decision" ? event.choice === "swap" ? "交换黑白" : event.choice === "ten" ? "选择十打" : "保持执色"
            : event.type === "start" ? "确定开局角色" : "AI 接手";
      frames.push(frame(label));
      if (["rif", "taraguchi10"].includes(rule) && !record.seed) {
        const node = {stage,actor,frame:frames.length-1,ply:session.moves.length,before:before.board,record:prefix,event:{...event},label};
        if(event.type==="decision" || event.type==="select" || event.type==="stone" && ["w4","b5"].includes(stage)) openings.push(node);
        if(event.type==="stone" && stage==="b3") openings.push({...node,kind:"three",record:session.record(),label:"前三子布局"});
        if(event.type==="offer" && session.stage==="choose") openings.push({...node,kind:"group",points:[...session.candidates],
          record:{...prefix,events:session.events.slice(0,-session.candidates.length)},label:`${session.candidates.length===2?"两打":"十打"}整组提案`});
      }
      if (event.type === "stone" && ["play", "w6"].includes(stage)) moves.push({ before: before.board, after: session.board.slice(), index: event.index, color, actor, ply: session.moves.length, frame: frames.length - 1, winner: session.winner });
    }
  } else {
    const game = replayRecord(record); winner = game.winner;
    const board = Uint8Array.from(record.setup?.board ?? new Uint8Array(225)), first = record.setup?.sideToMove ?? 1;
    frames.push({ board: board.slice(), lastMove: -1, candidates: [], label: record.setup ? "起始摆局" : "开局", winner: 0 });
    for (const [ply, index] of record.moves.entries()) {
      const color = ply % 2 ? 3 - first : first, before = board.slice();
      const result = moveVerdict(board, index, color); board[index] = color;
      frames.push({ board: board.slice(), lastMove: index, candidates: [], label: `第 ${ply + 1} 手 · ${colorName(color)} ${coordinate(index)}`, winner: result.winner });
      moves.push({ before, after: board.slice(), index, color, actor: color === record.playerColor ? 0 : 1, ply: ply + 1, frame: frames.length - 1, winner: result.winner });
    }
  }
  return { frames, moves, openings, rule, winner };
}
