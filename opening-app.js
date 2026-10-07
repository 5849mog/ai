import { OpeningSession, replaySession, RULES, colorName, coordinate, canManualTurn, isAutomaticTurn } from "./opening-session.js";
import { openingFlow, openingMarks, chosenProposal } from "./opening-flow.js";
import { moveVerdict } from "./renju-rules.js";
import { adviseOpening } from "./opening-advisor.js";
import { createOpeningDialogs } from "./opening-guide.js";
import { createBoardView } from "./board-view.js";
import { GomokuEngine } from "./engine.js?v=22";
import { PositionAnalysis } from "./position-analysis.js";
import { createAnalysisView } from "./analysis-view.js";
import { describeSearch } from "./search-info.js";
import { setupCustomUi } from "./setup-ui.js";
import { setupDisplayModes } from "./display-modes.js";
const $ = selector => document.querySelector(selector), svg = $("#boardSvg"), view = createBoardView(svg);
const STORAGE = `gomoku-opening:${new URL("./", import.meta.url).pathname}:v1`;
let session = new OpeningSession({ initialBlackSeat: null }), perspective = 1, state = "idle", serial = 0, requestId = 0;
let busy = false, modal = false, advice = null, stats = null, statsColor = 1, pondering = false;
let pending = -1, hover = -1, keyboard = 112, pointerType = "mouse", display, warningTimer, saveFailed = false, restoredAnalysis;
let rulesOpen = false, forbiddenInput = null;
const analysis = new PositionAnalysis(), analysisView = createAnalysisView($("#positionAnalysis"));
function notify(message, error = false) {
  clearTimeout(warningTimer); $("#gameNotice").textContent = message; $("#gameNotice").classList.toggle("error", error); $("#gameNotice").hidden = false;
  $("#simpleLive").textContent = message; warningTimer = setTimeout(() => { $("#gameNotice").hidden = true; }, error ? 7000 : 4500);
}
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE));
  if (saved) { session = replaySession(saved.record); perspective = [1, 2].includes(saved.perspective) ? saved.perspective : 1; restoredAnalysis = saved.analysis; }
  const time = localStorage.getItem("gomoku-thinking-ms"); if (["1000", "5000", "10000"].includes(time)) $("#timeSelect").value = time;
  $("#ponderToggle").checked = localStorage.getItem("gomoku-pondering") !== "false";
} catch { notify("上次连珠记录无法恢复，已开始新局；原无禁手记录不受影响", true); }
function persist() {
  try {
    localStorage.setItem(STORAGE, JSON.stringify({ record: session.record(), perspective,
      analysis: { version: 1, playerColor: analysis.playerColor, positionKey: analysis.positionKey, moves: analysis.moves, points: analysis.history } })); saveFailed = false; return true;
  } catch { if (!saveFailed) notify("此局暂未保存，请从菜单导出完整记录", true); saveFailed = true; return false; }
}
function positionChanged(reset = false) {
  if (session.workflow !== "follow") perspective = session.playerColor || 1;
  const key = `${session.rule}:${session.options.seed ? session.options.seed.board.join("") + session.options.seed.sideToMove : "opening"}`;
  analysis.setPosition(session.moves, perspective, { reset, positionKey: key }); analysis.finish(session.winner);
  stats = null; pending = hover = -1; advice = null; persist();
}
positionChanged(true);
if (restoredAnalysis) { analysis.load({ getItem: () => JSON.stringify(restoredAnalysis) }); persist(); }
const engine = new GomokuEngine({ rule: session.rule,
  onState: event => { state = event.state; pondering = Boolean(event.pondering); render(); },
  onStats: event => { if (event.requestId !== requestId) return; stats = event.stats; statsColor = event.sideToMove; if (["play", "w6"].includes(session.stage)) analysis.accept(event); renderAnalysis(); }
});
function cancel() {
  serial++; requestId++; busy = false; advice = null; forbiddenInput = null; pending = hover = -1; analysis.cancel(); engine.stopPonder();
  // Recording several external opening stones must not restart model loading.
  // Serial guards cancel the old action; rule changes explicitly reset the worker.
  if (engine.ready) engine.cancel();
  state = engine.ready ? "ready" : engine.initPromise ? "loading" : "idle"; pondering = false; stats = null;
}
function configureRule() { if ((engine.rule === "freestyle") !== (session.rule === "freestyle")) { engine.reset(); state = "idle"; } engine.rule = session.rule; }
const manualTurn = () => !rulesOpen && !forbiddenInput && canManualTurn(session, { modal, busy });
const interactive = () => manualTurn() && !session.decision;
const workflowLabel = { copilot: "附身", follow: "记录", duel: "对弈" };
function renderAnalysis() {
  analysisView.render(analysis, session.winner);
  const name = colorName(perspective), other = colorName(3 - perspective);
  $("#perspectiveName").textContent = `${name}棋`; $("#otherName").textContent = `${other}棋`; $("#trendLegend").textContent = `上方利于${name} · 下方利于${other}`;
  const judgement = $("#positionJudgement"); judgement.textContent = session.winner ? session.description() : !["play", "w6"].includes(session.stage)
    ? "开局尚未定色，先完成交换与选案" : judgement.textContent.replaceAll("你的", `${name}棋的`).replaceAll("你", `${name}棋`).replaceAll("AI", `${other}棋`);
  $("#positionContext").textContent = session.winner ? "对局已结束" : session.offerCount || session.stage === "choose" ? "第五手提案" : `第 ${session.moves.length} 手`;
  $("#winRateBar").setAttribute("aria-label", analysis.current?.winRate != null ? `估算胜率：${name}棋 ${$("#playerWinRate").textContent}，${other}棋 ${$("#aiWinRate").textContent}` : "当前局势等待评估");
  $("#positionTrend").setAttribute("aria-label", `${name}棋估算胜率走势，上方利于${name}，下方利于${other}`);
  const info = describeSearch(stats, statsColor, perspective);
  for (const [id, value] of [["searchDepth", info.depth], ["searchScore", info.score], ["searchNodes", info.nodes], ["searchSpeed", info.speed]]) $("#" + id).textContent = value;
  $("#analysisState").textContent = busy ? "AI 分析中" : pondering ? "AI 后台分析中" : "AI 搜索信息";
  $(".analysis-heading span:last-child").textContent = `正值利于${name}棋`;
}
function node(name, attributes) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name); for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value); return element;
}
function decorate() {
  if (session.width < 15 && !session.decision && !session.winner) {
    const step = 528 / 14, x = 46 + (7 - (session.width - 1) / 2) * step - 18, length = (session.width - 1) * step + 36;
    svg.append(node("rect", { x, y: x, width: length, height: length, rx: 4, class: "opening-region" }));
  }
  const proposals = [...session.candidates];
  if (session.offerCount) for (const index of advice?.points ?? []) if (!proposals.includes(index)) proposals.push(index);
  for (const [rank, index] of proposals.entries()) {
    const x = 46 + index % 15 * 528 / 14, y = 46 + Math.floor(index / 15) * 528 / 14;
    const group = node("g", { class: `opening-proposal${advice?.points?.includes(index) ? " suggested" : ""}`, "data-proposal": index, "aria-label": `第五手候选 ${rank + 1} ${coordinate(index)}` });
    const text = node("text", { x, y }); text.textContent = `A${rank + 1}`; group.append(node("circle", { cx: x, cy: y, r: 14 }), text); svg.append(group);
  }
  const selected = chosenProposal(session);
  for (const mark of openingMarks(session)) {
    const text = node("text", { x: 46 + mark.index % 15 * 528 / 14, y: 46 + Math.floor(mark.index / 15) * 528 / 14,
      class: `opening-order${mark.color === 2 ? " white" : ""}`, "data-order-number": mark.label, "aria-label": `第 ${mark.label} 手 ${colorName(mark.color)}棋 ${coordinate(mark.index)}` });
    text.textContent = mark.label === "5" && selected ? selected.label : mark.label; svg.append(text);
  }
}
function renderFlow() {
  const flow = openingFlow(session, { busy, state, advice, rulesOpen, forbidden: forbiddenInput });
  for (const [root, hidden] of [[$("#openingFlow"), false], [$("#simpleOpeningFlow"), !display?.simple]]) {
    root.hidden = hidden;
    const key = JSON.stringify({ flow, busy, manual: manualTurn() });
    if (root.dataset.contentKey === key) continue;
    root.dataset.contentKey = key; root.dataset.stage = session.stage;
    const title = document.createElement("h2"), note = document.createElement("p"), actions = document.createElement("div");
    title.textContent = flow.title; title.setAttribute("role", "status"); note.textContent = flow.note; actions.className = "opening-flow-actions";
    for (const action of flow.actions) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = action.label;
      Object.assign(button.dataset, { flowAction: action.action, value: action.value, suggested: String(action.suggested) });
      if (action.action === "decision") button.dataset.choice = action.value;
      button.disabled = ["decision", "select", "handoff"].includes(action.action) && !manualTurn(); actions.append(button);
    }
    root.replaceChildren(title, note, actions);
  }
}
function render() {
  document.documentElement.classList.toggle("opening-simple", Boolean(display?.simple));
  view.render({ board: session.board, lastMove: session.lastMove, pendingIndex: pending, hoverIndex: hover, canInteract: interactive(), playerColor: session.color, editable: Boolean(session.forbidden),
    recommendations: session.offerCount || session.stage === "choose" ? [] : (advice?.points ?? []).slice(0, 2).map(index => ({ index })) }); decorate();
  const text = busy ? isAutomaticTurn(session) ? "AI 思考中" : "正在分析当前操作…" : pending >= 0 ? "再点一次确认" : session.description();
  $("#stateText").textContent = text; $("#stateText").title = text; $("#stateIndicator").className = `state-indicator${busy ? " thinking" : session.winner ? " finished" : ""}`;
  $("#searchClock").textContent = `${RULES[session.rule]} · ${workflowLabel[session.workflow]}`;
  $("#searchClock").title = `${session.playerColor ? `我方当前执${colorName(session.playerColor)}` : "开局角色待选"} · ${RULES[session.rule]}`;
  $("#undoButton").disabled = !session.events.length && pending < 0; $("#retryButton").hidden = state !== "error";
  $("#simpleUndoButton").disabled = $("#undoButton").disabled;
  $("#recommendButton").disabled = isAutomaticTurn(session) || session.stage === "setup" || rulesOpen || Boolean(forbiddenInput) || session.workflow === "copilot" && session.decision || (!advice && !busy && (modal || session.winner || state !== "ready"));
  $("#recommendButton").setAttribute("aria-pressed", String(Boolean(advice) || busy));
  $("#simpleRecommendButton").disabled = $("#recommendButton").disabled;
  $("#simpleRecommendButton").setAttribute("aria-pressed", $("#recommendButton").getAttribute("aria-pressed"));
  $("#simpleRecommendButton").title = $("#recommendButton").title;
  $("#recommendationLegend").hidden = !advice; $("#secondRecommendation").hidden = (advice?.points?.length ?? 0) < 2 || session.offerCount || session.stage === "choose";
  $("#recommendationNote").textContent = advice?.choice ? `建议${advice.choice === "swap" ? "交换" : "保持"}` : advice && session.offerCount ? "候选建议" : advice && session.stage === "choose" ? "绿圈首选" : "";
  $("#recommendationLegend .first").hidden = !advice?.points || Boolean(session.offerCount) || session.stage === "choose";
  for (const selector of [".color-control", ".time-control", ".ponder-control"]) $(selector).hidden = session.decision;
  $("#colorSelect").value = perspective; $("#colorSelect").disabled = session.workflow !== "follow"; $("#perspectiveLabel").textContent = session.workflow === "follow" ? "分析视角" : "你的执色";
  $("#timeSelect").disabled = busy; $("#ponderToggle").disabled = busy;
  svg.setAttribute("aria-label", `15 乘 15 连珠棋盘。${text}。${session.width < 15 ? `限中央 ${session.width} 乘 ${session.width}。` : ""}方向键选点，回车确认。`);
  svg.setAttribute("aria-disabled", String(!interactive())); Object.assign(svg.dataset, { stage: session.stage, rule: session.rule, workflow: session.workflow });
  display?.render({ playerColor: session.playerColor, winner: session.winner, state, text, busy });
  if (display?.simple) {
    $("#simpleColorLabel").textContent = "规则"; $("#simpleColor small").textContent = RULES[session.rule];
    $("#simpleColor").setAttribute("aria-label", "在棋盘旁选择本局规则"); $("#simpleColor").setAttribute("aria-pressed", String(rulesOpen));
    $("#simpleRecommendLabel").textContent = busy ? isAutomaticTurn(session) ? "AI 落子中" : "分析中" : advice ? "收起推荐" : "推荐";
    $("#simpleRecommendNote").textContent = busy ? "请稍候" : advice ? "点击关闭标记" : "AI 落点建议";
  }
  renderFlow();
  renderAnalysis();
}
async function syncPonder() {
  if (busy || modal || rulesOpen || forbiddenInput || session.winner || !["play", "w6"].includes(session.stage) || !$("#ponderToggle").checked || document.hidden || advice || isAutomaticTurn(session)) { engine.stopPonder(); return; }
  if (engine.pondering) return;
  const id = ++requestId; analysis.begin(id, session.color);
  try { await engine.ponder({ board: session.board, sideToMove: session.color, requestId: id, allowSetup: true }); } catch (error) { if (error.name !== "AbortError") render(); }
}
async function prepare() {
  const token = serial; if (modal || rulesOpen || forbiddenInput || session.stage === "setup") return;
  try { await engine.init(); if (token !== serial || modal) return;
    if (isAutomaticTurn(session)) await autoPlay();
    else if (session.workflow === "copilot" && session.decision && session.actor === 0 && !advice) await recommend();
    else await syncPonder();
  } catch (error) { if (error.name !== "AbortError") { render(); notify(error.message, true); } }
}
function searchFor(token) { return async options => {
  if (token !== serial || modal) throw new DOMException("操作已取消", "AbortError");
  const id = ++requestId;
  // Hypothetical fifths and swap evaluations never enter the actual trend.
  if (["play", "w6"].includes(session.stage) && options.board === session.board) analysis.begin(id, options.sideToMove);
  const result = await engine.search({ ...options, requestId: id });
  if (token !== serial || modal) throw new DOMException("操作已取消", "AbortError"); return result;
}; }
function commit(event, automatic = false) { session.apply(event, { automatic }); positionChanged(); render(); }
async function autoPlay() {
  if (busy || modal || session.winner) return;
  const token = serial; busy = true; engine.stopPonder(); render();
  try { while (token === serial && !modal && isAutomaticTurn(session)) {
    const time = Number($("#timeSelect").value), openingBatch = session.rule === "rif" && ["b1", "w2", "b3"].includes(session.stage);
    const suggestion = await adviseOpening(session, searchFor(token), openingBatch ? Math.max(100, Math.floor(time / 2)) : time);
    if (token !== serial || modal) return;
    if (session.decision) commit({ type: "decision", choice: suggestion.choice }, true);
    else if (session.offerCount) for (const index of suggestion.points) commit({ type: "offer", index }, true);
    else commit({ type: session.stage === "choose" ? "select" : "stone", index: suggestion.points[0] }, true);
  } } catch (error) { if (error.name !== "AbortError" && token === serial) { state = "error"; notify(`AI 未完成操作：${error.message}。可重试或悔棋。`, true); } }
  finally { if (token === serial) { busy = false; render(); if (state !== "error") void syncPonder(); } }
}
async function recommend() {
  if (busy || advice) { cancel(); render(); void prepare(); return; }
  if (!manualTurn() || state !== "ready") return;
  const token = serial; busy = true; engine.stopPonder(); pending = hover = -1; render();
  try { const suggestion = await adviseOpening(session, searchFor(token), 1000);
    if (token !== serial) return; advice = suggestion;
    if (suggestion.result && ["play", "w6"].includes(session.stage)) analysis.accept({ requestId, sideToMove: session.color, stats: suggestion.result });
    persist(); notify(suggestion.note);
  } catch (error) { if (error.name !== "AbortError" && token === serial) notify(error.message, true); }
  finally { if (token === serial) { busy = false; render(); } }
}
function handoff() {
  if (!manualTurn() || session.workflow !== "copilot" || session.stage !== "play" || session.copilotReady) return;
  cancel(); commit({ type: "handoff" }); void prepare();
}
function onModal(open) { if (open) cancel(); modal = open; render(); if (!open) void prepare(); }
function confirmation(title, message, label) {
  const dialog = document.createElement("dialog"); dialog.className = "opening-modal";
  dialog.innerHTML = `<h2></h2><p class="mode-description"></p><div class="dialog-actions"><button type="button" data-cancel>返回</button><button type="button" class="confirm-import" data-confirm></button></div>`;
  dialog.querySelector("h2").textContent = title; dialog.querySelector("p").textContent = message; dialog.querySelector("[data-confirm]").textContent = label;
  document.body.append(dialog); onModal(true);
  return new Promise(resolve => { let confirmed = false;
    dialog.querySelector("[data-cancel]").onclick = () => dialog.close(); dialog.querySelector("[data-confirm]").onclick = () => { confirmed = true; dialog.close(); };
    dialog.addEventListener("close", () => { dialog.remove(); modal = false; resolve(confirmed); }, { once: true }); dialog.showModal();
  });
}
async function place(index) {
  if (!interactive()) return;
  if (!session.canPoint(index)) { notify(session.stage === "choose" ? "请点已提出的候选" : session.offerCount ? "候选需合法且不能对称等价；可悔棋修改" : `这一手只能落在中央 ${session.width} × ${session.width} 空点`); return; }
  const verdict = moveVerdict(session.board, index, session.color, session.rule);
  if (!session.offerCount && session.stage !== "choose" && verdict.forbidden) {
    cancel(); forbiddenInput = { index, reason: verdict.forbidden }; render(); return;
  }
  cancel(); commit({ type: session.offerCount ? "offer" : session.stage === "choose" ? "select" : "stone", index }); void prepare();
}
function decision(choice) { if (!manualTurn() || !session.decision) return; cancel(); commit({ type: "decision", choice }); void prepare(); }
function newGame(options = { ...session.options, seed: null, initialBlackSeat: session.workflow === "copilot" ? null : session.initialBlackSeat }) { cancel(); rulesOpen = false; session = new OpeningSession(options); configureRule(); perspective = session.playerColor || 1; positionChanged(true); render(); void prepare(); }
const dialogs = createOpeningDialogs({ getSession: () => session, onNew: newGame, onModal });
const indexAt = event => { const target = event.target.closest("[data-index]"); return target ? Number(target.dataset.index) : view.nearestIntersection(event.clientX, event.clientY); };
svg.addEventListener("pointerdown", event => { pointerType = event.pointerType; });
svg.addEventListener("pointermove", event => { if (event.pointerType !== "mouse" || !interactive()) return; const i = indexAt(event), next = session.canPoint(i) ? i : -1; if (hover !== next) { hover = next; render(); } });
svg.addEventListener("pointerleave", () => { hover = -1; render(); });
svg.addEventListener("click", event => {
  if (!interactive()) return; const index = indexAt(event);
  if (!session.canPoint(index)) { void place(index); return; }
  if ((event.pointerType || pointerType) !== "mouse" && event.detail !== 0 && pending !== index) { pending = index; hover = -1; render(); } else void place(index);
});
svg.addEventListener("keydown", event => {
  if (!interactive()) return; const shifts = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (shifts[event.key]) { event.preventDefault(); const [dx, dy] = shifts[event.key]; keyboard = Math.max(0, Math.min(14, Math.floor(keyboard / 15) + dy)) * 15 + Math.max(0, Math.min(14, keyboard % 15 + dx)); hover = session.canPoint(keyboard) ? keyboard : -1; render(); }
  else if (["Enter", " "].includes(event.key)) { event.preventDefault(); void place(keyboard); }
});
for (const root of [$("#openingFlow"), $("#simpleOpeningFlow")]) root.addEventListener("click", event => {
  const button = event.target.closest("[data-flow-action]"); if (!button || button.disabled) return;
  const { flowAction: action, value } = button.dataset;
  if (action === "start" && session.stage === "setup") { cancel(); commit({ type: "start", initialBlackSeat: Number(value) }); void prepare(); }
  else if (action === "decision") decision(value);
  else if (action === "select") void place(Number(value));
  else if (action === "handoff") handoff();
  else if (action === "rule") newGame({ rule: value, workflow: session.workflow, initialBlackSeat: session.workflow === "copilot" ? null : session.initialBlackSeat });
  else if (action === "rules") { rulesOpen = false; render(); void prepare(); }
  else if (action === "retry") { cancel(); render(); void prepare(); }
  else if (action === "forbidden" && forbiddenInput) {
    const { index } = forbiddenInput; cancel();
    if (value === "confirm") commit({ type: "stone", index }); else render();
    void prepare();
  }
});
$("#recommendButton").onclick = recommend;
$("#simpleRecommendButton").onclick = recommend;
$("#undoButton").onclick = () => { if (pending >= 0 && !busy) { pending = -1; render(); return; } if (!session.events.length) return; cancel(); session = session.undo(); positionChanged(); render(); void prepare(); };
$("#simpleUndoButton").onclick = () => $("#undoButton").click();
$("#restartButton").onclick = () => newGame(); $("#retryButton").onclick = () => { cancel(); render(); void prepare(); };
$("#colorSelect").onchange = () => { cancel(); perspective = Number($("#colorSelect").value); positionChanged(true); render(); void prepare(); };
$("#timeSelect").onchange = () => { try { localStorage.setItem("gomoku-thinking-ms", $("#timeSelect").value); } catch {} };
$("#ponderToggle").onchange = () => { try { localStorage.setItem("gomoku-pondering", String($("#ponderToggle").checked)); } catch {} void syncPonder(); };
setupCustomUi({ getPosition: () => ({ board: session.board, currentColor: session.color, playerColor: session.playerColor, workflow: session.workflow }), notify, onModalChange: onModal,
  applyRecord: record => { newGame({ rule: session.rule, workflow: session.workflow, initialBlackSeat: record.playerColor === 1 ? 0 : 1, seed: record.setup }); return persist(); }
});
display = setupDisplayModes({ onNewGame: () => newGame(), onChange: () => { pending = hover = -1; render(); }, onToggleColor: () => {
  const open = !rulesOpen; cancel(); rulesOpen = open; render(); if (!open) void prepare();
} });
new ResizeObserver(() => {
  const flow = $("#simpleOpeningFlow"); document.querySelector(".app-shell").style.setProperty("--opening-flow-space", `${flow.hidden ? 0 : flow.getBoundingClientRect().height}px`);
}).observe($("#simpleOpeningFlow"));
$("#simpleColor").addEventListener("keydown", event => { if (event.key.toLowerCase() === "r") { event.preventDefault(); if (manualTurn()) void recommend(); } });
function download(data, name, type) { const url = URL.createObjectURL(new Blob([data], { type })), link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); $("#recordMenu").open = false; }
$("#exportJson").onclick = () => download(JSON.stringify(session.record(), null, 2), "wumu-opening.json", "application/json");
$("#exportSgf").onclick = () => {
  const sgf = i => String.fromCharCode(97 + i % 15, 97 + Math.floor(i / 15)), seed = session.options.seed;
  const setup = seed ? [1, 2].map(color => { const points = seed.board.flatMap((c, i) => c === color ? [sgf(i)] : []); return points.length ? `${color === 1 ? "AB" : "AW"}[${points.join("][")}]` : ""; }).join("") + `PL[${seed.sideToMove === 1 ? "B" : "W"}]` : "";
  download(`(;GM[4]FF[4]CA[UTF-8]SZ[15]RU[${RULES[session.rule]}]C[完整开局操作请使用五目 JSON。]${setup}${session.moves.map((i, n) => `;${session.colors[n] === 1 ? "B" : "W"}[${sgf(i)}]`).join("")})`, "wumu-opening.sgf", "application/x-go-sgf");
};
$("#recordFile").accept = ".json,application/json";
$("#importRecord").onclick = () => { $("#recordMenu").open = false; $("#recordFile").click(); };
$("#recordFile").onchange = async () => {
  const file = $("#recordFile").files[0]; $("#recordFile").value = ""; if (!file) return;
  try { if (file.size > 100000) throw new Error("记录文件过大"); const imported = replaySession(JSON.parse(await file.text()));
    const yes = await confirmation("导入开局记录", `${RULES[imported.rule]} · ${imported.moves.length} 手 · ${imported.events.length} 个操作。导入将替换本页当前对局。`, "导入继续");
    if (yes) { cancel(); session = imported; configureRule(); perspective = session.playerColor; positionChanged(true); notify("完整开局记录已恢复"); }
    render(); void prepare();
  } catch (error) { notify(`导入失败：${error.message}；当前对局保持不变。`, true); }
};
document.addEventListener("visibilitychange", () => { if (document.hidden) persist(); void syncPonder(); }); window.addEventListener("pagehide", persist);
document.addEventListener("keydown", event => { if (event.key === "Escape" && !document.querySelector("dialog[open]")) { cancel(); render(); void prepare(); } });
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register(new URL("./sw.js", import.meta.url), { scope: "./" }).catch(() => {});
  navigator.serviceWorker.addEventListener("message", ({ data }) => { if (data.type === "offline-ready") $("#offlineState").textContent = "已缓存 · 可离线使用"; });
}
render(); void prepare(); if (location.hash === "guide") dialogs.openGuide();
