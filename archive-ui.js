import { archiveTitle, parseArchiveBackup } from "./game-archive.js";
import { exportName, downloadText } from "./export-utils.js";
import { createBoardView } from "./board-view.js";
import { sessionFromRecord, sessionSgf } from "./session-records.js";
import { RULES } from "./opening-session.js";
export function createArchiveUi(root,{archive,close,resume,review,exportRecord,exportImage}) {
  root.innerHTML=`<header class="tool-header"><h2>最近对局</h2><button type="button" data-archive-close>返回棋盘</button></header><p class="tool-message">自动保留最近 50 局，收藏优先保留。数据保存在本设备浏览器中。</p><div class="archive-filter"><label>筛选 <select data-archive-filter><option value="all">全部对局</option><option value="favorite">我的收藏</option><option value="unfinished">未结束</option><option value="finished">已结束</option></select></label><label>规则 <select data-rule-filter><option value="all">全部规则</option><option value="freestyle">无禁手</option><option value="renju">禁手自由开局</option><option value="rif">五手两打</option><option value="taraguchi10">塔拉山口-10</option></select></label><label>排序 <select data-archive-sort><option value="recent">最近更新</option><option value="oldest">最早更新</option><option value="favorite">收藏优先</option><option value="longest">手数最多</option><option value="shortest">手数最少</option></select></label><details class="archive-advanced"><summary>高级筛选</summary><label>结果 <select data-result-filter><option value="all">全部结果</option><option value="win">我方胜</option><option value="loss">我方负</option><option value="draw">和棋</option><option value="unfinished">未结束</option></select></label><label>执色 <select data-color-filter><option value="all">全部执色</option><option value="1">我方黑棋</option><option value="2">我方白棋</option><option value="unknown">尚未确定</option></select></label></details><input data-archive-search type="search" placeholder="搜索名称、备注或结果" aria-label="搜索名称、备注、规则或结果" maxlength="80"><button type="button" data-reset-filters>重置筛选</button><span data-archive-count aria-live="polite"></span></div><details class="archive-batch"><summary>批量整理与备份</summary><div class="archive-batch-controls"><button type="button" data-select-visible>选择当前筛选结果</button><button type="button" data-clear-selected>清空选择</button><button type="button" data-favorite-selected>收藏所选</button><button type="button" data-unfavorite-selected>取消所选收藏</button><button type="button" data-export-selected>备份所选</button><span data-selected-count aria-live="polite"></span></div></details><p class="archive-stats" aria-live="polite"></p><div class="archive-list"></div><div class="archive-notice" role="status"></div>`;
  root.querySelector("[data-archive-close]").onclick=close;
  const bar=document.createElement("div");bar.className="archive-backup";
  bar.innerHTML='<button type="button" data-backup-export>导出全部对局备份</button><label class="image-picker">选择备份导入<input type="file" accept="application/json,.json" data-backup-file></label><span data-backup-preview></span><button type="button" data-backup-confirm hidden>确认合并</button><button type="button" data-backup-cancel hidden>取消</button>';
  root.querySelector(".archive-filter").before(bar);
  let removed=null, status="", pendingBackup=null, backupGeneration=0, visibleIds=[];const selected=new Set();
  const preview=()=>{const active=Boolean(pendingBackup);bar.querySelector('[data-backup-confirm]').hidden=bar.querySelector('[data-backup-cancel]').hidden=!active;bar.querySelector('[data-backup-preview]').textContent=active?`备份包含 ${pendingBackup.count} 局，确认后合并到现有记录。`:'';};
  bar.querySelector('[data-backup-export]').onclick=()=>{try {
    downloadText(archive.exportBackup(),exportName('backup','json'));status='备份已导出。';renderNotice();
  }catch(error){status=error.message;renderNotice();}};
  bar.querySelector('[data-backup-file]').onchange=async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;const token=++backupGeneration;pendingBackup=null;preview();status='正在读取备份…';renderNotice();
    try {if(file.size>2*1024*1024)throw new Error('备份文件不能超过 2 MiB');const text=await file.text();const entries=parseArchiveBackup(text);if(token!==backupGeneration)return;pendingBackup={text,count:entries.length};const current=archive.list(),existing=new Set(current.map(e=>e.id)),overlap=entries.filter(e=>existing.has(e.id)).length;status=`当前已有 ${current.length} 局；备份中 ${overlap} 局编号已存在，合并时会检查重复。`;preview();renderNotice();}
    catch(error){if(token!==backupGeneration)return;pendingBackup=null;status=error.message;preview();renderNotice();}
  };
  bar.querySelector('[data-backup-confirm]').onclick=()=>{if(!pendingBackup)return;try {const result=archive.importBackup(pendingBackup.text);pendingBackup=null;status=`已合并 ${result.added} 局，跳过 ${result.skipped} 局重复记录。`;preview();render();}catch(error){status=error.message;renderNotice();}};
  bar.querySelector('[data-backup-cancel]').onclick=()=>{backupGeneration++;pendingBackup=null;preview();};
  function render() {
    const list=root.querySelector(".archive-list"), filter=root.querySelector("[data-archive-filter]").value;
    list.replaceChildren();const all=archive.list();
    const rule=root.querySelector("[data-rule-filter]").value, result=root.querySelector("[data-result-filter]").value, color=root.querySelector("[data-color-filter]").value, query=root.querySelector("[data-archive-search]").value.trim().toLocaleLowerCase(), sort=root.querySelector("[data-archive-sort]").value;
    for(const id of selected)if(!all.some(entry=>entry.id===id))selected.delete(id);
    const outcome=entry=>!entry.winner?'unfinished':entry.winner===3?'draw':![1,2].includes(entry.playerColor)?'unknown':entry.winner===entry.playerColor?'win':'loss';
    const entries=all.filter(entry=>(result==='all'||outcome(entry)===result) && (color==='all'||(color==='unknown'?![1,2].includes(entry.playerColor):entry.playerColor===Number(color))) && (filter==="all" || filter==="favorite"&&entry.favorite || filter==="unfinished"&&!entry.winner || filter==="finished"&&entry.winner) && (rule==="all" || entry.rule===rule) && (!query || `${entry.name??""} ${entry.note??""} ${RULES[entry.rule]??""} ${archiveTitle(entry)}`.toLocaleLowerCase().includes(query)));
    if(sort==="oldest")entries.sort((a,b)=>a.updatedAt-b.updatedAt);else if(sort==="favorite")entries.sort((a,b)=>Number(b.favorite)-Number(a.favorite)||b.updatedAt-a.updatedAt);else if(sort==="longest")entries.sort((a,b)=>b.moves-a.moves||b.updatedAt-a.updatedAt);else if(sort==="shortest")entries.sort((a,b)=>a.moves-b.moves||b.updatedAt-a.updatedAt);
    visibleIds=entries.map(e=>e.id);root.querySelector('[data-selected-count]').textContent=`已选 ${selected.size} 局（跨筛选保留）`;
    for(const selector of ['[data-clear-selected]','[data-favorite-selected]','[data-unfavorite-selected]','[data-export-selected]'])root.querySelector(selector).disabled=!selected.size;
    root.querySelector('[data-select-visible]').disabled=!entries.length;
    const pending=entries.filter(e=>outcome(e)==='unfinished').length;
    const w=entries.filter(e=>outcome(e)==='win').length,l=entries.filter(e=>outcome(e)==='loss').length,d=entries.filter(e=>outcome(e)==='draw').length,u=entries.filter(e=>outcome(e)==='unknown').length;
    root.querySelector('.archive-stats').textContent=`当前筛选：${entries.length} 局 · ${w} 胜 ${l} 负 ${d} 和 · ${pending} 局未结束${u?` · ${u} 局执色未确定`:''}`;
    root.querySelector("[data-archive-count]").textContent=`${entries.length} / ${all.length} 局`;
    if(!entries.length) {const p=document.createElement("p");p.textContent=all.length?"没有符合条件的对局。":"还没有对局记录；开始落子后会自动保存。";list.append(p);}
    for(const [entryIndex,entry] of entries.entries()) {
      const card=document.createElement("article"),title=document.createElement("p"),detail=document.createElement("p"),actions=document.createElement("div");
      card.className="archive-card";card.dataset.archiveId=entry.id;
      const choose=document.createElement('label'),checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=selected.has(entry.id);checkbox.setAttribute('aria-label',`选择对局 ${entry.name||archiveTitle(entry)}`);checkbox.onchange=()=>{checkbox.checked?selected.add(entry.id):selected.delete(entry.id);root.querySelector('[data-selected-count]').textContent=`已选 ${selected.size} 局（跨筛选保留）`;for(const selector of ['[data-clear-selected]','[data-favorite-selected]','[data-unfavorite-selected]','[data-export-selected]'])root.querySelector(selector).disabled=!selected.size;};choose.className='archive-choice';choose.append(checkbox,document.createTextNode('选择'));title.textContent=(entry.name?`${entry.name} · `:"")+archiveTitle(entry);
      detail.textContent=new Date(entry.updatedAt).toLocaleString("zh-CN")+(entry.meta?.mode==="adaptive"?" · 自适应深思 0～6 秒":entry.meta?.timeMs?` · 每步最多 ${entry.meta.timeMs/1000} 秒`:"");
      const button=(text,run)=>{const b=document.createElement("button");b.type="button";b.textContent=text;b.onclick=()=>{try {run();}catch(error){status=error.message;renderNotice();}};actions.append(b);};
      if(!entry.winner) button("继续这局",()=>resume(entry));
      button("复盘",()=>review(entry.record));
      button("导出棋谱",()=>exportRecord(entry.record));
      button("导出 SGF",()=>{exportRecord(entry.record,'sgf');status=entry.rule==='freestyle'?"SGF 已导出。":"SGF 记录落子；完整开局操作请导出五目棋谱。";renderNotice();});
      if(exportImage) {const b=document.createElement("button");b.type="button";b.textContent="保存棋盘图";b.onclick=async()=>{b.disabled=true;try{await exportImage(entry.record);status="棋盘图已导出。";}catch(error){status=`图片导出失败：${error.message}`;}finally{b.disabled=false;renderNotice();}};actions.append(b);}
      button(entry.favorite?"取消收藏":"收藏",()=>{status=archive.favorite(entry.id)?"":"未能保存收藏，请检查设备存储。";render();});
      button("删除",()=>{if(archive.remove(entry.id)){removed=entry;status="已删除一局。";}else status="删除未成功，原记录仍保留。";render();});
      const edit=document.createElement("details"),summary=document.createElement("summary"),name=document.createElement("input"),note=document.createElement("textarea"),save=document.createElement("button");
      summary.textContent="名称与备注";name.placeholder="为这局取个名字";name.setAttribute("aria-label","对局名称");name.maxLength=40;name.value=entry.name??"";
      note.placeholder="记录思路或下次想尝试的变化";note.setAttribute("aria-label","对局备注");note.maxLength=500;note.value=entry.note??"";
      save.type="button";save.textContent="保存";save.onclick=()=>{status=archive.annotate(entry.id,{name:name.value,note:note.value})?"已保存名称和备注。":"保存失败，请检查设备存储。";render();};
      edit.className="archive-edit";edit.append(summary,name,note,save);note.addEventListener("keydown",event=>{if((event.ctrlKey||event.metaKey)&&event.key==="Enter"){event.preventDefault();save.click();}});actions.className="archive-actions";card.append(choose,title,detail);
      const boardPreview=document.createElement('details'),boardLabel=document.createElement('summary');boardLabel.textContent='预览棋盘';boardPreview.className='archive-preview';boardPreview.append(boardLabel);boardPreview.ontoggle=()=>{if(!boardPreview.open||boardPreview.dataset.loaded)return;try{const game=sessionFromRecord(entry.record),svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','20 20 580 580');svg.setAttribute('role','img');svg.setAttribute('aria-label','对局当前棋盘');svg.classList.add('board-svg');boardPreview.append(svg);createBoardView(svg,{idPrefix:`archive-preview-${entryIndex}-`}).render({board:game.board,lastMove:game.lastMove,canInteract:false,pendingIndex:-1,overlayKey:game.candidates.join(',')});for(const [rank,index] of game.candidates.entries()){const x=46+index%15*528/14,y=46+Math.floor(index/15)*528/14,g=document.createElementNS('http://www.w3.org/2000/svg','g');g.setAttribute('class','review-candidate');const c=document.createElementNS('http://www.w3.org/2000/svg','circle'),t=document.createElementNS('http://www.w3.org/2000/svg','text');c.setAttribute('cx',x);c.setAttribute('cy',y);c.setAttribute('r',14);t.setAttribute('x',x);t.setAttribute('y',y);t.textContent=`A${rank+1}`;g.append(c,t);svg.append(g);}boardPreview.dataset.loaded='1';}catch(error){status=`预览失败：${error.message}`;renderNotice();}};if(entry.note){const excerpt=document.createElement("p");excerpt.className="archive-note";excerpt.textContent=`备注：${entry.note}`;card.append(excerpt);}const copy=document.createElement('details'),copyLabel=document.createElement('summary');copy.className='archive-copy';copyLabel.textContent='复制棋谱';copy.append(copyLabel);
      for(const format of ['json','sgf']){const b=document.createElement('button');b.type='button';b.textContent=format==='sgf'?'复制 SGF':'复制五目棋谱';b.onclick=async()=>{try{if(!globalThis.navigator?.clipboard?.writeText)throw Error('浏览器不支持复制');await navigator.clipboard.writeText(format==='sgf'?sessionSgf(entry.record):JSON.stringify(entry.record,null,2));status=format==='sgf'&&entry.rule!=='freestyle'?'已复制 SGF；完整开局操作请用五目棋谱。':'棋谱已复制。';}catch(error){status=`复制失败：${error.message}`;}renderNotice();};copy.append(b);}
      card.append(actions,boardPreview,copy,edit);list.append(card);
    }
    renderNotice();
  }
  function renderNotice() {
    const notice=root.querySelector(".archive-notice");notice.replaceChildren();
    const text=document.createElement("span");text.textContent=status || (archive.failed?"历史记录暂未保存，请先导出重要棋谱。":"");notice.append(text);
    if(removed) {const undo=document.createElement("button");undo.type="button";undo.textContent="撤销删除";undo.onclick=()=>{
      if(archive.restore(removed)){removed=null;status="已恢复刚才删除的对局。";}
      else status="未能恢复：记录可能已存在、列表已满或存储不可用。";
      render();
    };notice.append(undo);}
  }
  for(const selector of ["[data-archive-filter]","[data-rule-filter]","[data-result-filter]","[data-color-filter]","[data-archive-sort]"])root.querySelector(selector).onchange=render;
  root.querySelector("[data-archive-search]").oninput=render;
  root.querySelector("[data-reset-filters]").onclick=()=>{root.querySelector("[data-archive-filter]").value="all";root.querySelector("[data-rule-filter]").value="all";root.querySelector("[data-result-filter]").value="all";root.querySelector("[data-color-filter]").value="all";root.querySelector("[data-archive-sort]").value="recent";root.querySelector("[data-archive-search]").value="";render();};
  root.querySelector('[data-select-visible]').onclick=()=>{for(const id of visibleIds)selected.add(id);render();};
  root.querySelector('[data-clear-selected]').onclick=()=>{selected.clear();render();};
  for(const [selector,value] of [['[data-favorite-selected]',true],['[data-unfavorite-selected]',false]])root.querySelector(selector).onclick=()=>{status=archive.setFavorites([...selected],value)?`已${value?'收藏':'取消收藏'}所选对局。`:'操作未保存，请检查设备存储。';render();};
  root.querySelector('[data-export-selected]').onclick=()=>{try{const backup=archive.exportBackup([...selected]),count=parseArchiveBackup(backup).length;if(!count)throw new Error('所选对局已不存在，请重新选择。');downloadText(backup,exportName('selected-backup','json'));status=`已备份 ${count} 局。`;}catch(error){status=error.message;}renderNotice();};
  return {open:render,dispose(){backupGeneration++;pendingBackup=null;preview();removed=null;status="";selected.clear();visibleIds=[];root.querySelector(".archive-batch").open=false;root.querySelector(".archive-advanced").open=false;root.querySelector("[data-archive-filter]").value="all";root.querySelector("[data-rule-filter]").value="all";root.querySelector("[data-result-filter]").value="all";root.querySelector("[data-color-filter]").value="all";root.querySelector("[data-archive-sort]").value="recent";root.querySelector("[data-archive-search]").value="";}};
}
