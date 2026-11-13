import { archiveTitle, parseArchiveBackup } from "./game-archive.js";
import { RULES } from "./opening-session.js";
export function createArchiveUi(root,{archive,close,resume,review,exportRecord}) {
  root.innerHTML=`<header class="tool-header"><h2>最近对局</h2><button type="button" data-archive-close>返回棋盘</button></header><p class="tool-message">自动保留最近 50 局，收藏优先保留。数据保存在本设备浏览器中。</p><div class="archive-filter"><label>筛选 <select data-archive-filter><option value="all">全部对局</option><option value="favorite">我的收藏</option><option value="unfinished">未结束</option><option value="finished">已结束</option></select></label><label>规则 <select data-rule-filter><option value="all">全部规则</option><option value="freestyle">无禁手</option><option value="renju">禁手自由开局</option><option value="rif">五手两打</option><option value="taraguchi10">塔拉山口-10</option></select></label><label>排序 <select data-archive-sort><option value="recent">最近更新</option><option value="oldest">最早更新</option><option value="favorite">收藏优先</option><option value="longest">手数最多</option><option value="shortest">手数最少</option></select></label><input data-archive-search type="search" placeholder="搜索名称、备注或结果" aria-label="搜索名称、备注、规则或结果" maxlength="80"><button type="button" data-reset-filters>重置筛选</button><span data-archive-count aria-live="polite"></span></div><div class="archive-list"></div><div class="archive-notice" role="status"></div>`;
  root.querySelector("[data-archive-close]").onclick=close;
  const bar=document.createElement("div");bar.className="archive-backup";
  bar.innerHTML='<button type="button" data-backup-export>导出全部对局备份</button><label class="image-picker">选择备份导入<input type="file" accept="application/json,.json" data-backup-file></label><span data-backup-preview></span><button type="button" data-backup-confirm hidden>确认合并</button><button type="button" data-backup-cancel hidden>取消</button>';
  root.querySelector(".archive-filter").before(bar);
  let removed=null, status="", pendingBackup=null, backupGeneration=0;
  const preview=()=>{const active=Boolean(pendingBackup);bar.querySelector('[data-backup-confirm]').hidden=bar.querySelector('[data-backup-cancel]').hidden=!active;bar.querySelector('[data-backup-preview]').textContent=active?`备份包含 ${pendingBackup.count} 局，确认后合并到现有记录。`:'';};
  bar.querySelector('[data-backup-export]').onclick=()=>{try {
    const url=URL.createObjectURL(new Blob([archive.exportBackup()],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=`wumu-backup-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){status=error.message;renderNotice();}};
  bar.querySelector('[data-backup-file]').onchange=async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;const token=++backupGeneration;pendingBackup=null;preview();status='正在读取备份…';renderNotice();
    try {if(file.size>2*1024*1024)throw new Error('备份文件不能超过 2 MiB');const text=await file.text();const entries=parseArchiveBackup(text);if(token!==backupGeneration)return;pendingBackup={text,count:entries.length};status='';preview();renderNotice();}
    catch(error){if(token!==backupGeneration)return;pendingBackup=null;status=error.message;preview();renderNotice();}
  };
  bar.querySelector('[data-backup-confirm]').onclick=()=>{if(!pendingBackup)return;try {const result=archive.importBackup(pendingBackup.text);pendingBackup=null;status=`已合并 ${result.added} 局，跳过 ${result.skipped} 局重复记录。`;preview();render();}catch(error){status=error.message;renderNotice();}};
  bar.querySelector('[data-backup-cancel]').onclick=()=>{backupGeneration++;pendingBackup=null;preview();};
  function render() {
    const list=root.querySelector(".archive-list"), filter=root.querySelector("[data-archive-filter]").value;
    list.replaceChildren();const all=archive.list();
    const rule=root.querySelector("[data-rule-filter]").value, query=root.querySelector("[data-archive-search]").value.trim().toLocaleLowerCase(), sort=root.querySelector("[data-archive-sort]").value;
    const entries=all.filter(entry=>(filter==="all" || filter==="favorite"&&entry.favorite || filter==="unfinished"&&!entry.winner || filter==="finished"&&entry.winner) && (rule==="all" || entry.rule===rule) && (!query || `${entry.name??""} ${entry.note??""} ${RULES[entry.rule]??""} ${archiveTitle(entry)}`.toLocaleLowerCase().includes(query)));
    if(sort==="oldest")entries.sort((a,b)=>a.updatedAt-b.updatedAt);else if(sort==="favorite")entries.sort((a,b)=>Number(b.favorite)-Number(a.favorite)||b.updatedAt-a.updatedAt);else if(sort==="longest")entries.sort((a,b)=>b.moves-a.moves||b.updatedAt-a.updatedAt);else if(sort==="shortest")entries.sort((a,b)=>a.moves-b.moves||b.updatedAt-a.updatedAt);
    root.querySelector("[data-archive-count]").textContent=`${entries.length} / ${all.length} 局`;
    if(!entries.length) {const p=document.createElement("p");p.textContent=all.length?"没有符合条件的对局。":"还没有对局记录；开始落子后会自动保存。";list.append(p);}
    for(const entry of entries) {
      const card=document.createElement("article"),title=document.createElement("p"),detail=document.createElement("p"),actions=document.createElement("div");
      card.className="archive-card";card.dataset.archiveId=entry.id;title.textContent=(entry.name?`${entry.name} · `:"")+archiveTitle(entry);
      detail.textContent=new Date(entry.updatedAt).toLocaleString("zh-CN")+(entry.meta?.mode==="adaptive"?" · 自适应深思 0～6 秒":entry.meta?.timeMs?` · 每步最多 ${entry.meta.timeMs/1000} 秒`:"");
      const button=(text,run)=>{const b=document.createElement("button");b.type="button";b.textContent=text;b.onclick=()=>{try {run();}catch(error){status=error.message;renderNotice();}};actions.append(b);};
      if(!entry.winner) button("继续这局",()=>resume(entry));
      button("复盘",()=>review(entry.record));
      button("导出",()=>exportRecord(entry.record));
      button(entry.favorite?"取消收藏":"收藏",()=>{status=archive.favorite(entry.id)?"":"未能保存收藏，请检查设备存储。";render();});
      button("删除",()=>{if(archive.remove(entry.id)){removed=entry;status="已删除一局。";}else status="删除未成功，原记录仍保留。";render();});
      const edit=document.createElement("details"),summary=document.createElement("summary"),name=document.createElement("input"),note=document.createElement("textarea"),save=document.createElement("button");
      summary.textContent="名称与备注";name.placeholder="为这局取个名字";name.setAttribute("aria-label","对局名称");name.maxLength=40;name.value=entry.name??"";
      note.placeholder="记录思路或下次想尝试的变化";note.setAttribute("aria-label","对局备注");note.maxLength=500;note.value=entry.note??"";
      save.type="button";save.textContent="保存";save.onclick=()=>{status=archive.annotate(entry.id,{name:name.value,note:note.value})?"已保存名称和备注。":"保存失败，请检查设备存储。";render();};
      edit.className="archive-edit";edit.append(summary,name,note,save);note.addEventListener("keydown",event=>{if((event.ctrlKey||event.metaKey)&&event.key==="Enter"){event.preventDefault();save.click();}});actions.className="archive-actions";card.append(title,detail);if(entry.note){const excerpt=document.createElement("p");excerpt.className="archive-note";excerpt.textContent=`备注：${entry.note}`;card.append(excerpt);}card.append(actions,edit);list.append(card);
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
  for(const selector of ["[data-archive-filter]","[data-rule-filter]","[data-archive-sort]"])root.querySelector(selector).onchange=render;
  root.querySelector("[data-archive-search]").oninput=render;
  root.querySelector("[data-reset-filters]").onclick=()=>{root.querySelector("[data-archive-filter]").value="all";root.querySelector("[data-rule-filter]").value="all";root.querySelector("[data-archive-sort]").value="recent";root.querySelector("[data-archive-search]").value="";render();};
  return {open:render,dispose(){backupGeneration++;pendingBackup=null;preview();removed=null;status="";root.querySelector("[data-archive-filter]").value="all";root.querySelector("[data-rule-filter]").value="all";root.querySelector("[data-archive-sort]").value="recent";root.querySelector("[data-archive-search]").value="";}};
}
