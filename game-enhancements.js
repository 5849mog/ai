import { createImageImport } from "./image-import-ui.js";
import { createReviewUi } from "./review-ui.js";
import { updateControlMarkup } from "./app-update.js";
import { createArchiveUi } from "./archive-ui.js";
import { boardImageBlob } from "./board-image.js";
import { sessionSgf, sessionFromRecord } from "./session-records.js";
import { exportName, downloadText, downloadBlob } from "./export-utils.js";

// Inline quick controls and full-page workspaces share one lifecycle. Neither
// workspace uses a popup or modifies the live game while it is being inspected.
export function setupGameEnhancements({ getPosition, getRecord, applyRecord, onWorkspace, search, cancelSearch, newGame, archive, resumeRecord, pauseSearch, resumeSearch, exitSimple, sound, notify, getControlState, toggleHints, toggleSelfPlay, spectatorSettings, onSpectatorChange, stepSelfPlay }) {
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
    notice.hidden = !sourceNotice || sourceNotice.hidden || !sourceNotice.textContent;
    notice.textContent = notice.hidden ? "" : sourceNotice.textContent;
    notice.classList.toggle("error", Boolean(sourceNotice?.classList.contains("error")));
  }
  if (sourceNotice && typeof MutationObserver === "function") new MutationObserver(syncNotice).observe(sourceNotice,
    { attributes: true, attributeFilter: ["hidden", "class"], childList: true, characterData: true, subtree: true });
  panel.innerHTML = `<div class="tool-buttons" role="group" aria-label="每步思考时间"><button type="button" data-time="100">0.1 秒</button><button type="button" data-time="500">0.5 秒</button><button type="button" data-time="1000">1 秒</button><button type="button" data-time="5000">5 秒</button><button type="button" data-time="10000">10 秒</button><button type="button" data-time="adaptive">自适应深思</button><button type="button" data-ponder aria-pressed="true">后台思考</button><button type="button" data-sound aria-pressed="false">声效关</button></div><div class="quick-tools-actions"><button type="button" data-image>截图导入</button><button type="button" data-archive>最近对局</button><button type="button" data-collapse>收起</button></div><p>用于后续自动落子；推荐仍为 1 秒。关闭后台思考可省电。</p>${updateControlMarkup()}`;
  const workspace = document.createElement("section"); workspace.className = "enhancement-workspace"; workspace.hidden = true;
  const remoteEntry = document.createElement("button"); remoteEntry.type = "button"; remoteEntry.dataset.remoteMenu = ""; remoteEntry.textContent = "电脑引擎";
  panel.querySelector(".quick-tools-actions").append(remoteEntry);
  const setupEntry = document.createElement("button"); setupEntry.type = "button"; setupEntry.textContent = "自定义摆局";
  setupEntry.onclick = () => { collapse(); $("#openSetup").click(); }; remoteEntry.before(setupEntry);
  const fullEntry = document.createElement("button"); fullEntry.type = "button"; fullEntry.textContent = "完整界面"; fullEntry.dataset.fullView = "";
  fullEntry.onclick = () => { collapse(); exitSimple?.(); }; panel.querySelector(".quick-tools-actions").append(fullEntry);
  workspace.setAttribute("aria-label", "对局工具"); workspace.tabIndex = -1; document.body.append(workspace);
  const imageRoot = document.createElement("div"), reviewRoot = document.createElement("div"), archiveRoot=document.createElement("div"); imageRoot.hidden = reviewRoot.hidden = archiveRoot.hidden = true; workspace.append(imageRoot, reviewRoot,archiveRoot);
  let active = null, recordKey = null, opening = false, currentReview=true;
  function collapse() { panel.hidden = true; toggle.setAttribute("aria-expanded", "false"); }
  function close({ resume = true } = {}) {
    if (!active) return;
    const previous = active; active = null;
    if (previous === "image") image.dispose(); else if(previous==="review") review.dispose();else history.dispose();
    workspace.hidden = true; imageRoot.hidden = reviewRoot.hidden = archiveRoot.hidden = true; shell.hidden = false;
    if (resume) onWorkspace(false); toggle.focus();
  }
  const image = createImageImport(imageRoot, { getPosition, applyRecord, close });
  const review = createReviewUi(reviewRoot, { search, cancelSearch, close, newGame: () => { close(); newGame(); }, branch: record => {
    close({ resume: false }); try { resumeRecord?.({ record }); } finally { onWorkspace(false); }
  } });
  const history=createArchiveUi(archiveRoot,{archive:archive??{list:()=>[],failed:false},close,resume:entry=>{if(resumeRecord?.(entry)!==false)close();},review:record=>{close({resume:false});open("review",record);},exportRecord:(record,format='json')=>{
    const text=format==='sgf'?sessionSgf(record):JSON.stringify(record,null,2)+'\n';
    downloadText(text,exportName('record',format==='sgf'?'sgf':'gomoku.json'),format==='sgf'?'application/x-go-sgf':'application/json');
  },exportImage:async record=>{
    const session=sessionFromRecord(record),blob=await boardImageBlob({board:session.board,lastMove:session.lastMove,candidates:session.candidates});
    downloadBlob(blob,exportName('board','png'));
  }});

  function open(kind, archivedRecord=null) {
    if (active || kind === "review" && !archivedRecord && !getPosition().winner) return;
    const record = structuredClone(archivedRecord??getRecord()); recordKey = JSON.stringify(record);currentReview=!archivedRecord;
    collapse(); active = kind; opening = true; onWorkspace(true); opening = false;
    shell.hidden = true; workspace.hidden = false; imageRoot.hidden = kind !== "image"; reviewRoot.hidden = kind !== "review";archiveRoot.hidden=kind!=="archive"; workspace.focus();
    if (kind === "image") image.open(); else if(kind==="review")void review.open(record);else history.open();
    $("#recordMenu").open = false;
  }
  toggle.onclick = () => { panel.hidden = !panel.hidden; toggle.setAttribute("aria-expanded", String(!panel.hidden)); };
  panel.querySelector("[data-collapse]").onclick = collapse;
  for (const button of panel.querySelectorAll("[data-time]")) button.onclick = () => {
    const select = $("#timeSelect"); if (select.disabled) return;
    select.value = button.dataset.time; select.dispatchEvent(new Event("change")); collapse(); render();
  };
  panel.querySelector("[data-ponder]").onclick = () => { const input = $("#ponderToggle"); if (input.disabled) return; input.checked = !input.checked; input.dispatchEvent(new Event("change")); collapse(); render(); };
  const soundButton = panel.querySelector("[data-sound]");
  function toggleSound() { if (!sound) return; const enabled = sound.setEnabled(!sound.enabled); if (enabled) sound.playStone(); render(); }
  soundButton.hidden = !sound; soundButton.onclick = () => { toggleSound(); collapse(); };
  panel.querySelector("[data-image]").onclick = () => open("image"); reviewEntry.onclick = () => open("review");
  panel.querySelector("[data-archive]").onclick=()=>open("archive");
  const fullImage = document.createElement("button"); fullImage.type = "button"; $(".record-options").append(fullImage);
  fullImage.textContent = "截图导入"; fullImage.onclick = () => open("image");
  const fullArchive=document.createElement("button");fullArchive.type="button";fullArchive.textContent="最近对局";fullArchive.onclick=()=>open("archive");$(".record-options").append(fullArchive);
  const saveImage = async () => { try {
    const position=getPosition(), blob=await boardImageBlob({board:Array.from(position.board),lastMove:position.lastMove,candidates:[...(position.candidates??[])]});
    downloadBlob(blob,exportName('board','png')); notify?.('棋盘图片已导出');
  } catch(error) { notify?.(`保存图片失败：${error.message}`,true); } };
  const quickImage=document.createElement('button');quickImage.type='button';quickImage.textContent='保存棋盘图';quickImage.onclick=()=>{collapse();void saveImage();};panel.querySelector('.quick-tools-actions').append(quickImage);
  const fullBoardImage=document.createElement('button');fullBoardImage.type='button';fullBoardImage.textContent='保存棋盘图';fullBoardImage.onclick=()=>{ $("#recordMenu").open=false;void saveImage(); };$(".record-options").append(fullBoardImage);
  const copyRecord = async format => { try {
    if (!navigator.clipboard?.writeText) throw new Error('当前浏览器不支持复制，请使用文件导出');
    const record=getRecord(), text=format==='sgf'?sessionSgf(record):JSON.stringify(record,null,2);
    await navigator.clipboard.writeText(text); notify?.(format==='sgf'?'已复制 SGF 棋谱':'已复制五目棋谱');
  } catch(error) { notify?.(`复制失败：${error.message}`,true); } };
  for(const format of ['sgf','json']) {
    const label=format==='sgf'?'复制 SGF':'复制五目棋谱';
    const full=document.createElement('button');full.type='button';full.textContent=label;full.onclick=()=>{$('#recordMenu').open=false;void copyRecord(format);};$('.record-options').append(full);
    const quick=document.createElement('button');quick.type='button';quick.textContent=label;quick.onclick=()=>{collapse();void copyRecord(format);};panel.querySelector('.quick-tools-actions').append(quick);
  }
  const quickHints=document.createElement("button"),quickSelf=document.createElement("button"),fullHints=document.createElement("button"),fullSelf=document.createElement("button");
  for(const button of [quickHints,quickSelf,fullHints,fullSelf]) button.type="button";
  quickHints.onclick=()=>{toggleHints?.();collapse();}; fullHints.onclick=()=>{toggleHints?.();$("#recordMenu").open=false;};
  quickSelf.onclick=()=>{toggleSelfPlay?.();collapse();}; fullSelf.onclick=()=>{toggleSelfPlay?.();$("#recordMenu").open=false;};
  panel.querySelector(".quick-tools-actions").append(quickHints,quickSelf);
  const spectatorControls=document.createElement("div"); spectatorControls.className="spectator-controls"; spectatorControls.append(fullHints,fullSelf); $(".game-actions").after(spectatorControls);
  const makeSpectatorPanel=()=>{
    const details=document.createElement("details");details.className="spectator-settings";details.hidden=true;
    details.innerHTML='<summary>观战设置</summary><div><label>黑棋思考 <select data-spectator="black"><option value="shared">跟随每步思考</option><option value="100">0.1 秒</option><option value="500">0.5 秒</option><option value="1000">1 秒</option><option value="5000">5 秒</option><option value="10000">10 秒</option></select></label><label>白棋思考 <select data-spectator="white"><option value="shared">跟随每步思考</option><option value="100">0.1 秒</option><option value="500">0.5 秒</option><option value="1000">1 秒</option><option value="5000">5 秒</option><option value="10000">10 秒</option></select></label><label>落子间隔 <select data-spectator="delay"><option value="0">无间隔</option><option value="500">0.5 秒</option><option value="1000">1 秒</option><option value="2000">2 秒</option></select></label><button type="button" data-step>下一步</button></div><p>设置从下一次思考生效；暂停后可单步观看。键盘空格暂停或继续，右方向键单步。开局换色按当前执色分配。</p>';
    for(const input of details.querySelectorAll("[data-spectator]")) input.onchange=()=>{onSpectatorChange?.(input.dataset.spectator,input.value); render();};
    details.querySelector("[data-step]").onclick=()=>stepSelfPlay?.();
    return details;
  };
  const fullSpectator=makeSpectatorPanel(),quickSpectator=makeSpectatorPanel();
  spectatorControls.after(fullSpectator);panel.querySelector(".quick-tools-actions").after(quickSpectator);
  const fullSound=document.createElement("button");fullSound.type="button";fullSound.hidden=!sound;fullSound.onclick=toggleSound;$(".record-options").append(fullSound);
  // Put the full-mode postgame entry beside New as well as in the menu.
  const resultButton = document.createElement("button"); resultButton.type = "button"; resultButton.className = "icon-button"; resultButton.textContent = "复盘"; resultButton.hidden = true; resultButton.onclick = () => open("review"); $(".game-actions").append(resultButton);
  const fullPause=document.createElement("button");fullPause.type="button";fullPause.className="icon-button";fullPause.hidden=true;fullPause.onclick=()=>getPosition().paused?resumeSearch?.():pauseSearch?.();$(".game-actions").append(fullPause);
  function render() {
    const position = getPosition(), controls=getControlState?.();
    for(const b of [quickHints,fullHints]) { b.hidden=!controls; b.textContent=controls?.showHints?"隐藏棋盘提示":"显示棋盘提示"; b.setAttribute("aria-pressed", String(!controls?.showHints)); }
    for(const b of [quickSelf,fullSelf]) { b.hidden=!controls || (!controls.canSelfPlay && !controls.selfPlay); b.textContent=controls?.selfPlay?"结束 AI 接管":"AI 接管我方"; b.setAttribute("aria-pressed", String(Boolean(controls?.selfPlay))); }
    for(const area of [fullSpectator,quickSpectator]) {
      area.hidden=!position.selfPlay;
      for(const input of area.querySelectorAll("[data-spectator]")) input.value=spectatorSettings?.[input.dataset.spectator]??(input.dataset.spectator==="delay"?"0":"shared");
      area.querySelector("[data-step]").disabled=!position.paused || !position.selfPlay;
    }
    retryEntry.hidden = position.state !== "error" || Boolean(position.winner);
    pauseEntry.hidden=!(((position.busy && $("#timeSelect").value==="adaptive") || (position.selfPlay && !position.paused)) && pauseSearch);resumeEntry.hidden=!position.paused;
    fullPause.hidden=pauseEntry.hidden&&resumeEntry.hidden;fullPause.textContent=position.paused?"继续思考":"暂停思考";
    syncNotice();
    for (const b of [reviewEntry, resultButton]) b.hidden = !position.winner;
    const time = $("#timeSelect"), ponder = $("#ponderToggle"); toggle.textContent = "更多";
    toggle.setAttribute("aria-label", time.value==="adaptive"?"自适应深思 0～6 秒，展开快捷设置":`每步最多 ${Number(time.value) / 1000} 秒，展开快捷设置与截图导入`);
    for (const b of panel.querySelectorAll("[data-time]")) { b.disabled = time.disabled; b.setAttribute("aria-pressed", String(b.dataset.time === time.value)); }
    const p = panel.querySelector("[data-ponder]"); p.disabled = ponder.disabled; p.setAttribute("aria-pressed", String(ponder.checked)); p.textContent = `后台${ponder.checked ? "开" : "关"}`;
    soundButton.setAttribute("aria-pressed", String(Boolean(sound?.enabled))); soundButton.textContent = `声效${sound?.enabled ? "开" : "关"}`;
    fullSound.setAttribute("aria-pressed", String(Boolean(sound?.enabled))); fullSound.textContent = `声效：${sound?.enabled ? "开" : "关"}`;
    if (!document.body.classList.contains("simple-mode")) collapse();
    // Undo, import and New invalidate a terminal review immediately. Applying a
    // screenshot is allowed to finish its own close without reentrant disposal.
    if (active === "review" && currentReview && !opening && (!position.winner || JSON.stringify(getRecord()) !== recordKey)) close();
  }
  document.addEventListener("pointerdown", event => { if (!panel.hidden && !panel.contains(event.target) && !toggle.contains(event.target)) collapse(); });
  document.addEventListener("keydown", event => { if (event.key !== "Escape") return; if (active) { event.preventDefault(); event.stopImmediatePropagation(); close(); } else if (!panel.hidden) { event.preventDefault(); event.stopImmediatePropagation(); collapse(); toggle.focus(); } }, true);
  $("#timeSelect").addEventListener("change", render); $("#ponderToggle").addEventListener("change", render);
  render(); return { render, close, get active() { return active; } };
}
