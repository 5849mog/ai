const numbers = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });

export function describeSearch(stats, sideToMove, perspective) {
  const counter = value => Number.isFinite(value) && value >= 0;
  const direction = sideToMove === perspective ? 1 : -1;
  const score = Number.isFinite(stats?.evaluation) ? Math.round(stats.evaluation * direction) : null;
  const mate = /^([+-]?)M(\d+)$/.exec(stats?.mate ?? "");
  const sign = mate && (mate[1] === "-" ? -direction : direction);
  return {
    depth: counter(stats?.depth) ? String(stats.depth) : "—",
    score: mate ? `${sign > 0 ? "+" : "-"}M${mate[2]}` : score === null ? "—" : `${score > 0 ? "+" : ""}${score}`,
    nodes: counter(stats?.nodes) ? numbers.format(stats.nodes) : "—",
    speed: counter(stats?.nps) ? `${numbers.format(stats.nps)}/秒` : "—"
  };
}
