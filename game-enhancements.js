import { createImageImport } from "./image-import-ui.js";
import { createReviewUi } from "./review-ui.js";
import { updateControlMarkup } from "./app-update.js";
import { createArchiveUi } from "./archive-ui.js";

// Inline quick controls and full-page workspaces share one lifecycle. Neither
// workspace uses a popup or modifies the live game while it is being inspected.
export function setupGameEnhancements({ getPosition, getRecord, applyRecord, onWorkspace, search, cancelSearch, newGame, archive, resumeRecord, pauseSearch, resumeSearch }) {
  const $ = selector => document.querySelector(selector), shell = $(".app-shell");
  const status = document.createElement("div"); status.id = "simpleStatusRow"; status.className = "simple-status-row";
  const rate = $("#simpleWinRate"); rate.before(status); status.append(rate);
  const reviewEntry = document.createElement("button"); reviewEntry.type = "button"; reviewEntry.textContent = "复盘本局"; reviewEntry.hidden = true; status.append(reviewEntry);
  const retryEntry = document.createElement("button"); retryEntry.type = "button"; retryEntry.textContent = "重试 AI"; retryEntry.hidden = true; status.append(retryEntry);
  retryEntry.onclick = () => $("#retryButton").click();
  const pauseEntry=document.createElement("button");pauseEntry.type="button";pauseEntry.textContent="暂停思考";pauseEntry.hidden=true;pauseEntry.onclick=()=>pauseSearch?.();status.append(pauseEntry);
  const resumeEntry=document.createElement("button");resumeEntry.type="button";resumeEntry.textContent="继续思考";resumeEntry.hidden=true;resumeEntry.onclick=()=>resumeSearch?.();status.append(resumeEntry);
  const toggle = document.createElement("button"); toggle.type = "button"; toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-controls", "simpleQuickTools"); status.append(toggle);
  const panel = document.createElement("div"); panel.id = "simpleQuickTools"; panel.className = "simple-quick-tools"; panel.hidden = true; status.after(panel);
  const notice = document.createElement("div"); notice.className = "simple-notice"; notice.hidden = true; notice.setAttribute("role", "status"); status.after(notice);
  const sourceNotice = $("#gameNotice");
  function syncNotice() {
    notice.hidden = !sourceNotice || sourceNotice.hidden || !sourceNotice.classList.contains("error");
    notice.textContent = notice.hidden ? "" : sourceNotice.textContent; measure();
  }
  if (sourceNotice && typeof MutationObserver === "function") new MutationObserver(syncNotice).observe(sourceNotice,
    { attributes: true, attributeFilter: ["hidden", "class"], childList: true, characterData: true, subtree: true });
  panel.innerHTML = `<div class="tool-buttons" role="group" aria-label="每步思考时间"><button type="button" data-time="1000">1 秒</button><button type="button" data-time="5000">5 秒</button><button type="button" data-time="10000">10 秒</button><button type="button" data-time="30000">深思 30 秒</button><button type="button" data-ponder aria-pressed="true">后台思考</button></div><div class="quick-tools-actions"><button type="button" data-image>截图导入</button><button type="button" data-archive>最近对局</button><button type="button" data-collapse>收起</button></div><p>影响后续自动应手；深思最多 30 秒，推荐仍为 1 秒。关后台可省电。</p>${updateControlMarkup()}`;
  const workspace = document.createElement("section"); workspace.className = "enhancement-workspace"; workspace.hidden = true;
  workspace.setAttribute("aria-label", "对局工具"); workspace.tabIndex = -1; document.body.append(workspace);
  const imageRoot = document.createElement("div"), reviewRoot = document.createElement("div"), archiveRoot=document.createElement("div"); imageRoot.hidden = reviewRoot.hidden = archiveRoot.hidden = true; workspace.append(imageRoot, reviewRoot,archiveRoot);
  let active = null, recordKey = null, opening = false, currentReview=true;
  function collapse() { panel.hidden = true; toggle.setAttribute("aria-expanded", "false"); measure(); }
  function measure() { shell.style.setProperty("--quick-tools-space", `${(panel.hidden ? 0 : panel.getBoundingClientRect().height + 8) + (notice.hidden ? 0 : notice.getBoundingClientRect().height + 8)}px`); }
  function close({ resume = true } = {}) {
    if (!active) return;
    const previous = active; active = null;
    if (previous === "image") image.dispose(); else if(previous==="review") review.dispose();else history.dispose();
    workspace.hidden = true; imageRoot.hidden = reviewRoot.hidden = archiveRoot.hidden = true; shell.hidden = false;
    if (resume) onWorkspace(false); toggle.focus();
  }
  const image = createImageImport(imageRoot, { getPosition, applyRecord, close });
  const review = createReviewUi(reviewRoot, { search, cancelSearch, close, newGame: () => { close(); newGame(); } });
  const history=createArchiveUi(archiveRoot,{archive:archive??{list:()=>[],failed:false},close,resume:entry=>{if(resumeRecord?.(entry)!==false)close();},review:record=>{close({resume:false});open("review",record);},exportRecord:record=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:"application/json"})),link=document.createElement("a");link.href=url;link.download="wumu-archive.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }});
  function open(kind, archivedRecord=null) {
    if (active || kind === "review" && !archivedRecord && !getPosition().winner) return;
    const record = structuredClone(archivedRecord??getRecord()); recordKey = JSON.stringify(record);currentReview=!archivedRecord;
    collapse(); active = kind; opening = true; onWorkspace(true); opening = false;
    shell.hidden = true; workspace.hidden = false; imageRoot.hidden = kind !== "image"; reviewRoot.hidden = kind !== "review";archiveRoot.hidden=kind!=="archive"; workspace.focus();
    if (kind === "image") image.open(); else if(kind==="review")void review.open(record);else history.open();
    $("#recordMenu").open = false;
  }
  toggle.onclick = () => { panel.hidden = !panel.hidden; toggle.setAttribute("aria-expanded", String(!panel.hidden)); measure(); };
  panel.querySelector("[data-collapse]").onclick = collapse;
  for (const button of panel.querySelectorAll("[data-time]")) button.onclick = () => {
    const select = $("#timeSelect"); if (select.disabled) return;
    select.value = button.dataset.time; select.dispatchEvent(new Event("change")); collapse(); render();
  };
  panel.querySelector("[data-ponder]").onclick = () => { const input = $("#ponderToggle"); if (input.disabled) return; input.checked = !input.checked; input.dispatchEvent(new Event("change")); collapse(); render(); };
  panel.querySelector("[data-image]").onclick = () => open("image"); reviewEntry.onclick = () => open("review");
  panel.querySelector("[data-archive]").onclick=()=>open("archive");
  const fullImage = document.createElement("button"), fullReview = document.createElement("button");
  for (const b of [fullImage, fullReview]) { b.type = "button"; $(".record-options").append(b); }
  fullImage.textContent = "截图导入"; fullImage.onclick = () => open("image"); fullReview.textContent = "复盘本局"; fullReview.hidden = true; fullReview.onclick = () => open("review");
  const fullArchive=document.createElement("button");fullArchive.type="button";fullArchive.textContent="最近对局";fullArchive.onclick=()=>open("archive");$(".record-options").append(fullArchive);
  // Put the full-mode postgame entry beside New as well as in the menu.
  const resultButton = document.createElement("button"); resultButton.type = "button"; resultButton.className = "icon-button"; resultButton.textContent = "复盘"; resultButton.hidden = true; resultButton.onclick = () => open("review"); $(".game-actions").append(resultButton);
  const fullPause=document.createElement("button");fullPause.type="button";fullPause.className="icon-button";fullPause.hidden=true;fullPause.onclick=()=>getPosition().paused?resumeSearch?.():pauseSearch?.();$(".game-actions").append(fullPause);
  function render() {
    const position = getPosition();
    retryEntry.hidden = position.state !== "error" || Boolean(position.winner);
    pauseEntry.hidden=!(position.busy && $("#timeSelect").value==="30000" && pauseSearch);resumeEntry.hidden=!position.paused;
    fullPause.hidden=pauseEntry.hidden&&resumeEntry.hidden;fullPause.textContent=position.paused?"继续思考":"暂停思考";
    syncNotice();
    for (const b of [reviewEntry, fullReview, resultButton]) b.hidden = !position.winner;
    const time = $("#timeSelect"), ponder = $("#ponderToggle"); toggle.textContent = `${time.value==="30000"?"深思":Number(time.value) / 1000+"秒"} · 更多`;
    toggle.setAttribute("aria-label", `每步最多 ${Number(time.value) / 1000} 秒，展开快捷设置与截图导入`);
    for (const b of panel.querySelectorAll("[data-time]")) { b.disabled = time.disabled; b.setAttribute("aria-pressed", String(b.dataset.time === time.value)); }
    const p = panel.querySelector("[data-ponder]"); p.disabled = ponder.disabled; p.setAttribute("aria-pressed", String(ponder.checked)); p.textContent = `后台${ponder.checked ? "开" : "关"}`;
    if (!document.body.classList.contains("simple-mode")) collapse();
    // Undo, import and New invalidate a terminal review immediately. Applying a
    // screenshot is allowed to finish its own close without reentrant disposal.
    if (active === "review" && currentReview && !opening && (!position.winner || JSON.stringify(getRecord()) !== recordKey)) close();
  }
  const sizeObserver = new ResizeObserver(measure); sizeObserver.observe(panel); sizeObserver.observe(notice);
  document.addEventListener("keydown", event => { if (event.key === "Escape" && active) { event.preventDefault(); event.stopImmediatePropagation(); close(); } }, true);
  $("#timeSelect").addEventListener("change", render); $("#ponderToggle").addEventListener("change", render);
  render(); return { render, close, get active() { return active; } };
}
