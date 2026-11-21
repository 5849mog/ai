import { describePosition, trendGeometry } from "./position-analysis.js";
import { coordinate } from "./board-view.js";
import { syncSvgChildren } from "./svg-view.js";

const NS = "http://www.w3.org/2000/svg";
const svgNode = (name, attributes) => {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
};
const curve = points => points.reduce((path, point, i) => {
  if (!i) return `M${point.x},${point.y}`;
  const previous = points[i - 1], middle = (previous.x + point.x) / 2;
  return path + ` C${middle},${previous.y} ${middle},${point.y} ${point.x},${point.y}`;
}, "");
const positionPercent = (point, winner) => {
  if (point?.winRate == null) return null;
  const percent = Math.round(point.winRate * 100);
  return !winner && !point.forcedColor ? Math.min(99, Math.max(1, percent)) : percent;
};

export function renderSimpleWinRate(root, analysis, winner, { available = true, waiting = "等待评估", ending } = {}) {
  const percent = available ? positionPercent(analysis.current, winner) : null;
  const black = analysis.playerColor === 1 ? percent : percent == null ? null : 100 - percent;
  const text = winner ? winner === 3 ? "和棋" : `${winner === 1 ? "黑" : "白"}胜`
    : percent == null ? waiting : `黑 ${black}% · 白 ${100 - black}%`;
  const label = winner ? `结果 · ${text}` : `胜率 · ${text}`;
  const display = ending?.short ? `${label}｜余 ${ending.short}` : label;
  if (root.textContent !== display) root.textContent = display;
  const description = winner ? `对局结果：${text}` : `AI 估算胜率：${text}`;
  root.setAttribute("aria-label", ending?.short ? `${description}。终局推演：${ending.text}` : description);
  root.title = ending?.short ? `终局推演：${ending.text}` : "";
  root.dataset.state = winner ? "finished" : percent == null ? "waiting" : "rated";
}

export function createAnalysisView(root) {
  const select = selector => root.querySelector(selector);
  const bar = select("#winRateBar"), fill = select("#winRateFill"), svg = select("#positionTrend");
  const detail = select("#trendDetail"), plot = svg.closest(".trend-plot");
  let previousSignature = "", points = [], active = -1, focusReading = false, perspective = 1;
  function inspect(index = active) {
    active = index;
    const point = points[index];
    if (!detail) return;
    detail.hidden = !point;
    if (!point) { plot.style.removeProperty("--trend-inspect-x"); return; }
    plot.style.setProperty("--trend-inspect-x", `${point.percentX}%`);
    const pos = point.ply === 0 ? "初始局面" : `第 ${point.ply} 手${point.coord ? ` · ${point.coord}` : ""}`;
    const label = `${pos} · ${perspective === 1 ? "黑" : "白"} ${positionPercent(point, point.kind === "result")}%`;
    if (detail.textContent !== label) detail.textContent = label;
  }
  if (detail) {
    plot.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight Home End Escape");
    plot.setAttribute("aria-describedby", "trendInstructions");
    plot.addEventListener("focus", () => {
      focusReading = true; detail.setAttribute("aria-live", "polite");
      if (active < 0 && points.length) inspect(points.length - 1);
    });
    plot.addEventListener("blur", () => { focusReading = false; detail.setAttribute("aria-live", "off"); inspect(-1); });
    function inspectPointer(event) {
      if (!points.length) return;
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      const percent = (event.clientX - rect.left) / rect.width * 100;
      inspect(points.reduce((best, point, i) => Math.abs(point.percentX - percent) < Math.abs(points[best].percentX - percent) ? i : best, 0));
    }
    svg.addEventListener("pointermove", event => { if (event.pointerType !== "touch") inspectPointer(event); });
    svg.addEventListener("pointerleave", () => { if (!focusReading) inspect(-1); });
    svg.addEventListener("click", () => { if (points.length) plot.focus({ preventScroll: true }); });
    plot.addEventListener("keydown", event => {
      if (!points.length || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const next = event.key === "Home" ? 0 : event.key === "End" ? points.length - 1
        : event.key === "ArrowLeft" ? Math.max(0, active - 1)
        : event.key === "ArrowRight" ? Math.min(points.length - 1, active + 1)
        : event.key === "Escape" && active >= 0 ? -1 : null;
      if (next === null) return;
      event.preventDefault(); inspect(next);
    });
    svg.addEventListener("pointerup", event => { if (event.pointerType === "touch") inspectPointer(event); });
  }
  return {
    render(analysis, winner) {
      const point = analysis.current;
      const signature = JSON.stringify([analysis.history, analysis.moves.length, analysis.playerColor, winner]);
      if (signature === previousSignature) return;
      previousSignature = signature;
      const known = point?.winRate != null;
      const percent = positionPercent(point, winner);
      root.dataset.state = winner ? "finished" : known ? "rated" : "waiting";
      select("#positionJudgement").textContent = describePosition(point, analysis.playerColor, winner);
      select("#positionContext").textContent = winner ? "对局已结束" : `第 ${analysis.moves.length} 手`;
      select("#playerWinRate").textContent = known ? `${percent}%` : "—";
      select("#aiWinRate").textContent = known ? `${100 - percent}%` : "—";
      bar.setAttribute("aria-label", known ? `引擎估算胜率：你 ${percent}%，AI ${100 - percent}%` : winner === 3 ? "平局，对局结束" : "当前局势等待评估");
      if (known) bar.setAttribute("aria-valuenow", percent); else bar.removeAttribute("aria-valuenow");
      bar.setAttribute("aria-valuetext", known ? `${percent}%` : "等待有效评估");
      fill.style.width = known ? `${percent}%` : "0%";
      select("#winRateCaption").textContent = winner ? winner === 3 ? "平局" : "最终结果" : known ? "引擎估算胜率" : "等待评估";
      const geometry = trendGeometry(analysis.history, analysis.moves.length);
      const lockedPly = points[active]?.ply;
      perspective = analysis.playerColor;
      points = geometry.groups.flat().map(point => ({ ...point,
        percentX: (point.x - geometry.left) / (geometry.right - geometry.left) * 100,
        coord: point.ply > 0 && Number.isInteger(analysis.moves[point.ply - 1]) ? coordinate(analysis.moves[point.ply - 1]) : ""
      }));
      if (detail) {
        plot.tabIndex = points.length ? 0 : -1;
        const previous = points.findIndex(point => point.ply === lockedPly);
        inspect(previous < 0 && lockedPly !== undefined && focusReading ? points.length - 1 : previous);
      }
      const layer = select("#trendData"), children = [];
      for (const group of geometry.groups) {
        if (group.length > 1) {
          const path = curve(group);
          children.push(svgNode("path", { d: `${path} L${group.at(-1).x},37 L${group[0].x},37 Z`, class: "trend-area", "data-view-key": `area-${group[0].ply}` }),
            svgNode("path", { d: path, pathLength: 1, class: "trend-line", "data-view-key": `line-${group[0].ply}` }));
        }
        if (group.length === 1) children.push(svgNode("circle", { cx: group[0].x, cy: group[0].y, r: 2, class: "trend-point", "data-view-key": `point-${group[0].ply}` }));
      }
      if (known) {
        const last = geometry.groups.flat().find(item => item.ply === analysis.moves.length);
        if (last) children.push(svgNode("circle", { cx: last.x, cy: last.y, r: 5, class: "trend-halo" }),
          svgNode("circle", { cx: last.x, cy: last.y, r: 2.5, class: "trend-current" }));
      }
      syncSvgChildren(layer, children);
      const currentPercent = (geometry.currentX - geometry.left) / (geometry.right - geometry.left) * 100;
      select("#trendCurrentStep").style.left = `clamp(32px, ${currentPercent}%, calc(100% - 32px))`;
      select("#trendCurrentStep").textContent = `${analysis.moves.length} 手`;
      select("#trendStartStep").style.display = analysis.moves.length === 0 ? "none" : "";
      select("#trendEndStep").textContent = `${geometry.span}`;
      select("#trendEndStep").style.display = analysis.moves.length === geometry.span ? "none" : "";
      select("#trendEmpty").style.display = geometry.groups.length ? "none" : "";
      select("#trendEmpty").textContent = winner === 3 ? "平局收官" : analysis.moves.length ? "暂无可用评估" : "取得局面评估后显示走势";
      svg.setAttribute("aria-label", `你的估算胜率走势，上方利于你，下方利于 AI。共 ${analysis.moves.length} 手，${analysis.history.filter(item => item.winRate != null).length} 个已评估局面。`);
      root.dataset.ply = String(analysis.moves.length);
      root.dataset.points = String(analysis.history.length);
    }
  };
}
