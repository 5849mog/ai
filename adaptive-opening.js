import { adviseOpening } from "./opening-advisor.js";
import { replaySession } from "./opening-session.js";
import { distinctCandidates, moveVerdict } from "./renju-rules.js";
import { atomicRate, createThinkingBudget, thinkAdaptive, immediateWins } from "./adaptive-search.js";
const unique = items => [...new Set(items)];
const abort = error => error.name === "AbortError";
const groupEqual = (a,b) => a.length===b.length && a.every(i=>b.includes(i));

// All nested opening comparisons use ONE deadline. Proposals are hypothetical
// black fifths, never multiple placed stones. White chooses the worst for black.
export async function adviseAdaptiveOpening(session,search,settings={}) {
  if(["play","w6"].includes(session.stage)) {
    const result=await thinkAdaptive({board:session.board,sideToMove:session.color,rule:session.rule,
      allowedMoves:session.allowedMoves({safe:true}),allowSetup:true},search,settings);
    return {points:[result.index],result,adaptive:result.adaptive};
  }
  const b=createThinkingBudget(search,settings), rule=session.rule;
  const run=(options,time,label)=>b.run({...options,rule,allowSetup:true},time,label,{root:false});
  const valid=(board,index,color,allowed)=>Number.isInteger(index) && index>=0 && index<225 && !board[index]
    && (!allowed || allowed.includes(index)) && !moveVerdict(board,index,color,rule).forbidden;
  const score=async (board,color,time,label)=>{
    const empty=Array.from(board,(v,i)=>v?-1:i).filter(i=>i>=0);
    if(immediateWins(board,color,empty,rule).length)return 1;
    const result=await run({board,sideToMove:color,multiPV:1},time,label);
    if(!valid(board,result.index,color))throw new Error("开局复核返回非法落点");
    const best=result.assessment?.bestIndex;return valid(board,best,color)?atomicRate(result,best):null;
  };
  const finish=(advice,status,extra={})=>{
    const wrapped=b.finish(advice.result??{},status,extra);
    return {...advice,adaptive:wrapped.adaptive,...(advice.result?{result:wrapped}:{})};
  };
  async function evaluatePoints(board,points,time) {
    const values=[];
    for(const index of points) {
      if(!valid(board,index,1))throw new Error("第五手候选不合法");
      const next=board.slice();next[index]=1;
      const white=await score(next,2,time,"复核白方选点");values.push({index,rate:white===null?null:1-white});
    }
    return values;
  }
  async function proposals(s, allocation) {
    const localStart=b.left;
    const need=s.offerCount-s.candidates.length, allowed=distinctCandidates(s.board,[...s.candidates,...s.allowedMoves({safe:true})]).slice(s.candidates.length);
    if(allowed.length<need)throw new Error("合法非等价候选不足");
    const poolCount=Math.min(need+2,allowed.length);
    const root=await run({board:s.board,sideToMove:1,multiPV:poolCount,allowedMoves:allowed},Math.min(1100,allocation*.28),"比较整组提案");
    const pool=unique([...(root.recommendations??[]).map(p=>p.index),root.index]).filter(i=>valid(s.board,i,1,allowed)).slice(0,poolCount);
    if(pool.length<need)throw new Error("尚未完成足量非等价提案");
    const initial=pool.slice(0,need), all=unique([...pool,...s.candidates]);
    const localLeft=Math.max(0,allocation-(localStart-b.left));
    const per=Math.min(450,Math.floor(Math.min(localLeft,b.left)*.90/all.length));
    let values=await evaluatePoints(s.board,all,per);
    if(values.some(v=>v.rate===null))return {points:initial,result:root,rate:null,checks:values.length,status:"有限复核"};
    const ranked=()=>values.filter(v=>pool.includes(v.index)).sort((a,c)=>c.rate-a.rate || a.index-c.index);
    let sorted=ranked(), gap=sorted[need-1].rate-(sorted[need]?.rate??0);
    // Recheck a close boundary at equal budgets for the complete pool. Do not
    // compare one deeply searched fifth against shallow, untouched alternatives.
    if(gap<.06 && b.left>all.length*100 && allocation-(localStart-b.left)>=b.left*.8) {
      try {
        const next=await evaluatePoints(s.board,all,Math.floor((b.left-80)/all.length));
        if(next.every(v=>v.rate!==null)){values=next;sorted=ranked();gap=sorted[need-1].rate-(sorted[need]?.rate??0);}
      } catch(error) { b.guard();if(abort(error))throw error; }
    }
    const points=sorted.slice(0,need).map(v=>v.index);
    return {points,result:root,rate:Math.min(sorted[need-1].rate,...values.filter(v=>s.candidates.includes(v.index)).map(v=>v.rate)),checks:values.length,gap,
      status:!groupEqual(points,initial)?"复核后调整":gap<.06?"候选仍接近":"提案已复核"};
  }
  // Taraguchi scores belong to players, whose colors may change. After a
  // normal fifth the chooser can take either color; a ten-offer has no swap.
  async function route(s, allocation, onNormal = () => {}) {
    const start=b.left, left=()=>Math.max(0,Math.min(b.left,allocation-(start-b.left)));
    const normal=replaySession(s.record());normal.apply({type:"decision",choice:"keep"});
    const fifth=await run({board:normal.board,sideToMove:1,balance:true,multiPV:1,
      allowedMoves:normal.allowedMoves({safe:true})},Math.floor(allocation*.25),"搜索可换色第五手");
    if(!valid(normal.board,fifth.index,1,normal.allowedMoves({safe:true})))throw new Error("普通路线落点不合法");
    normal.apply({type:"stone",index:fifth.index});
    const white=await score(normal.board,2,Math.min(left(),allocation*.25),"复核第五手后的选色");
    if(white===null)throw new Error("普通路线评估未完成");
    const keep=Math.min(white,1-white), swap=Math.max(white,1-white);
    let choice=swap>keep+.02?"swap":"keep", value=choice==="swap"?swap:keep;
    onNormal({choice,value,keep,swap,fifth:fifth.index});
    const choices=distinctCandidates(s.board,Array.from(s.board,(v,i)=>v?-1:i).filter(i=>i>=0 && valid(s.board,i,1)));
    const ten=await run({board:s.board,sideToMove:1,multiPV:10,allowedMoves:choices},left(),"比较十打最弱提案");
    const batch=(ten.recommendations??[]).slice(0,10);
    const complete=batch.length===10 && new Set(batch.map(p=>p.index)).size===10
      && batch.every(p=>valid(s.board,p.index,1,choices) && Number.isInteger(p.depth) && p.depth===batch[0].depth
        && Number.isFinite(p.winRate) && p.winRate>=0 && p.winRate<=1);
    const tenFloor=complete?Math.min(...batch.map(p=>p.winRate)):null;
    if(tenFloor!==null && tenFloor>value+.02){choice="ten";value=tenFloor;}
    return {choice,value,keep,swap,tenFloor,complete,fifth:fifth.index,tenPoints:batch.map(p=>p.index)};
  }
  async function balancedFifths(s, initial, allocation) {
    const start=b.left, left=()=>Math.max(0,Math.min(b.left,allocation-(start-b.left)));
    const pool=[{index:initial.points[0],result:initial.result}];
    for(let n=0;n<2 && left()>200;n++) {
      const available=distinctCandidates(s.board,[...pool.map(p=>p.index),...s.allowedMoves({safe:true})]).slice(pool.length);
      if(!available.length)break;
      const result=await run({board:s.board,sideToMove:1,balance:true,multiPV:1,allowedMoves:available},
        Math.min(500,allocation*.10),"扩展平衡第五手");
      if(!valid(s.board,result.index,1,available))throw new Error("平衡第五手不合法");
      pool.push({index:result.index,result});
    }
    const per=Math.floor((left()-60)/pool.length);
    const values=await evaluatePoints(s.board,pool.map(p=>p.index),per);
    if(values.some(v=>v.rate===null))throw new Error("第五手选色复核未完成");
    const ranked=values.map(v=>({...v,floor:Math.min(v.rate,1-v.rate)})).sort((a,c)=>c.floor-a.floor);
    return {points:ranked.slice(0,2).map(v=>v.index),result:pool.find(p=>p.index===ranked[0].index).result,
      floor:ranked[0].floor,checks:values.length,values:ranked,
      note:"比较落第五手后对方选择黑白的结果，优先保留较强的最弱一方。"};
  }
  async function fourths(s, initial, allocation) {
    const start=b.left, left=()=>Math.max(0,Math.min(b.left,allocation-(start-b.left)));
    const pool=[{index:initial.points[0],result:initial.result}];
    const available=distinctCandidates(s.board,[pool[0].index,...s.allowedMoves({safe:true})]).slice(1);
    if(available.length) {
      const result=await run({board:s.board,sideToMove:2,balance:true,multiPV:1,allowedMoves:available},
        Math.min(500,allocation*.10),"扩展第四手候选");
      if(!valid(s.board,result.index,2,available))throw new Error("第四手候选不合法");
      pool.push({index:result.index,result});
    }
    // Equal allocations for every candidate, including all three opponent
    // route choices. An incomplete ten batch cannot establish a safe fourth.
    const per=Math.floor((left()-80)/pool.length), values=[];
    for(const candidate of pool) {
      const next=replaySession(s.record());next.apply({type:"stone",index:candidate.index});
      const r=await route(next,per);
      if(!r.complete)throw new Error("第四手的十打延续未完成");
      values.push({index:candidate.index,white:1-r.value,route:r});
    }
    values.sort((a,c)=>c.white-a.white);
    return {points:values.map(v=>v.index),result:pool.find(p=>p.index===values[0].index).result,
      whiteRate:values[0].white,values,checks:values.length,
      note:"第四手已比较对方保持、换色与十打的有限延续。"};
  }
  let base=null;
  try {
    if(session.stage==="choose") {
      let values=await evaluatePoints(session.board,session.candidates,session.candidates.length>2?180:500);
      const complete=()=>values.every(v=>v.rate!==null);
      const ranked=()=>values.slice().sort((a,c)=>a.rate-c.rate); // white maximizes 1-black
      if(complete())base={points:ranked().slice(0,2).map(v=>v.index),note:"从白方角度逐一复核实际候选。"};
      let gap=complete()?(ranked()[1]?.rate??1)-ranked()[0].rate:null;
      if(gap===null || gap<.12) {
        const next=await evaluatePoints(session.board,session.candidates,Math.min(650,Math.floor((b.left-80)/session.candidates.length)));
        if(next.every(v=>v.rate!==null)){values=next;base={points:ranked().slice(0,2).map(v=>v.index),note:"从白方角度逐一复核实际候选。"};gap=(ranked()[1]?.rate??1)-ranked()[0].rate;}
      }
      if(!base)throw new Error("选点没有形成完整可比较评估");
      return finish(base,gap!==null&&gap>=.06?"选点稳定":"候选仍接近",{candidateChecks:session.candidates.length});
    }
    if(session.offerCount) {
      // Keep a complete legal proposal set if later reply verification times out.
      base=await adviseOpening(session,(o)=>run(o,o.timeMs,"筛选提案"),session.offerCount>2?1000:600,{includeAlternative:false});
      const offered=await proposals(session,b.left-80);
      return finish({...offered,note:"扩大非等价候选，按白方应手复核整组最弱第五手。"},offered.status,{candidateChecks:offered.checks,blackFloor:offered.rate});
    }
    const allowed=session.decision?null:session.allowedMoves({safe:true});
    if(allowed?.length===1)return finish({points:allowed},"唯一合法落点",{reason:"only-legal"});
    if(rule==="taraguchi10" && session.stage==="route4") {
      const r=await route(session,b.left-80,normal=>{base={choice:normal.choice,note:"普通路线已复核，十打仍待确认。"};});
      return finish({choice:r.choice,note:"已比较保持、换色与十打；按我方最终执色评估。"},
        r.complete?"三条路线已复核":"路线有限复核",{normalFloor:r.keep,swapValue:r.swap,blackFloor:r.tenFloor,
          candidateChecks:r.tenPoints.length,provisional:true});
    }
    if(rule==="taraguchi10" && ["w4","b5","swap3"].includes(session.stage)) {
      const next=replaySession(session.record());if(next.decision)next.apply({type:"decision",choice:"keep"});
      const initial=await adviseOpening(next,(o)=>run(o,o.timeMs,"筛选平衡开局"),500,{includeAlternative:false});
      // The last verified stage advice remains available if the shared deadline
      // expires; no hypothetical swap / candidate modifies the live session.
      if(session.decision)base=await adviseOpening(session,(o)=>run(o,o.timeMs,"保留换色建议"),300,{includeAlternative:false});
      else base=initial;
      if(next.stage==="b5") {
        const r=await balancedFifths(next,initial,b.left-80);
        return finish(r,"第五手选色已复核",{blackFloor:r.floor,candidateChecks:r.checks,provisional:true});
      }
      const r=await fourths(next,initial,b.left-80);
      const advice=session.decision?{choice:r.whiteRate<.5?"swap":"keep",note:r.note}:r;
      return finish(advice,"第四手延续已复核",{whiteRate:r.whiteRate,candidateChecks:r.checks,provisional:true});
    }
    if(rule==="taraguchi10" && session.stage==="swap5") {
      base=await adviseOpening(session,(o)=>run(o,o.timeMs,"评估最终执色"),Math.floor(b.left),{includeAlternative:false});
      return finish(base,"最终执色已复核",{provisional:true});
    }
    base=await adviseOpening(session,(o)=>run(o,o.timeMs,"检查开局延续"),900,{includeAlternative:false});
    if(rule==="rif" && ["w4","swap3"].includes(session.stage)) {
      const next=replaySession(session.record());if(next.decision)next.apply({type:"decision",choice:"keep"});
      const fourths=unique([...(base.points??[]),...(base.result?.recommendations??[]).map(p=>p.index),base.result?.index])
        .filter(i=>valid(next.board,i,2,next.allowedMoves({safe:true}))).slice(0,3);
      const results=[];
      for(const index of fourths) {
        const proposed=replaySession(next.record());proposed.apply({type:"stone",index});
        const group=await proposals(proposed,(b.left-100)/(fourths.length-results.length));
        if(group.rate===null)throw new Error("两打延续评估未完成");results.push({index,black:group.rate});
      }
      if(!results.length)throw new Error("第四手候选未完成");results.sort((a,c)=>a.black-c.black);
      const black=results[0].black;
      const advice=session.decision?{...base,choice:(session.actor===session.blackSeat?black:1-black)<.5?"swap":"keep"}
        :{...base,points:results.slice(0,2).map(v=>v.index),blackRate:black};
      return finish(advice,"开局延续已复核",{candidateChecks:results.length,blackFloor:black});
    }
    // Early Taraguchi moves still allow later swaps: retain balance searches,
    // compare stability, and never label a low stage estimate as a proven loss.
    const verified=await adviseOpening(session,(o)=>run(o,o.timeMs,"复核开局主线"),Math.min(1800,b.left-60),{includeAlternative:false});
    const same=base.choice?base.choice===verified.choice:groupEqual(base.points,verified.points);
    return finish(verified,same?"开局阶段稳定":"开局建议已调整",{provisional:true});
  } catch(error) {
    b.guard();if(abort(error)||!base)throw error;
    return finish(base,error.name==="BudgetExhausted"?"预算内完成有限复核":"开局有限复核",{provisional:true});
  }
}
