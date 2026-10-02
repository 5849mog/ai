const numbers = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });

export function describeSearch(stats, sideToMove, aiColor) {
  const present = value => Number.isFinite(value);
  const score = present(stats?.evaluation) ? stats.evaluation * (sideToMove === aiColor ? 1 : -1) : null;
  return {
    depth: present(stats?.depth) ? String(stats.depth) : "—",
    score: score === null ? "—" : `${score > 0 ? "+" : ""}${Math.round(score)}`,
    nodes: present(stats?.nodes) ? numbers.format(stats.nodes) : "—",
    speed: present(stats?.nps) ? `${numbers.format(stats.nps)}/秒` : "—"
  };
}
