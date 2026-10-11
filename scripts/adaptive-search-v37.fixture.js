import { hasFive } from "../game-rules.js";
import { hasExactFive, moveVerdict } from "../renju-rules.js";
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
  let best=null, probe=null, checked=[], status="有限复核";
  try {
    probe=await budget.run({...root,multiPV:2},350,"筛选候选",{root:true});
    if(!legal(board,probe.index,color,rule,allowed))throw new Error("深思返回了非法落点");best=probe;
    const batch=(probe.recommendations??[]).filter(p=>legal(board,p.index,color,rule,allowed));
    const comparable=batch.length>=2 && batch.every(p=>Number.isFinite(p.winRate) && p.winRate>=0 && p.winRate<=1 && Number.isInteger(p.depth) && p.depth===batch[0].depth)
      && new Set(batch.map(p=>p.index)).size===batch.length;
    const gap=comparable?Math.abs(batch[0].winRate-batch[1].winRate):null, initial=atomicRate(probe);
    const difficult=gap===null || gap<.10 || initial===null || initial<.10 || initial>.90 || threats.length>0;
    const refined=await budget.run({...root,multiPV:1},difficult?1400:750,"确认主线",{root:true});
    if(!legal(board,refined.index,color,rule,allowed))throw new Error("深思返回了非法落点");best=refined;
    const p=atomicRate(refined), stable=refined.index===probe.index && p!==null && initial!==null && Math.abs(p-initial)<=.06;
    if(stable && !difficult)return finish(best,"首选稳定",{gap,candidateChecks:0});
    // Use actual opponent searches on separate boards. No assumed compliance,
    // repeated blind restarts, or penalty for legitimate forcing moves.
    const candidates=[...new Set([best.index,probe.index,...batch.map(p=>p.index)])].slice(0,3);
    const per=Math.min(650,Math.floor(budget.left*.45/candidates.length));
    for(const index of candidates) {
      const next=board.slice();next[index]=color;
      if(immediateWins(next,3-color,empty,rule).length){checked.push({index,rate:0,immediateLoss:true});continue;}
      const reply=await budget.run({board:next,sideToMove:3-color,rule,allowSetup:true,multiPV:1},per,"复核对手应手",{root:false});
      if(!legal(next,reply.index,3-color,rule))throw new Error("对手复核返回了非法落点");
      const white=atomicRate(reply);checked.push({index,rate:white===null?null:1-white,reply:reply.index});
    }
    // Return to an unrestricted root search so shallow reply checks cannot
    // select a move on incomparable scores or hide a stronger unlisted move.
    const losing=new Set(checked.filter(c=>c.immediateLoss).map(c=>c.index));
    const safe=allowed.filter(i=>!losing.has(i));
    if(budget.left>180) {
      const final=await budget.run({...root,multiPV:1,allowedMoves:safe.length?safe:allowed},budget.left-60,"综合复核",{root:true});
      if(!legal(board,final.index,color,rule,allowed))throw new Error("综合复核返回了非法落点");best=final;
    }
    const q=atomicRate(best);
    status=q!==null && q<.02 ? "局面仍不利" : best.index!==probe.index ? "复核后调整" : gap!==null&&gap<.05 ? "候选仍接近" : "首选稳定";
    if(q===null || gap===null || checked.some(c=>c.rate===null))status="有限复核";
  } catch(error) {
    budget.guard();if(error.name==="AbortError" || !best)throw error;
    status=error.name==="BudgetExhausted"?"预算内完成复核":"有限复核";
  }
  return finish(best,status,{candidateChecks:checked.length,candidates:checked});
}
