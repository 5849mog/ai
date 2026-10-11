import { archiveTitle } from "./game-archive.js";
export function createArchiveUi(root,{archive,close,resume,review,exportRecord}) {
  root.innerHTML=`<header class="tool-header"><h2>最近对局</h2><button type="button" data-archive-close>返回棋盘</button></header><p class="tool-message">自动保留最近 50 局，收藏优先保留。数据保存在本设备浏览器中。</p><div class="archive-list"></div><p class="archive-notice" role="status"></p>`;
  root.querySelector("[data-archive-close]").onclick=close;
  function render() {
    const list=root.querySelector(".archive-list");list.replaceChildren();const entries=archive.list();
    if(!entries.length) {const p=document.createElement("p");p.textContent="还没有对局记录；开始落子后会自动保存。";list.append(p);}
    for(const entry of entries) {
      const card=document.createElement("article"),title=document.createElement("p"),detail=document.createElement("p"),actions=document.createElement("div");
      card.className="archive-card";card.dataset.archiveId=entry.id;title.textContent=archiveTitle(entry);
      detail.textContent=new Date(entry.updatedAt).toLocaleString("zh-CN")+(entry.meta?.timeMs?` · 每步最多 ${entry.meta.timeMs/1000} 秒`:"");
      const button=(text,run)=>{const b=document.createElement("button");b.type="button";b.textContent=text;b.onclick=()=>{try {run();}catch(error){root.querySelector(".archive-notice").textContent=error.message;}};actions.append(b);};
      if(entry.winner) button("复盘",()=>review(entry.record));else button("继续这局",()=>resume(entry));
      button("导出",()=>exportRecord(entry.record));button(entry.favorite?"取消收藏":"收藏",()=>{archive.favorite(entry.id);render();});
      button("删除",()=>{archive.remove(entry.id);render();});actions.className="archive-actions";card.append(title,detail,actions);list.append(card);
    }
    root.querySelector(".archive-notice").textContent=archive.failed?"历史记录暂未保存，请先导出重要棋谱。":"";
  }
  return {open:render,dispose(){}};
}
