export const REPORT_SCHEMA_VERSION = 1;

function requireNumber(value, label, { integer = false } = {}) {
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value))) {
    throw new Error(`报告字段无效：${label}`);
  }
}

export function validateStrengthReport(report) {
  if (!report || typeof report !== "object" || report.version !== REPORT_SCHEMA_VERSION) {
    throw new Error("报告版本不受支持");
  }
  if (typeof report.complete !== "boolean" || !Array.isArray(report.positionRuns) || !Array.isArray(report.games)) {
    throw new Error("报告结构不完整");
  }
  if (!report.summary || typeof report.summary !== "object" || !report.summary.positions || !report.summary.matches || !report.summary.search) {
    throw new Error("报告缺少汇总数据");
  }
  for (const [index, run] of report.positionRuns.entries()) {
    if (typeof run.fixtureId !== "string" || typeof run.correct !== "boolean") throw new Error(`第 ${index + 1} 条局面记录无效`);
    requireNumber(run.budgetMs, `positionRuns[${index}].budgetMs`);
    requireNumber(run.index, `positionRuns[${index}].index`, { integer: true });
    if (run.index < 0 || run.index >= 225) throw new Error("落点坐标超出棋盘");
  }
  for (const [index, game] of report.games.entries()) {
    if (typeof game.id !== "string" || typeof game.openingId !== "string") throw new Error(`第 ${index + 1} 盘对局记录无效`);
    if (![1, 2].includes(game.longColor) || ![1, 2, 3].includes(game.winner)) throw new Error("对局执色或结果无效");
    requireNumber(game.plies, `games[${index}].plies`, { integer: true });
  }
  for (const [budget, row] of Object.entries(report.summary.positions)) {
    requireNumber(Number(budget), "时间预算");
    for (const key of ["cases", "solved", "successRate", "mateCases", "mateSolved"]) requireNumber(row[key], `positions.${budget}.${key}`);
    for (const key of ["meanWallMs", "p90WallMs", "meanEngineMs", "meanNodes", "meanDepth"]) requireNumber(row.search?.[key], `positions.${budget}.search.${key}`);
  }
  const matches = report.summary.matches;
  for (const key of ["games", "wins", "draws", "losses", "winRate", "scoreRate"]) requireNumber(matches[key], `matches.${key}`);
  if (matches.games !== report.games.length || matches.wins + matches.draws + matches.losses !== matches.games) {
    throw new Error("对局明细与汇总不一致");
  }
  for (const side of ["short", "long"]) {
    for (const key of ["searches", "meanWallMs", "p90WallMs", "meanEngineMs", "meanNodes", "meanDepth"]) {
      requireNumber(report.summary.search[side]?.[key], `search.${side}.${key}`);
    }
  }
  return report;
}

export function positionBudgetRows(report) {
  return Object.entries(report.summary.positions)
    .map(([budgetMs, row]) => ({ budgetMs: Number(budgetMs), ...row }))
    .sort((a, b) => a.budgetMs - b.budgetMs);
}

export function gameOutcome(game) {
  if (game.winner === 3) return { key: "draw", label: "和棋", detail: "双方和棋" };
  const longWon = game.winner === game.longColor;
  return {
    key: longWon ? "win" : "loss",
    label: longWon ? "长预算胜" : "长预算负",
    detail: `${game.winner === 1 ? "黑方" : "白方"}胜`
  };
}

export function boardCoordinate(index) {
  const files = "ABCDEFGHJKLMNOP";
  return `${files[index % 15]}${Math.floor(index / 15) + 1}`;
}

export function formatNumber(value, maximumFractionDigits = 1) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits }).format(value);
}

export function formatPercent(value, digits = 0) {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).format(date);
}
