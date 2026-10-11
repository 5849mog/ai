import { replaySession } from "./opening-session.js";
import { adviseOpening } from "./opening-advisor.js";
import { moveVerdict } from "./renju-rules.js";
const abort = signal => {if(signal?.aborted)throw new DOMException("复盘已取消","AbortError");};
const rate = result => {const p=result.assessment?.winRate;if(!Number.isFinite(p)||p<0||p>1)throw new Error("尚无完整评估");return p;};

// Opening decisions have different owners and objectives from ordinary moves.
// Compare actual proposal groups by their weakest fifth, never by a sum or
// average; white can choose the strongest reply. Early exchanges remain
// explicitly provisional while later exchange rights are still available.
export async function analyzeOpeningReview(review,search,{signal,timeMs=1000,onProgress=()=>{}}={}) {
  const rows=[],cache=new Map();
  const run=async options=>{abort(signal);const result=await search({...options,rule:review.rule,allowSetup:true});abort(signal);return result;};
  async function whiteRate(board,budget) {
    const key=board.join("")+":"+budget;
    if(!cache.has(key))cache.set(key,rate(await run({board:board.slice(),sideToMove:2,timeMs:budget})));
    return cache.get(key);
  }
  async function fifths(board,points,budget) {
    const values=[];
    for(const index of points) {
      if(board[index] || moveVerdict(board,index,1,review.rule).forbidden)throw new Error("提案包含非法第五手");
      const next=board.slice();next[index]=1;values.push({index,white:await whiteRate(next,budget)});
    }
    return values;
  }
  const groupRate=values=>1-Math.max(...values.map(v=>v.white));
  async function offered(s,budget) {
    const advice=await adviseOpening(s,run,budget,{includeAlternative:false});
    return {points:advice.points,value:groupRate(await fifths(s.board,advice.points,budget))};
  }
  async function routeValues(s) {
    const ten=replaySession(s.record());ten.apply({type:"decision",choice:"ten"});
    const group=await offered(ten,timeMs);
    const normal=replaySession(s.record());normal.apply({type:"decision",choice:"keep"});
    const advice=await adviseOpening(normal,run,timeMs,{includeAlternative:false});normal.apply({type:"stone",index:advice.points[0]});
    const white=await whiteRate(normal.board,timeMs),normalValue=Math.min(white,1-white);
    return {keep:normalValue,swap:normalValue,ten:group.value};
  }
  for(const [n,node] of (review.openings??[]).entries()) {
    abort(signal);const s=replaySession(node.record);
    let row={...node,loss:null,best:null,points:[],beforeRate:null,afterRate:null,note:""};
    try {
      if(node.kind==="three") {
        let black;
        if(s.rule==="rif") {s.apply({type:"decision",choice:"keep"});black=(await adviseOpening(s,run,timeMs)).blackRate;}
        else {const result=await run({board:s.board.slice(),sideToMove:s.color,timeMs});const p=rate(result);black=s.color===1?p:1-p;}
        if(!Number.isFinite(black)||black<0||black>1)throw new Error("尚无完整评估");
        row.blackRate=black;row.note=`黑方阶段估算 ${(black*100).toFixed(1)}%，白方 ${((1-black)*100).toFixed(1)}%。${s.rule==="rif"?"已考虑有限第四手与两打候选；交换方可选色。":"后续仍可换色与选择十打，不能据此判定三子布局失误。"}`;
      } else if(node.kind==="group") {
        const alternative=await offered(s,timeMs),actual=groupRate(await fifths(s.board,node.points,timeMs));
        row.points=alternative.points;row.beforeRate=alternative.value;row.afterRate=actual;
        row.loss=Math.max(0,alternative.value-actual);row.note="从黑方角度比较整组最弱候选；白方可选择对黑方最不利的一点。";
      } else if(s.stage==="choose") {
        const values=await fifths(s.board,s.candidates,timeMs);values.sort((a,b)=>b.white-a.white);
        row.best=values[0].index;row.points=[row.best];row.beforeRate=values[0].white;row.afterRate=values.find(v=>v.index===node.event.index).white;
        row.loss=Math.max(0,row.beforeRate-row.afterRate);row.note="从选点方（白方）角度逐一比较实际候选；候选不会成为多枚实子。";
      } else if(s.decision) {
        let values;
        if(s.stage==="route4") {values=await routeValues(s);row.note="有限比较十打整组与平衡第五手；普通路线按后续选色权保守估计，保持/交换按同等近似处理。";}
        else {
          let black;
          if(s.rule==="rif"&&s.stage==="swap3") {const next=replaySession(s.record());next.apply({type:"decision",choice:"keep"});black=(await adviseOpening(next,run,timeMs)).blackRate;}
          else {const result=await run({board:s.board.slice(),sideToMove:s.color,timeMs});const p=rate(result);black=s.color===1?p:1-p;}
          if(!Number.isFinite(black)||black<0||black>1)throw new Error("尚无完整评估");
          const keep=s.actor===s.blackSeat?black:1-black;values={keep,swap:1-keep};
          row.note=s.rule==="rif"?"已考虑有限第四手、两打与白方选点的延续。":s.stage==="swap5"?"第五手后比较选色，后续已无开局换色权。":"当前局面的阶段建议；后续仍有换色权，不计为确定失误。";
        }
        row.choices=values;row.choice=Object.keys(values).sort((a,b)=>values[b]-values[a])[0];row.beforeRate=values[row.choice];row.afterRate=values[node.event.choice];
        if(s.rule==="rif"||["route4","swap5"].includes(s.stage))row.loss=Math.max(0,row.beforeRate-row.afterRate);
      } else if(s.rule==="rif"&&s.stage==="w4") {
        const advice=await adviseOpening(s,run,timeMs);row.best=advice.points[0];row.points=[row.best];
        const value=async index=>{const next=replaySession(s.record());next.apply({type:"stone",index});return 1-(await offered(next,timeMs)).value;};
        row.beforeRate=await value(row.best);row.afterRate=await value(node.event.index);row.loss=Math.max(0,row.beforeRate-row.afterRate);
        row.note="从白方角度比较第四手后的黑方两打与白方选点；仅检查有限候选。";
      } else if(s.stage==="b5") {
        const advice=await adviseOpening(s,run,timeMs,{includeAlternative:false});row.best=advice.points[0];row.points=[row.best];
        const value=async index=>{const next=s.board.slice();next[index]=1;const p=await whiteRate(next,timeMs);return Math.min(p,1-p);};
        row.beforeRate=await value(row.best);row.afterRate=await value(node.event.index);row.loss=Math.max(0,row.beforeRate-row.afterRate);
        row.note="第五手后对方有选色权，比较双方较低的一侧估算，寻找平衡布局。";
      } else {row.note="第四手之后仍有换色与十打分支；保留实战节点，不将普通胜率变化当作开局失误。";}
    } catch(error) {if(error.name==="AbortError")throw error;row.note=`本节点评估未完成：${error.message}。仍可回放实际操作。`;row.loss=null;}
    abort(signal);rows.push(row);onProgress({completed:n+1,total:review.openings.length,rows:[...rows]});
  }
  return rows;
}
