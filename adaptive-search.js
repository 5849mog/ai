import { hasFive } from "./game-rules.js";
import { hasExactFive, moveVerdict } from "./renju-rules.js";
export const ADAPTIVE_MODE = "adaptive";
export const ADAPTIVE_LIMIT_MS = 6000;
export const thinkingSettings = value => value === ADAPTIVE_MODE || value === "30000"
  ? {mode: ADAPTIVE_MODE, timeMs: ADAPTIVE_LIMIT_MS} : {mode: "fixed", timeMs: Number(value)};
export class BudgetExhausted extends Error { constructor() { super("本次深思预算已用完"); this.name = "BudgetExhausted"; } }
export function createThinkingBudget(search, { now = () => performance.now(), isCancelled = () => false,
  cancelSearch = () => {}, onProgress = () => {}, signal, budgetMs = ADAPTIVE_LIMIT_MS } = {}) {
  const limit = Math.min(ADAPTIVE_LIMIT_MS, Math.max(1, budgetMs)), started = now(), traces = [];
  const guard = () => { if(signal?.aborted || isCancelled()) throw new DOMException("深思已取消", "AbortError"); };
  return {
    traces, guard, get left() { return Math.max(0, limit - (now() - started)); },
    async run(options, requested, label, context = {}) {
      guard(); const left = this.left, timeMs = Math.min(Math.floor(requested), Math.floor(left - 50));
      if(timeMs < 20) throw new BudgetExhausted();
      onProgress(label); let timer;
      const expiry = new Promise((_, reject) => { timer = setTimeout(() => {
        // Reject the deadline first; cancelling the Worker also rejects its job.
        reject(new BudgetExhausted()); cancelSearch();
      }, Math.ceil(left)); });
      try {
        const result = await Promise.race([search({...options, board: options.board.slice(), timeMs}, context), expiry]);
        guard(); traces.push({label, timeMs, index: result.index, depth: result.assessment?.depth ?? null}); return result;
      } finally { clearTimeout(timer); }
    },
    finish(result, status, extra = {}) {
      guard(); const elapsed = Math.max(0, now() - started);
      return {...result, elapsed, adaptive: {budgetMs:limit,elapsedMs:elapsed,status,searches:traces.length,...extra}};
    }
  };
}
export function atomicRate(result, index = result?.index) {
  const a=result?.assessment, p=a?.winRate;
  return a?.bestIndex===index && Number.isFinite(p) && p>=0 && p<=1 ? p : null;
}
export function immediateWins(board, color, points, rule) {
  const copy=Uint8Array.from(board), wins=[];
  for(const index of points) {
    if(copy[index])continue;copy[index]=color;
    const five=rule!=="freestyle" && color===1 ? hasExactFive(copy,index) : hasFive(copy,index%15,Math.floor(index/15),color);
    copy[index]=0;
    if(five && !moveVerdict(board,index,color,rule).forbidden)wins.push(index);
  }
  return wins;
}
const legal = (board,index,color,rule,allowed) => Number.isInteger(index) && index>=0 && index<225 && !board[index]
  && (!allowed || allowed.includes(index)) && !moveVerdict(board,index,color,rule).forbidden;
export async function thinkAdaptive(options,search,settings={}) {
  const budget=createThinkingBudget(search,settings), {sideToMove:color,rule="freestyle"}=options;
  const board=Uint8Array.from(options.board), empty=Array.from(board,(v,i)=>v?-1:i).filter(i=>i>=0);
  const allowed=(options.allowedMoves??empty).filter(i=>legal(board,i,color,rule));
  if(!allowed.length)throw new Error("当前没有合法落点");
  const finish=(r,status,extra={})=>budget.finish(r,status,extra);
  const wins=immediateWins(board,color,allowed,rule);
  if(wins.length)return finish({index:wins[0]},"已确认成五",{reason:"immediate-win"});
  if(allowed.length===1)return finish({index:allowed[0]},"唯一合法落点",{reason:"only-legal"});
  const threats=immediateWins(board,3-color,empty,rule);
  if(threats.length===1 && allowed.includes(threats[0]))return finish({index:threats[0]},"必须防守",{reason:"unique-immediate-block"});
  const root={...options,board,allowedMoves:allowed,sideToMove:color,rule,allowSetup:options.allowSetup??true};
  let best=null, probe=null, status="有限复核";
  const mate = r => Boolean(r && r.assessment?.bestIndex===r.index && /^\+?M\d+$/.test(r.assessment.mate??""));
  const depth = r => r && r.assessment?.bestIndex===r.index && Number.isInteger(r.assessment.depth) ? r.assessment.depth : null;
  try {
    // A sub-second budget cannot support a multi-stage verification pipeline.
    // Let the native alpha-beta tree compare both sides at the original root.
    if(budget.left>1200) {
      probe=await budget.run({...root,multiPV:2},Math.min(300,budget.left*.08),"筛选候选",{root:true});
      if(!legal(board,probe.index,color,rule,allowed))throw new Error("深思返回了非法落点");best=probe;
      // Matching shallow moves / rounded probabilities are not a stopping proof.
      if(mate(probe))return finish(best,"已找到杀棋",{strategy:"root-continuation",reason:"mate",candidateChecks:0});
    }
    const final=await budget.run({...root,multiPV:1},budget.left,"深入比较攻防",{root:true});
    if(!legal(board,final.index,color,rule,allowed))throw new Error("深思返回了非法落点");
    // A partial or shallower restart must not replace a completed deeper root.
    if(!best || mate(final) || depth(best)===null || depth(final)===null || depth(final)>=depth(best))best=final;
    const q=atomicRate(best), initial=atomicRate(probe);
    status=mate(best)?"已找到杀棋":q===null?"有限复核":q<.02?"局面仍不利"
      :probe && best.index!==probe.index?"复核后调整"
        :probe && depth(best)>depth(probe) && initial!==null && Math.abs(q-initial)<=.06?"主线加深":"预算内完成搜索";
  } catch(error) {
    budget.guard();if(error.name==="AbortError" || !best)throw error;
    status=error.name==="BudgetExhausted"?"预算内完成复核":"有限复核";
  }
  return finish(best,status,{strategy:"root-continuation",candidateChecks:0,
    probeIndex:probe?.index??null,probeDepth:depth(probe),finalDepth:depth(best),
    rootBudgetMs:budget.traces.reduce((sum,t)=>sum+t.timeMs,0)});
}
