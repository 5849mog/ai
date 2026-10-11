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
    if(session.stage==="route4") {
      const ten=replaySession(session.record());ten.apply({type:"decision",choice:"ten"});
      const group=await proposals(ten,Math.min(3000,b.left*.65));
      const normal=replaySession(session.record());normal.apply({type:"decision",choice:"keep"});
      const balanced=await run({board:normal.board,sideToMove:1,balance:true,multiPV:1,allowedMoves:normal.allowedMoves({safe:true})},Math.min(750,b.left*.45),"复核普通路线");
      if(!valid(normal.board,balanced.index,1,normal.allowedMoves({safe:true})))throw new Error("普通路线落点不合法");
      normal.apply({type:"stone",index:balanced.index});const white=await score(normal.board,2,b.left-70,"检查第五手后选色");
      if(white===null || group.rate===null)throw new Error("路线比较评估未完成");
      const value=Math.min(white,1-white);
      return finish({...base,choice:group.rate>value+.02?"ten":"keep"},"路线已复核",{candidateChecks:group.checks,blackFloor:group.rate,normalFloor:value,
        provisional:true});
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
