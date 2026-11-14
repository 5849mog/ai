// Only formal, unseeded openings constrain the first black move to center.
// Do not infer a forced move from other stages or from a custom position.
export function forcedOpeningMove(session) {
  if (!session || session.options.seed || !['rif','taraguchi10'].includes(session.rule) || session.stage !== 'b1' || session.moves.length || session.board.some(Boolean)) return null;
  return session.canPoint(112) ? {type:'stone',index:112} : null;
}
