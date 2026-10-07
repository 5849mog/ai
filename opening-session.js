import { moveVerdict, validateSeed, inCentral, positionSymmetries, candidateKey } from "./renju-rules.js";
export const RULES = { freestyle: "无禁手", renju: "禁手 · 自由开局", rif: "五手两打", taraguchi10: "塔拉山口-10" };
export const colorName = color => color === 1 ? "黑" : "白";
export const coordinate = index => "ABCDEFGHIJKLMNO"[index % 15] + (15 - Math.floor(index / 15));
export function isAutomaticTurn(session) {
  if (!session || session.winner || session.stage === "setup") return false;
  if (session.workflow === "duel") return session.actor === 1;
  return session.workflow === "copilot" && session.copilotReady && !session.decision && session.actor === 0;
}
export function canManualTurn(session, { modal = false, busy = false } = {}) {
  if (!session || modal || session.winner || session.stage === "setup") return false;
  if (session.workflow === "follow") return true;
  if (session.workflow === "copilot" && (!session.copilotReady || session.decision)) return !busy;
  return session.workflow === "copilot" ? session.actor === 1 && !busy : session.actor === 0 && !busy;
}
const STONES = { b1: 1, w2: 2, b3: 1, w4: 2, b5: 1, w6: 2 };
const WIDTHS = { b1: 1, w2: 3, b3: 5, w4: 7, b5: 9 };
// Replay actions rather than inventing alternating stones. Swaps change
// ownership only; proposed fifths do not enter the board before selection.
export class OpeningSession {
  constructor({ rule = "rif", workflow = "copilot", initialBlackSeat = 0, seed = null } = {}) {
    if (!Object.hasOwn(RULES, rule) || !["follow", "duel", "copilot"].includes(workflow) || ![0, 1].includes(initialBlackSeat) && !(initialBlackSeat === null && !seed)) throw new Error("对局设置无效");
    if (seed) { validateSeed(seed.board); if (![1, 2].includes(seed.sideToMove)) throw new Error("下一手棋色无效"); }
    this.options = { rule, workflow, initialBlackSeat, seed: seed ? { board: Array.from(seed.board), sideToMove: seed.sideToMove } : null };
    const hasFormalOpening = rule === "rif" || rule === "taraguchi10";
    const ready = workflow === "copilot" && initialBlackSeat !== null && (Boolean(seed) || hasFormalOpening);
    const freeOpening = rule === "freestyle" || rule === "renju";
    Object.assign(this, { rule, workflow, copilotReady: ready, initialBlackSeat, blackSeat: initialBlackSeat, board: Uint8Array.from(seed?.board ?? new Uint8Array(225)), stage: initialBlackSeat === null ? "setup" : seed || freeOpening ? "play" : "b1", next: seed?.sideToMove ?? 1, moves: [], colors: [], events: [], actors: [], candidates: [], winner: 0, forbidden: "", lastMove: -1 });
  }
  get color() { return STONES[this.stage] ?? (["offer", "offer10", "choose"].includes(this.stage) ? 1 : this.next); }
  get whiteSeat() { return 1 - this.blackSeat; }
  get playerColor() { return this.blackSeat === null ? 0 : this.blackSeat === 0 ? 1 : 2; }
  get actor() {
    if (this.stage === "setup") return 0;
    if (this.rule === "rif" && ["b1", "w2", "b3"].includes(this.stage)) return this.initialBlackSeat;
    if (this.stage === "swap3" && this.rule === "rif") return 1 - this.initialBlackSeat;
    if (this.stage.startsWith("swap")) return this.next === 1 ? this.blackSeat : this.whiteSeat;
    if (this.stage === "route4" || this.stage.startsWith("offer")) return this.blackSeat;
    if (this.stage === "choose") return this.whiteSeat;
    return this.color === 1 ? this.blackSeat : this.whiteSeat;
  }
  get decision() { return this.stage.startsWith("swap") || this.stage === "route4"; }
  get offerCount() { return this.stage === "offer10" ? 10 : this.stage === "offer" ? 2 : 0; }
  get width() { return this.rule === "freestyle" || this.rule === "renju" || this.options.seed || this.rule === "rif" && this.stage === "w4" ? 15 : WIDTHS[this.stage] ?? 15; }
  canPoint(index) {
    if (this.winner || this.decision || this.stage === "setup" || !Number.isInteger(index) || index < 0 || index >= 225 || this.board[index]) return false;
    if (this.stage === "choose") return this.candidates.includes(index);
    if (!inCentral(index, this.width)) return false;
    if (this.offerCount) {
      const symmetries = positionSymmetries(this.board), key = candidateKey(index, symmetries);
      if (this.candidates.some(i => candidateKey(i, symmetries) === key) || moveVerdict(this.board, index, 1, this.rule).forbidden) return false;
    }
    return true;
  }
  allowedMoves({ safe = false } = {}) { return Array.from({ length: 225 }, (_, i) => i).filter(i => this.canPoint(i) && (!safe || !moveVerdict(this.board, i, this.color, this.rule).forbidden)); }
  apply(event, { automatic = Boolean(event?.automatic) } = {}) {
    if (!event || this.winner) throw new Error("对局已结束或操作无效");
    const actor = this.actor;
    if (this.stage === "setup") {
      if (event.type !== "start" || ![0, 1].includes(event.initialBlackSeat)) throw new Error("请先选择谁先开局");
      this.initialBlackSeat = this.blackSeat = event.initialBlackSeat;
      const formal = this.rule === "rif" || this.rule === "taraguchi10";
      this.stage = formal ? "b1" : "play"; this.copilotReady = this.workflow === "copilot" && formal;
    } else if (event.type === "handoff") {
      if (this.workflow !== "copilot" || this.stage !== "play" || this.copilotReady) throw new Error("当前不需要 AI 接手");
      this.copilotReady = true;
    } else if (this.decision) {
      if (event.type !== "decision" || !["keep", "swap", ...(this.stage === "route4" ? ["ten"] : [])].includes(event.choice)) throw new Error("请先选择是否交换黑白");
      if (event.choice === "swap") this.blackSeat = 1 - this.blackSeat;
      this.stage = { swap1: "w2", swap2: "b3", swap3: "w4", swap5: "w6", route4: event.choice === "ten" ? "offer10" : "b5" }[this.stage]; this.next = this.color;
    } else if (this.offerCount) {
      if (event.type !== "offer" || !this.canPoint(event.index)) throw new Error("候选点需为空、合法，且不能与已有候选对称等价");
      this.candidates.push(event.index); if (this.candidates.length === this.offerCount) { this.stage = "choose"; this.next = 2; }
    } else {
      const choosing = this.stage === "choose";
      if (event.type !== (choosing ? "select" : "stone") || !this.canPoint(event.index)) throw new Error(choosing ? "请从已提出的第五手中选一个" : `请在中央 ${this.width} × ${this.width} 区域落子`);
      const color = this.color, verdict = moveVerdict(this.board, event.index, color, this.rule);
      this.board[event.index] = color; this.moves.push(event.index); this.colors.push(color); this.lastMove = event.index;
      this.winner = verdict.winner; this.forbidden = verdict.forbidden; this.next = 3 - color;
      if (choosing) { this.stage = "w6"; this.candidates = []; }
      else if (this.stage !== "play") this.stage = this.rule === "rif" ? { b1: "w2", w2: "b3", b3: "swap3", w4: "offer", w6: "play" }[this.stage] : { b1: "swap1", w2: "swap2", b3: "swap3", w4: "route4", b5: "swap5", w6: "play" }[this.stage];
    }
    const saved = event.type === "start" ? { type: event.type, initialBlackSeat: event.initialBlackSeat }
      : event.type === "decision" ? { type: event.type, choice: event.choice }
      : event.type === "handoff" ? { type: event.type }
        : { type: event.type, index: event.index };
    if (automatic) saved.automatic = true;
    this.events.push(saved); this.actors.push(actor); return this;
  }
  undo() {
    if (!this.events.length) return this;
    let count = this.events.length - 1;
    if (this.workflow === "duel") while (count > 0 && this.actors[count] !== 0) count--;
    else if (this.workflow === "copilot") while (count > 0 && this.events[count]?.automatic) count--;
    return replaySession({ ...this.record(), events: this.events.slice(0, count) });
  }
  record() { return { format: "gomoku-opening", version: 1, ...this.options, events: this.events.map(e => ({ ...e })) }; }
  description() {
    if (this.stage === "setup") return this.rule === "rif" ? "谁摆前三子？请选择开局角色" : "请选择本局最开始的执色";
    if (this.winner) return this.forbidden ? `黑棋${this.forbidden}禁手 · 白胜` : this.winner === 3 ? "棋盘已满 · 和棋" : `${colorName(this.winner)}棋获胜`;
    const actor = this.workflow === "follow" ? `录入${this.actor === 0 ? "我方" : "对方"}`
      : this.workflow === "copilot" && !this.copilotReady ? "录入开局"
        : this.workflow === "copilot" ? this.actor === 0 ? "AI替你" : "录入对手"
          : this.actor === 0 ? "你来" : "AI 将";
    if (this.decision) return `${actor}决定${this.stage === "route4" ? "换色或十打" : "是否换色"}`;
    if (this.offerCount) return `${actor}提出第五手 · ${this.candidates.length}/${this.offerCount}`;
    if (this.stage === "choose") return `${actor}选定一个第五手`;
    return `${actor}落${colorName(this.color)}棋 · ${this.options.seed ? "续下" : "第"} ${this.moves.length + 1} 手`;
  }
}
export function replaySession(record) {
  if (record?.format !== "gomoku-opening" || record.version !== 1 || !Array.isArray(record.events) || record.events.length > 300) throw new Error("不是有效的五目开局记录");
  const session = new OpeningSession(record); for (const event of record.events) session.apply(event); return session;
}
