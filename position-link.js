import { replaySession } from "./opening-session.js";

const rules = ["freestyle", "renju", "rif", "taraguchi10"];
const workflows = ["follow", "duel", "copilot", "local"];
const choices = ["keep", "swap", "ten"];
const pointActions = ["stone", "offer", "select"];
const PREFIX = "#position=";
const SEED_SIZE = 45;

// Five ternary intersections fit in a byte. Opening actions occupy two bytes
// each, so even a completed game can fit in an ordinary copied link.
export function encodePositionLink(record, href) {
  const session = replaySession(record);
  const seed = session.options.seed;
  // Use the original seat, since a start action can set it during replay.
  const count = session.events.length;
  const bytes = [1, rules.indexOf(session.rule), workflows.indexOf(session.workflow), session.options.initialBlackSeat ?? 2,
    seed?.sideToMove ?? 0, count >> 8, count & 255];
  if (seed) for (let i = 0; i < seed.board.length; i += 5) {
    bytes.push(seed.board.slice(i, i + 5).reduce((packed, color, n) => packed + color * 3 ** n, 0));
  }
  for (const event of session.events) {
    const type = pointActions.indexOf(event.type);
    const value = type >= 0 ? type * 225 + event.index
      : event.type === "decision" ? 675 + choices.indexOf(event.choice)
        : event.type === "start" ? 678 + event.initialBlackSeat : 680;
    const encoded = value * 2 + Number(Boolean(event.automatic));
    bytes.push(encoded >> 8, encoded & 255);
  }
  const url = new URL(href);
  url.search = "";
  url.hash = PREFIX + btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return url;
}

export function decodePositionLink(hash) {
  if (!hash.startsWith(PREFIX)) return null;
  const token = hash.slice(PREFIX.length);
  if (!/^[A-Za-z0-9_-]{10,870}$/.test(token)) throw Error("棋局链接不完整或格式无效");
  const raw = atob(token.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = Array.from(raw, char => char.charCodeAt(0));
  const [version, rule, workflow, seat, color] = bytes;
  if (version !== 1 || !rules[rule] || !workflows[workflow] || seat > 2 || color > 2) throw Error("棋局链接版本或规则无效");
  const start = color ? 7 + SEED_SIZE : 7;
  const count = (bytes[5] << 8) + bytes[6];
  if (count > 300 || bytes.length !== start + count * 2) throw Error("棋局链接不完整");
  let seed = null;
  if (color) {
    const packedBoard = bytes.slice(7, start);
    if (packedBoard.some(n => n >= 3 ** 5)) throw Error("棋局链接含有无效棋子");
    const board = packedBoard.flatMap(n => Array.from({ length: 5 }, (_, i) => Math.floor(n / 3 ** i) % 3));
    seed = { board, sideToMove: color };
  }
  const events = [];
  for (let i = start; i < bytes.length; i += 2) {
    const encoded = (bytes[i] << 8) + bytes[i + 1], value = encoded >> 1;
    if (value > 680) throw Error("棋局链接含有无效操作");
    const event = value < 675 ? { type: pointActions[Math.floor(value / 225)], index: value % 225 }
      : value < 678 ? { type: "decision", choice: choices[value - 675] }
        : value < 680 ? { type: "start", initialBlackSeat: value - 678 } : { type: "handoff" };
    if (encoded & 1) event.automatic = true;
    events.push(event);
  }
  return replaySession({ format: "gomoku-opening", version: 1, rule: rules[rule], workflow: workflows[workflow], initialBlackSeat: seat === 2 ? null : seat, seed, events });
}
