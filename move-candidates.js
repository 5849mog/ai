import { moveVerdict } from "./renju-rules.js";

export const CANDIDATE_COUNT = 5;
export const CANDIDATE_SLICE_MS = 600;
export const MOVE_REVIEW_MS = 700;
export function moveReviewOptions(review) {
  const board = review.board.slice(); board[review.index] = review.color;
  return { board, sideToMove: 3 - review.color, rule: review.rule, allowSetup: true, timeMs: MOVE_REVIEW_MS };
}
const validIndex = index => Number.isInteger(index) && index >= 0 && index < 225;
const coordinate = index => "ABCDEFGHIJKLMNO"[index % 15] + (15 - Math.floor(index / 15));
const colorName = color => color === 1 ? "黑" : "白";
const legal = (position, index) => validIndex(index) && !position.board[index] &&
  (!position.allowedMoves || position.allowedMoves.includes(index)) && !moveVerdict(position.board, index, position.color, position.rule).forbidden;
const copyRow = row => ({ ...row });

// Scores always belong to the mover on the board BEFORE the recorded move.
// Live candidates and the pinned review have independent identities and jobs.
export class MoveCandidates {
  constructor() { this.reset(); }
  reset() { this.current = null; this.review = null; this.job = null; this.pinned = false; this.selection = null; }
  setPosition({ board, color, rule = "freestyle", ply = 0, stage = "play", allowedMoves, enabled = true, note = "", continuation = false }) {
    const key = JSON.stringify([Array.from(board), color, rule, stage, allowedMoves, enabled, continuation]);
    if (key === this.current?.key) return;
    this.job = null; this.selection = null;
    this.current = { key, board: Uint8Array.from(board), color, rule, ply, stage,
      allowedMoves: allowedMoves ? [...allowedMoves] : undefined, enabled, note, continuation, rows: [], depth: null };
  }
  begin(requestId) { this.job = this.current?.enabled ? { requestId, key: this.current.key, color: this.current.color } : null; }
  cancel() {
    this.job = null; this.selection = null;
    if (this.review?.pending) { this.review.pending = false; this.review.error = "评分复核已取消"; }
  }
  accept({ requestId, sideToMove, stats }) {
    const p = this.current;
    // Keep the inspected list stable until the user clears or confirms it.
    if (this.selection?.position === p) return false;
    if (!p?.enabled || !this.job || this.job.requestId !== requestId || this.job.key !== p.key || this.job.color !== sideToMove) return false;
    const batch = stats?.recommendations;
    if (!Array.isArray(batch) || !batch.length || batch.length > CANDIDATE_COUNT || new Set(batch.map(row => row.index)).size !== batch.length ||
      batch.some(row => !legal(p, row.index))) return false;
    const rows = batch.map((row, rank) => {
      const winning = moveVerdict(p.board, row.index, p.color, p.rule).winner === p.color;
      return { index: row.index, rank: rank + 1,
        score: winning ? 29999 : Number.isFinite(row.score) ? row.score : null,
        winRate: winning ? 1 : Number.isFinite(row.winRate) && row.winRate >= 0 && row.winRate <= 1 ? row.winRate : null,
        depth: Number.isInteger(row.depth) && row.depth >= 0 ? row.depth : null, winning };
    });
    const scored = rows.filter(row => row.score !== null && !row.winning);
    if (scored.length && (scored.length !== rows.filter(row => !row.winning).length || scored.some(row => row.depth === null || row.depth !== scored[0].depth))) return false;
    const depth = scored[0]?.depth ?? null;
    if (p.rows.length && !rows.every(row => row.winning) && (depth === null || p.depth !== null && depth < p.depth)) return false;
    p.rows = rows; p.depth = depth; return true;
  }
  record(index) {
    const p = this.current;
    if (!p?.enabled || !validIndex(index) || p.board[index]) return null;
    const rows = p.rows.map(copyRow), found = rows.find(row => row.index === index);
    const verdict = moveVerdict(p.board, index, p.color, p.rule);
    const actual = found ?? { index, rank: null, score: null, winRate: null, depth: null };
    if (!found) rows.push(actual);
    if (verdict.forbidden) Object.assign(actual, { score: -30000, winRate: 0, forbidden: verdict.forbidden });
    else if (verdict.winner === p.color) Object.assign(actual, { score: 29999, winRate: 1, winning: true });
    else if (verdict.winner === 3) Object.assign(actual, { score: 0, winRate: .5, drawn: true });
    const review = { ...p, board: p.board.slice(), rows, index, actual, outside: !found,
      rankedCount: p.rows.length, needsScore: actual.score === null, pending: actual.score === null, error: "" };
    this.review = review; this.pinned = true; this.job = null; this.selection = null; return review;
  }
  finishReview(review, result) {
    if (this.review !== review) return false;
    const child = moveReviewOptions(review), p = { ...child, color: child.sideToMove }, a = result?.assessment;
    review.pending = false;
    const replyVerdict = legal(p, result?.index) ? moveVerdict(child.board, result.index, p.color, p.rule) : null;
    if (replyVerdict?.winner === p.color || replyVerdict?.winner === 3) {
      Object.assign(review.actual, { score: replyVerdict.winner === 3 ? 0 : -29998, winRate: replyVerdict.winner === 3 ? .5 : 0,
        mate: replyVerdict.winner === 3 ? null : "-M2", replyIndex: result.index, rechecked: true });
      review.needsScore = false; review.error = ""; return true;
    }
    const replyMate = /^[+-]?M\d+$/.test(a?.mate ?? "") ? a.mate : null;
    if (!legal(p, result?.index) || !legal(p, a?.bestIndex) || (!Number.isFinite(a.evaluation) && !replyMate) ||
      !Number.isFinite(a.winRate) || a.winRate < 0 || a.winRate > 1 || !Number.isInteger(a.depth) || a.depth < 0) {
      review.error = "未得到该落点的完整评分"; return false;
    }
    const mate = replyMate ? `${replyMate.startsWith("-") ? "+" : "-"}M${Number(replyMate.replace(/^[+-]?M/, "")) + 1}` : null;
    Object.assign(review.actual, { score: Number.isFinite(a.evaluation) ? -a.evaluation : (mate.startsWith("-") ? -1 : 1) * (30000 - Number(mate.replace(/^[+-]?M/, ""))),
      winRate: 1 - a.winRate, depth: a.depth, mate, replyIndex: a.bestIndex, rechecked: true });
    review.needsScore = false; review.error = ""; return true;
  }
  failReview(review, message = "暂未完成评分复核") {
    if (this.review !== review) return;
    review.pending = false; review.error = message;
  }
  get displayed() { return this.pinned && this.review ? this.review : this.current; }
  select(index) {
    const position = this.displayed, row = position?.rows.find(row => row.index === index);
    if (!row) return false;
    this.selection = this.selection?.position === position && this.selection.index === index ? null : { position, index, color: position.color, rank: row.rank };
    return true;
  }
  get preview() { return this.selection?.position === this.displayed ? this.selection : null; }
  get applicable() {
    const s = this.preview;
    return s && !this.pinned && s.position === this.current && this.current.enabled && legal(this.current, s.index) ? s : null;
  }
}

function scoreText(row) {
  if (row.forbidden) return "禁手 · 判负";
  if (row.winning) return "+M1";
  if (row.mate) return row.mate;
  if (row.score === null) return "待评估";
  if (Math.abs(row.score) > 29000) return `${row.score < 0 ? "−" : "+"}M${30000 - Math.abs(row.score)}`;
  return `${row.score > 0 ? "+" : ""}${row.score}`;
}

export function createCandidateView(root, model, callbacks = {}) {
  if (typeof callbacks === "function") callbacks = { onCurrent: callbacks };
  const document = root.ownerDocument;
  root.innerHTML = `<header class="candidate-heading"><strong id="candidateTitle">下一手候选</strong><span class="candidate-tools"><button type="button" id="candidateReplyMode" hidden>自动应手</button><button type="button" id="candidateSwitch" hidden>当前</button></span></header><p class="candidate-context" id="candidateContext"></p><ol class="candidate-list" id="candidateList"></ol><div class="candidate-footer"><p class="candidate-note" id="candidateNote" role="status"></p><button type="button" id="candidateApply" hidden>采用应手</button></div>`;
  const $ = selector => root.querySelector(selector);
  $("#candidateSwitch").onclick = () => { model.selection = null; model.pinned = !model.pinned; render(); callbacks.onCurrent?.(); };
  $("#candidateReplyMode").onclick = () => callbacks.onReplyMode?.();
  $("#candidateApply").onclick = () => { if (options.canApply && model.applicable) callbacks.onApply?.(model.applicable); };
  $("#candidateList").onclick = event => {
    const button = event.target.closest("button[data-index]");
    if (button && model.select(Number(button.dataset.index))) { render(); callbacks.onPreview?.(); }
  };
  let signature = "", options = {};
  function render(nextOptions) {
    if (nextOptions) options = nextOptions;
    const p = model.displayed, review = model.pinned && model.review;
    const preview = model.preview;
    const next = JSON.stringify([p, Boolean(review), Boolean(model.review), preview && [preview.index, preview.color], options]);
    if (next === signature) return; signature = next;
    root.dataset.mode = review ? "review" : "live"; root.dataset.color = p?.color ?? "";
    root.dataset.ply = p?.ply ?? ""; root.dataset.selected = review ? p.index : "";
    $("#candidateSwitch").hidden = !model.review;
    $("#candidateSwitch").textContent = review ? "当前" : "回看";
    $("#candidateSwitch").setAttribute("aria-label", review ? "查看当前局面的候选" : "回看上一录入落子");
    $("#candidateReplyMode").hidden = !callbacks.onReplyMode || options.hideReplyMode;
    $("#candidateReplyMode").disabled = Boolean(options.modeDisabled);
    $("#candidateReplyMode").textContent = options.manualReply ? "自选应手" : "自动应手";
    $("#candidateReplyMode").setAttribute("aria-pressed", String(Boolean(options.manualReply)));
    $("#candidateReplyMode").title = "切换自动落子与从候选中自选 AI 应手";
    $("#candidateApply").hidden = !preview || !model.applicable || !options.canApply;
    $("#candidateApply").textContent = options.applyLabel || "采用应手";
    $("#candidateTitle").textContent = p ? `${colorName(p.color)}棋 · ${review ? "落子复核" : "下一手候选"}` : "下一手候选";
    $("#candidateContext").textContent = p ? `${p.continuation ? "续下" : ""}第 ${p.ply + 1} 手${review ? " · 落子前" : ""} · 正分利于${colorName(p.color)}棋${review && p.note ? ` · ${p.note}` : ""}` : "等待棋局";
    const list = $("#candidateList"), focusedIndex = list.contains(document.activeElement) ? document.activeElement.dataset.index : null;
    list.replaceChildren();
    for (const row of p?.rows ?? []) {
      const entry = document.createElement("li"), li = document.createElement("button"), rank = document.createElement("span"), point = document.createElement("strong"), score = document.createElement("span"), rate = document.createElement("span");
      entry.className = `candidate-entry${row.rank === null ? " unranked" : ""}`; li.type = "button";
      li.dataset.index = row.index; const selected = Boolean(review && row.index === p.index);
      li.className = `candidate-row${selected ? " selected" : ""}${row.rank === null ? " unranked" : ""}${preview?.index === row.index ? " inspecting" : ""}`;
      if (selected) li.setAttribute("aria-current", "true");
      li.setAttribute("aria-pressed", String(preview?.index === row.index));
      rank.className = "candidate-rank"; rank.textContent = row.rank ?? "外";
      point.textContent = coordinate(row.index); point.title = `左起第 ${row.index % 15 + 1} 列，上起第 ${Math.floor(row.index / 15) + 1} 行${selected ? " · 实际落子" : ""}`;
      score.className = "candidate-score"; score.textContent = scoreText(row);
      rate.className = "candidate-rate"; rate.textContent = row.winRate === null ? "—" : `${(row.winRate * 100).toFixed(1)}%`;
      li.title = `${colorName(p.color)}棋 ${coordinate(row.index)}：评分 ${scoreText(row)}${row.winRate === null ? "" : `，引擎估值 ${(row.winRate * 100).toFixed(1)}%`}${row.depth === null ? "" : `，深度 ${row.depth}`}${row.rechecked ? "；单点复核，与榜单深度可能不同" : ""}`;
      li.setAttribute("aria-label", `${li.title}，点击在棋盘预览${selected ? "，实际落子" : ""}`);
      li.append(rank, point, score, rate); entry.append(li); list.append(entry);
    }
    if (focusedIndex !== null) list.querySelector(`button[data-index="${focusedIndex}"]`)?.focus({ preventScroll: true });
    if (preview) $("#candidateNote").textContent = `${coordinate(preview.index)} · ${review ? "历史候选，仅预览" : "点选预览"}`;
    else if (review) $("#candidateNote").textContent = p.pending ? `${coordinate(p.index)} · 复核中`
      : p.error || `${coordinate(p.index)} · ${p.actual.forbidden ? "禁手判负" : p.actual.winning ? "成五" : p.actual.drawn ? "和棋" : p.outside ? p.rankedCount >= 5 ? "榜外评分" : "单点评分" : `候选 ${p.actual.rank}`}`;
    else $("#candidateNote").textContent = !p?.enabled ? p?.note || "当前不是普通落子阶段" : p.rows.length ? `${p.rows.length} 个候选${p.depth === null ? "" : ` · 深度 ${p.depth}`} · ${p.rows.some(row => row.score === null) ? "评分未完成" : "引擎估值"}${p.note ? ` · ${p.note}` : ""}` : "正在分析候选…";
  }
  return { render };
}
