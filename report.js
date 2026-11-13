import { validateTournament, summarizePair, budgetLabel, percent, coordinate } from './real-game-model.js';
import { createBoardView } from './board-view.js';
const $=id=>document.getElementById(id), url='./reports/real-games-latest.json';
const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
const stamp=value=>new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
let current=null,request=null,timer,selected=null,view=null;
function showReplay(game, preserve=false){
 const previous=Number($('replayRange').value);selected=game;const moves=[...game.openingMoves,...game.moves.map(m=>m.index)],range=$('replayRange');range.max=String(moves.length);range.value=String(preserve?Math.max(0,Math.min(moves.length,previous)):moves.length);
 $('replayTitle').textContent=`${budgetLabel(game.shortMs)} vs ${budgetLabel(game.longMs)} · ${game.openingId}`;
 function draw(){const step=Number(range.value),board=new Uint8Array(225);for(let i=0;i<step;i++)board[moves[i]]=i%2+1;view??=createBoardView($('replayBoard'),{idPrefix:'report-replay-'});view.render({board,lastMove:step?moves[step-1]:-1,pendingIndex:-1,canInteract:false});$('replayStep').textContent=step?`第 ${step} / ${moves.length} 手 · ${step%2?'黑':'白'} ${coordinate(moves[step-1])}${step<=game.openingMoves.length?' · 预设开局':''}`:`开局前 · 0 / ${moves.length} 手`;$('replayPrev').disabled=step===0;$('replayNext').disabled=step===moves.length;range.setAttribute('aria-valuetext',$('replayStep').textContent);}
 range.oninput=draw;$('replayPrev').onclick=()=>{range.value=String(Number(range.value)-1);draw();};$('replayNext').onclick=()=>{range.value=String(Number(range.value)+1);draw();};draw();
}
function render(report){
 const done=report.games.filter(g=>g.winner);$('heroGames').textContent=String(done.length);
 const pairs=report.batches.flatMap(b=>b.identity.matchups),grid=$('matchGrid');grid.replaceChildren();const black=done.filter(g=>g.winner===1).length,white=done.filter(g=>g.winner===2).length,draws=done.filter(g=>g.winner===3).length;$('sampleNote').textContent=`全部 ${done.length} 盘：黑方 ${black} 胜、白方 ${white} 胜、${draws} 和。请结合执色分组解读，小样本不能说明稳定强弱。`;
 for(const [shortMs,longMs] of pairs){const s=summarizePair(done,shortMs,longMs),card=el('article','real-match-card');
  card.append(el('p','pair-kicker',`${budgetLabel(longMs)} 对 ${budgetLabel(shortMs)}`),el('strong','pair-rate',percent(s.winRate)),el('p','pair-desc',`${budgetLabel(longMs)}档胜率 · ${s.total} 盘`));
  const bar=el('div','real-bar');bar.setAttribute('role','img');bar.setAttribute('aria-label',`${s.wins}胜${s.draws}和${s.losses}负`);
  for(const [cls,n] of [['win',s.wins],['draw',s.draws],['loss',s.losses]]){const segment=el('i',cls);segment.style.flex=String(n);bar.append(segment);}card.append(bar,el('p','pair-record',`${s.wins} 胜  /  ${s.draws} 和  /  ${s.losses} 负`),el('p','pair-score',`得分率 ${percent(s.scoreRate)} · 和棋计半分`),el('p','pair-color',`${budgetLabel(shortMs)}档胜率：${percent(s.total?s.losses/s.total:null)}`));for(const c of s.colors)card.append(el('p','pair-color',`长预算执${c.color===1?'黑':'白'}：${c.wins}胜 ${c.draws}和 ${c.losses}负`));grid.append(card);
 }
 const rows=$('gameRows');rows.replaceChildren();for(const game of done){const tr=el('tr');const result=game.winner===3?'和棋':`${game.winner===game.longColor?budgetLabel(game.longMs):budgetLabel(game.shortMs)}档胜（${game.winner===1?'黑':'白'}）`;
  for(const content of [`${budgetLabel(game.shortMs)} / ${budgetLabel(game.longMs)}`,game.openingId,game.longColor===1?'黑':'白',result,String(game.plies)])tr.append(el('td','',content));
  const td=el('td'),button=el('button','replay-button','回放');button.type='button';button.onclick=()=>{showReplay(game);$('replayTitle').scrollIntoView({behavior:'smooth',block:'nearest'});};td.append(button);tr.append(td);rows.append(tr);
 }
 $('methodPairs').textContent=`${pairs.length} 组对阵 · 每个固定三手开局交换执色`;
 $('methodDevice').textContent=report.batches[0].device?.cpu||'未记录';const identity=report.batches[0].identity;$('methodVersion').textContent=`${identity.appVersion||'未记录'} · ${(identity.sourceCommit||'未记录').slice(0,8)}`;$('methodTime').textContent=stamp(report.createdAt);
 if(done.length){const same=done.find(g=>g.id===selected?.id);showReplay(same||done[0],Boolean(same));}
 $('reportContent').hidden=false;$('reportLoading').hidden=true;$('reportError').hidden=true;current=report;
}
async function load(){request?.abort();const controller=new AbortController();request=controller;const timeout=setTimeout(()=>controller.abort(),15000);$('refreshReport').disabled=true;$('cloudStatus').dataset.state='loading';$('cloudStatusText').textContent='正在读取并核对棋谱…';
 try{const response=await fetch(`${url}?_=${Date.now()}`,{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error(`HTTP ${response.status}`);const report=validateTournament(await response.json());if(controller!==request)return;render(report);$('cloudStatus').dataset.state='success';$('cloudStatusText').textContent=`数据已核对 · ${stamp(report.createdAt)} 发布`;}
 catch(e){if(controller!==request)return;$('reportLoading').hidden=true;$('reportError').hidden=false;$('reportErrorText').textContent=`${e.message||'请求失败'}。${current?'暂时保留上次成功读取的数据。':'请稍后重试。'}`;$('cloudStatus').dataset.state='error';$('cloudStatusText').textContent='数据刷新失败';}
 finally{clearTimeout(timeout);if(request===controller)$('refreshReport').disabled=false;}
}
$('refreshReport').onclick=load;$('retryReport').onclick=load;document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});window.addEventListener('online',load);timer=setInterval(()=>{if(!document.hidden)load();},60000);load();
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(()=>{});
