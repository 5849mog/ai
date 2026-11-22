import { colorName, coordinate, isLocalMatch, RULES } from "./opening-session.js";
import { BLACK, CELL_COUNT, WHITE } from "./game-rules.js";

export function describeBoard({ session, cursor, workflow, allowed }) {
  let black = 0, white = 0;
  for (const stone of session.board) {
    if (stone === BLACK) black++;
    if (stone === WHITE) white++;
  }
  const move = index => index >= 0 ? `${coordinate(index)} · ${colorName(session.board[index])}棋` : "—";
  return [
    ["规则", RULES[session.rule]],
    ["方式", workflow],
    ["当前阶段", session.description()],
    [isLocalMatch(session) ? "甲方执色" : "我方执色", session.playerColor ? `${colorName(session.playerColor)}棋` : "待定"],
    ["下一着", session.winner ? "已结束" : session.stage === "choose" ? "白方选案" : session.offerCount ? "黑方提案" : session.decision || session.stage === "setup" ? "等待选择" : `${colorName(session.color)}棋`],
    ["最近落子", move(session.lastMove)],
    ["上一着", move(session.moves.at(-2) ?? -1)],
    ["已走手数", session.moves.length],
    ["盘面棋子", `黑 ${black} · 白 ${white}`],
    ["空交点", CELL_COUNT - black - white],
    ["当前可落点", allowed ?? "—"],
    ["当前选点", cursor >= 0 ? coordinate(cursor) : "—"]
  ];
}

export function setupBoardFacts({ getSession, getCursor, workflowLabel, getHints, navigator, notify }) {
  let stamp = "";
  const views = [...document.querySelectorAll("[data-board-facts]")].map((root, index) => {
    const id = `boardFacts-${index}`;
    root.innerHTML = `<button type="button" data-facts-toggle data-ui-icon="board" aria-expanded="false" aria-controls="${id}">棋局速览</button>
      <section class="board-facts" id="${id}" aria-label="棋局速览" hidden><dl></dl>
      <button type="button" data-facts-copy data-ui-icon="copy">复制局面摘要</button></section>`;
    const panel = root.querySelector("section"), toggle = root.querySelector("[data-facts-toggle]");
    const list = panel.querySelector("dl"), copy = panel.querySelector("[data-facts-copy]");
    copy.hidden = typeof navigator.clipboard?.writeText !== "function";
    toggle.onclick = () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute("aria-expanded", String(!panel.hidden));
      render();
    };
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(values().map(([label, value]) => `${label} ${value}`).join("\n"));
        notify("已复制局面摘要");
      } catch { notify("浏览器暂时无法复制局面摘要", true); }
    };
    return { panel, list };
  });
  function values() {
    const session = getSession(), position = getHints();
    return describeBoard({ session, cursor: getCursor(), workflow: workflowLabel[session.workflow],
      allowed: position?.enabled ? position.allowedMoves.length : null });
  }
  function render() {
    if (!views.some(({ panel }) => !panel.hidden)) return;
    const rows = values(), key = JSON.stringify(rows);
    if (key === stamp) return;
    stamp = key;
    for (const { list } of views) {
      const nodes = rows.flatMap(([label, value]) => {
        const term = document.createElement("dt"), description = document.createElement("dd");
        term.textContent = label;
        description.textContent = value;
        return [term, description];
      });
      list.replaceChildren(...nodes);
    }
  }
  return { render };
}
