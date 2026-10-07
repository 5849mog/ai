import { describePosition, trendGeometry } from "./position-analysis.js";

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

export function renderSimpleWinRate(root, analysis, winner, { available = true, waiting = "等待评估" } = {}) {
  const percent = available ? positionPercent(analysis.current, winner) : null;
  const black = analysis.playerColor === 1 ? percent : percent == null ? null : 100 - percent;
  const text = winner ? winner === 3 ? "和棋" : `${winner === 1 ? "黑" : "白"}胜`
    : percent == null ? waiting : `黑 ${black}% · 白 ${100 - black}%`;
  root.textContent = `胜率 · ${text}`;
  root.dataset.state = winner ? "finished" : percent == null ? "waiting" : "rated";
}

export function createAnalysisView(root) {
  const select = selector => root.querySelector(selector);
  const bar = select("#winRateBar"), fill = select("#winRateFill"), svg = select("#positionTrend");
  let previousSignature = "";
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
      fill.style.width = known ? `${percent}%` : "0%";
      select("#winRateCaption").textContent = winner ? winner === 3 ? "平局" : "最终结果" : known ? "引擎估算胜率" : "等待评估";
      const geometry = trendGeometry(analysis.history, analysis.moves.length);
      const layer = select("#trendData"); layer.replaceChildren();
      for (const group of geometry.groups) {
        if (group.length > 1) {
          const path = curve(group);
          layer.append(svgNode("path", { d: `${path} L${group.at(-1).x},37 L${group[0].x},37 Z`, class: "trend-area" }),
            svgNode("path", { d: path, class: "trend-line" }));
        }
        if (group.length === 1) layer.append(svgNode("circle", { cx: group[0].x, cy: group[0].y, r: 2, class: "trend-point" }));
      }
      if (known) {
        const last = geometry.groups.flat().find(item => item.ply === analysis.moves.length);
        if (last) layer.append(svgNode("circle", { cx: last.x, cy: last.y, r: 5, class: "trend-halo" }),
          svgNode("circle", { cx: last.x, cy: last.y, r: 2.5, class: "trend-current" }));
      }
      const currentPercent = (geometry.currentX - geometry.left) / (geometry.right - geometry.left) * 100;
      select("#trendCurrentStep").style.left = `clamp(32px, ${currentPercent}%, calc(100% - 32px))`;
      select("#trendCurrentStep").textContent = `${analysis.moves.length} 手`;
      select("#trendStartStep").style.display = analysis.moves.length === 0 ? "none" : "";
      select("#trendEndStep").textContent = `${geometry.span}`;
      select("#trendEndStep").style.display = analysis.moves.length === geometry.span ? "none" : "";
      select("#trendEmpty").style.display = geometry.groups.length ? "none" : "";
      select("#trendEmpty").textContent = winner === 3 ? "平局收官" : "落子后，走势将在这里展开";
      svg.setAttribute("aria-label", `你的估算胜率走势，上方利于你，下方利于 AI。共 ${analysis.moves.length} 手，${analysis.history.filter(item => item.winRate != null).length} 个已评估局面。`);
      root.dataset.ply = String(analysis.moves.length);
      root.dataset.points = String(analysis.history.length);
    }
  };
}
