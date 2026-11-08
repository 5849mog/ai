import { archiveTitle } from "./game-archive.js";
export function createArchiveUi(root,{archive,close,resume,review,exportRecord}) {
  root.innerHTML=`<header class="tool-header"><h2>最近对局</h2><button type="button" data-archive-close>返回棋盘</button></header><p class="tool-message">自动保留最近 50 局，收藏优先保留。数据保存在本设备浏览器中。</p><div class="archive-filter"><label>筛选 <select data-archive-filter><option value="all">全部对局</option><option value="favorite">我的收藏</option><option value="unfinished">未结束</option><option value="finished">已结束</option></select></label><span data-archive-count></span></div><div class="archive-list"></div><div class="archive-notice" role="status"></div>`;
  root.querySelector("[data-archive-close]").onclick=close;
  let removed=null, status="";
  function render() {
    const list=root.querySelector(".archive-list"), filter=root.querySelector("[data-archive-filter]").value;
    list.replaceChildren();const all=archive.list();
    const entries=all.filter(entry=>filter==="all" || filter==="favorite"&&entry.favorite || filter==="unfinished"&&!entry.winner || filter==="finished"&&entry.winner);
    root.querySelector("[data-archive-count]").textContent=`${entries.length} / ${all.length} 局`;
    if(!entries.length) {const p=document.createElement("p");p.textContent=all.length?"没有符合条件的对局。":"还没有对局记录；开始落子后会自动保存。";list.append(p);}
    for(const entry of entries) {
      const card=document.createElement("article"),title=document.createElement("p"),detail=document.createElement("p"),actions=document.createElement("div");
      card.className="archive-card";card.dataset.archiveId=entry.id;title.textContent=archiveTitle(entry);
      detail.textContent=new Date(entry.updatedAt).toLocaleString("zh-CN")+(entry.meta?.mode==="adaptive"?" · 自适应深思 0～6 秒":entry.meta?.timeMs?` · 每步最多 ${entry.meta.timeMs/1000} 秒`:"");
      const button=(text,run)=>{const b=document.createElement("button");b.type="button";b.textContent=text;b.onclick=()=>{try {run();}catch(error){status=error.message;renderNotice();}};actions.append(b);};
      if(entry.winner) button("复盘",()=>review(entry.record));else button("继续这局",()=>resume(entry));
      button("导出",()=>exportRecord(entry.record));
      button(entry.favorite?"取消收藏":"收藏",()=>{status=archive.favorite(entry.id)?"":"未能保存收藏，请检查设备存储。";render();});
      button("删除",()=>{if(archive.remove(entry.id)){removed=entry;status="已删除一局。";}else status="删除未成功，原记录仍保留。";render();});
      actions.className="archive-actions";card.append(title,detail,actions);list.append(card);
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
  root.querySelector("[data-archive-filter]").onchange=render;
  return {open:render,dispose(){removed=null;status="";root.querySelector("[data-archive-filter]").value="all";}};
}
