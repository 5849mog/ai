// Pure, shared calculations for fixed-position and paired-match benchmarks.
// These are descriptive measurements, not Elo or human win-rate estimators.
export function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
}

export function summarizeSearches(rows) {
  const elapsed = rows.map(row => row.wallMs ?? row.elapsedMs).filter(Number.isFinite);
  const engineElapsed = rows.map(row => row.result?.elapsed ?? row.engineElapsedMs).filter(Number.isFinite);
  const nodes = rows.map(row => row.result?.nodes ?? row.nodes).filter(Number.isFinite);
  const depths = rows.map(row => row.result?.depth ?? row.depth).filter(Number.isFinite);
  const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  return {
    searches: rows.length,
    meanWallMs: mean(elapsed),
    medianWallMs: quantile(elapsed, .5),
    p90WallMs: quantile(elapsed, .9),
    maxWallMs: elapsed.length ? Math.max(...elapsed) : null,
    meanEngineMs: mean(engineElapsed),
    totalNodes: nodes.length === rows.length ? nodes.reduce((sum, value) => sum + value, 0) : null,
    meanNodes: mean(nodes),
    meanDepth: mean(depths),
    completeNodeStats: nodes.length === rows.length
  };
}

export function summarizePositions(runs) {
  const solved = runs.filter(run => run.correct).length;
  const byKind = Object.fromEntries([...new Set(runs.map(run => run.kind))].sort().map(kind => {
    const subset = runs.filter(run => run.kind === kind);
    return [kind, {
      cases: subset.length,
      solved: subset.filter(run => run.correct).length,
      successRate: subset.length ? subset.filter(run => run.correct).length / subset.length : null
    }];
  }));
  return {
    cases: runs.length,
    solved,
    successRate: runs.length ? solved / runs.length : null,
    mateCases: runs.filter(run => run.kind === "win" || run.kind === "vcf").length,
    mateSolved: runs.filter(run => (run.kind === "win" || run.kind === "vcf") && run.correct).length,
    byKind,
    search: summarizeSearches(runs)
  };
}

export function gameScore(game, contender = "long") {
  if (game.winner === 3) return .5;
  if (!game.winner) return null;
  return game.winner === game[`${contender}Color`] ? 1 : 0;
}

export function summarizeGames(games, contender = "long") {
  const scores = games.map(game => gameScore(game, contender));
  const wins = scores.filter(score => score === 1).length;
  const draws = scores.filter(score => score === .5).length;
  const losses = scores.filter(score => score === 0).length;
  return {
    games: games.length,
    wins,
    draws,
    losses,
    points: wins + draws / 2,
    winRate: games.length ? wins / games.length : null,
    scoreRate: games.length ? (wins + draws / 2) / games.length : null
  };
}
