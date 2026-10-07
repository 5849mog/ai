import { RULES, colorName, coordinate } from "./opening-session.js";

// This is the external player's seat, not the color currently being placed.
// RIF's tentative Black places B-W-B, even though one stone is white.
export function openingMarks(session) {
  if (session.options.seed || !["rif", "taraguchi10"].includes(session.rule) || session.moves.length > 6) return [];
  return session.moves.map((index, i) => ({ index, color: session.colors[i], label: String(i + 1) }));
}
export function chosenProposal(session) {
  const selected = session.events.findLastIndex(event => event.type === "select");
  if (selected < 0) return null;
  let start = selected;
  while (start > 0 && session.events[start - 1].type === "offer") start--;
  const offers = session.events.slice(start, selected).map(event => event.index);
  return { index: session.events[selected].index, label: `A${offers.indexOf(session.events[selected].index) + 1}` };
}
export function openingFlow(session, { busy = false, state = "ready", advice = null, rulesOpen = false, forbidden = null } = {}) {
  const actions = [], add = (action, value, label, suggested = false) => actions.push({ action, value: String(value), label, suggested });
  if (forbidden) {
    add("forbidden", "confirm", "确认实战落子 · 白胜"); add("forbidden", "cancel", "录错了 · 返回");
    return { title: `黑棋${forbidden.reason}禁手`, note: "若是外部实际落子可确认；否则返回重新录入。", actions };
  }
  if (rulesOpen) {
    for (const [rule, label] of Object.entries(RULES)) add("rule", rule, label, rule === session.rule);
    add("rules", "close", "返回当前棋局");
    return { title: "选择本局规则", note: session.workflow === "duel" ? "点选规则会开始新的 AI 对弈局。" : "点选规则会开始附身新局，执色与开局角色在棋盘旁选择。", actions };
  }
  if (session.stage === "setup") {
    if (session.rule === "rif") {
      add("start", 0, "我摆前三子 · 暂执黑"); add("start", 1, "对方摆前三子 · 我暂执白");
      return { title: "这局谁摆前三子？", note: "同一人按黑 → 白 → 黑摆三子；之后另一方有换色权。", actions };
    }
    add("start", 0, "我最开始执黑"); add("start", 1, "我最开始执白");
    return { title: "这局你最开始执什么色？", note: session.rule === "taraguchi10" ? "每个换色节点都在这里按实战确认；AI 只替你操作。" : "先录入实际开局，再点「AI 接手」。", actions };
  }
  if (session.winner) return { title: session.description(), note: "点「新局」重新选择本局角色，或点「悔棋」撤回。", actions };
  if (state === "error") { add("retry", "", "重试 AI"); return { title: "AI 暂未完成操作", note: "当前局面已保留；可以重试、悔棋或重新开局。", actions }; }
  const copilot = session.workflow === "copilot", mine = session.actor === 0;
  const side = session.playerColor ? `你执${colorName(session.playerColor)}` : "待选执色";
  const copy = copilot && session.rule === "rif" && session.initialBlackSeat === 0 && session.moves.length === 3
    ? "按棋盘 1黑 → 2白 → 3黑照搬开局。" : "";
  if (session.decision) {
    add("decision", "keep", `不交换 · 你执${colorName(session.playerColor)}`, advice?.choice === "keep");
    add("decision", "swap", `交换 · 你执${colorName(3 - session.playerColor)}`, advice?.choice === "swap");
    if (session.stage === "route4") add("decision", "ten", "提出十打");
    return { title: mine ? busy ? "AI 正在比较执色…" : `轮到你${session.stage === "route4" ? "选择路线" : "决定是否交换"}` : `对方${session.stage === "route4" ? "选择了哪条路线？" : "是否交换了执色？"}`,
      note: copy + (mine ? advice?.choice ? `AI 建议${advice.choice === "swap" ? "交换" : "不交换"}；点按钮确认实际选择。` : "点按钮确认实际选择；换色只改变归属，不改变棋子颜色。" : "按对方实际选择点击；换色后后续操作自动按新执色安排。"), actions };
  }
  if (copilot && !session.copilotReady) {
    add("handoff", "", "开局录完 · AI 接手");
    return { title: `${side} · 录入实际开局`, note: `当前按${colorName(session.color)}棋录入，不用手动选色；录完后让 AI 接手你的棋色。`, actions };
  }
  if (session.offerCount) return { title: copilot && mine ? "AI 正在生成候选点…" : `录入对方候选 A${session.candidates.length + 1} · ${session.candidates.length}/${session.offerCount}`,
    note: "候选按 A1、A2…标记，选定前不算实子；只需点外部候选的位置。", actions };
  if (session.stage === "choose") {
    if ((!copilot || !mine) && session.candidates.length <= 2) session.candidates.forEach((index, i) => add("select", index, `A${i + 1} · ${coordinate(index)}`));
    return { title: copilot && mine ? "AI 正在选择候选并生成白棋第 6 手…" : copilot ? "对方选中了哪个候选？" : "选定第五手候选",
      note: "点击候选标记或对应按钮，未选中的候选自动移除。", actions };
  }
  if (copilot && session.rule === "rif" && ["b1", "w2", "b3"].includes(session.stage)) return {
    title: mine ? "AI 正在生成你的三子开局…" : `录入对方前三子 · 第 ${session.moves.length + 1}/3 子`,
    note: mine ? "生成后按棋子上的 1、2、3，以黑 → 白 → 黑顺序照搬。" : `顺序固定黑 → 白 → 黑；现在点入第 ${session.moves.length + 1} 子（${colorName(session.color)}棋）。`, actions };
  if (copilot && mine) return { title: `AI 正在替你下${colorName(session.color)}棋第 ${session.moves.length + 1} 手…`, note: "落子会直接显示在棋盘上，无需点推荐。", actions };
  const last = session.events.at(-1), selected = chosenProposal(session);
  const reply = copilot && last?.automatic && last.type === "stone"
    ? `${selected && session.moves.length === 6 ? `AI 选择 ${selected.label}；` : ""}AI ${colorName(session.colors.at(-1))}棋第 ${session.moves.length} 手：${coordinate(last.index)}。` : "";
  return { title: `${side} · ${copilot ? "录入对方" : "录入"}${colorName(session.color)}棋第 ${session.moves.length + 1} 手`,
    note: reply + (reply ? "照搬后继续录入对方实战落点。" : "点入实战落点，颜色会按规则自动安排。"), actions };
}
