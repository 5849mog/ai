import { outcome } from './game-rules.js';

// Validate the actual moves before presenting any result. Records from an
// interrupted game are excluded from all win-rate denominators.
export function validateTournament(report) {
  if (!report || report.schema !== 2 || !Array.isArray(report.batches) || !report.batches.length) throw new Error('实战报告格式无效');
  const ids=new Set(), games=[];
  for(const batch of report.batches){
    if(!batch.identity || !Array.isArray(batch.identity.openings) || !Array.isArray(batch.identity.matchups) || !Array.isArray(batch.games)) throw new Error('缺少对局信息');
    const openings=new Map(batch.identity.openings.map(o=>[o.id,o.moves]));
    for(const game of batch.games){
      if(ids.has(game.id)) throw new Error('对局编号重复');ids.add(game.id);
      const start=openings.get(game.openingId);
      if(!start || !Array.isArray(start) || !Array.isArray(game.moves) || ![1,2].includes(game.longColor) || !batch.identity.matchups.some(([a,b])=>game.shortMs===a&&game.longMs===b)) throw new Error('对局配置无效');
      const board=new Uint8Array(225);let side=1,winner=0;
      for(const index of start){if(!Number.isInteger(index)||index<0||index>=225||board[index])throw new Error('开局落点无效');board[index]=side;winner=outcome(board,index);if(winner)throw new Error('开局已经结束');side=3-side;}
      for(const move of game.moves){
        if(winner||move.color!==side||!Number.isInteger(move.index)||move.index<0||move.index>=225||board[move.index]||move.budgetMs!==(side===game.longColor?game.longMs:game.shortMs))throw new Error('棋谱落子或思考时间无效');
        board[move.index]=side;winner=outcome(board,move.index);side=3-side;
      }
      if(winner!==game.winner)throw new Error('棋谱与胜负不一致');
      games.push({...game, openingMoves:start, winner, plies:start.length+game.moves.length});
    }
  }
  return {...report,games};
}
export function summarizePair(games,shortMs,longMs){
 const finished=games.filter(g=>g.winner&&g.shortMs===shortMs&&g.longMs===longMs),wins=finished.filter(g=>g.winner===g.longColor).length,draws=finished.filter(g=>g.winner===3).length;
 const losses=finished.length-wins-draws,total=finished.length;
 const colors=[1,2].map(color=>{const group=finished.filter(g=>g.longColor===color),wins=group.filter(g=>g.winner===color).length,draws=group.filter(g=>g.winner===3).length;return {color,total:group.length,wins,draws,losses:group.length-wins-draws};});
 return {shortMs,longMs,total,wins,draws,losses,winRate:total?wins/total:null,scoreRate:total?(wins+draws/2)/total:null,colors,games:finished};
}
export const budgetLabel=ms=>`${ms/1000} 秒`;
export const percent=value=>value===null?'—':`${(value*100).toFixed(1)}%`;
export function coordinate(index){return `${'ABCDEFGHIJKLMNO'[index%15]}${15-Math.floor(index/15)}`;}
