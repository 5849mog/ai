import { createImageImport } from "./image-import-ui.js";
import { createReviewUi } from "./review-ui.js";
import { SPECTATOR_DELAYS, spectatorBudgets } from "./thinking-options.js";
import { createQuickSettings } from "./quick-settings.js";
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
  const pauseEntry = document.createElement("button"); pauseEntry.type = "button"; status.append(pauseEntry);
  const simpleStep = document.createElement("button"); simpleStep.type = "button"; status.append(simpleStep);
  const quick = createQuickSettings(document, status), { panel, toggle, close: collapse } = quick;
  const notice = document.createElement("div"); notice.className = "simple-notice"; notice.hidden = true; notice.setAttribute("role", "status"); status.after(notice);
  const sourceNotice = $("#gameNotice");
  function syncNotice() {
    const hidden = !sourceNotice || sourceNotice.hidden || !sourceNotice.textContent;
    const text = hidden ? "" : sourceNotice.textContent;
    if (notice.hidden !== hidden || notice.textContent !== text) {
      notice.hidden = hidden;
      notice.textContent = text;
      quick.fit();
    }
    notice.classList.toggle("error", Boolean(sourceNotice?.classList.contains("error")));
  }
  if (sourceNotice && typeof MutationObserver === "function") new MutationObserver(syncNotice).observe(sourceNotice,
    { attributes: true, attributeFilter: ["hidden", "class"], childList: true, characterData: true, subtree: true });
  const workspace = document.createElement("section"); workspace.className = "enhancement-workspace"; workspace.hidden = true;
  panel.querySelector("[data-quick-setup]").onclick = () => { collapse({ immediate: true }); $("#openSetup").click(); };
  panel.querySelector("[data-quick-import]").onclick = () => { collapse({ immediate: true }); $("#importRecord").click(); };
  panel.querySelector("[data-full-view]").onclick = () => { collapse({ immediate: true }); exitSimple?.(); };
  workspace.setAttribute("aria-label", "对局工具"); workspace.tabIndex = -1; document.body.append(workspace);
  const imageRoot = document.createElement("div"), reviewRoot = document.createElement("div"), archiveRoot=document.createElement("div"); imageRoot.hidden = reviewRoot.hidden = archiveRoot.hidden = true; workspace.append(imageRoot, reviewRoot,archiveRoot);
  let active = null, recordKey = null, opening = false, currentReview=true;
  function close({ resume = true, imported = false, saved = false } = {}) {
    if (!active) return;
    const previous = active; active = null;
    if (previous === "image") image.dispose(); else if(previous==="review") review.dispose();else history.dispose();
    workspace.hidden = true; imageRoot.hidden = reviewRoot.hidden = archiveRoot.hidden = true; shell.hidden = false;
    if (resume) onWorkspace(false);
    const trigger = imported ? $("#boardSvg")
      : previous === "image" && !document.body.classList.contains("simple-mode") ? $("#recordMenu summary") : toggle;
    trigger?.focus({ preventScroll: true });
    if (imported) notify?.(saved ? "已从截图局面开始对弈" : "截图局面已开始，暂未保存，请导出棋谱", !saved);
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
    collapse({ restoreFocus: false, immediate: true }); active = kind; opening = true; onWorkspace(true); opening = false;
    shell.hidden = true; workspace.hidden = false; imageRoot.hidden = kind !== "image"; reviewRoot.hidden = kind !== "review";archiveRoot.hidden=kind!=="archive"; workspace.focus();
    if (kind === "image") { image.open(); imageRoot.querySelector("input[type=file]")?.focus({ preventScroll: true }); }
    else if(kind==="review")void review.open(record);else history.open();
    $("#recordMenu").open = false;
  }
  const times = [...panel.querySelectorAll("[data-time]")], timeSelect = $("#timeSelect"), ponderInput = $("#ponderToggle");
  const ponder = panel.querySelector("[data-ponder]"), soundButton = panel.querySelector("[data-sound]");
  const perspectiveField = panel.querySelector("[data-quick-perspective]"), perspective = perspectiveField.querySelector("select"), colorSelect = $("#colorSelect");
  perspective.onchange = () => {
    if (!colorSelect) return;
    colorSelect.value = perspective.value;
    colorSelect.dispatchEvent(new Event("change"));
  };
  function setTime(value) {
    if (timeSelect.disabled || timeSelect.value === value) return;
    timeSelect.value = value;
    timeSelect.dispatchEvent(new Event("change"));
  }
  for (const [index, button] of times.entries()) {
    button.onclick = () => setTime(button.dataset.time);
    button.onkeydown = event => {
      if (timeSelect.disabled || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const direction = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? times.length - 1
        : Object.hasOwn(direction, event.key) ? (index + direction[event.key] + times.length) % times.length : -1;
      if (nextIndex < 0) return;
      event.preventDefault();
      const next = times[nextIndex];
      setTime(next.dataset.time);
      next.focus({ preventScroll: true });
    };
  }
  ponder.onclick = () => {
    if (ponderInput.disabled) return;
    ponderInput.checked = !ponderInput.checked;
    ponderInput.dispatchEvent(new Event("change"));
  };
  function toggleSound() { if (!sound) return; const enabled = sound.setEnabled(!sound.enabled); if (enabled) sound.playStone(); render(); }
  soundButton.hidden = !sound; soundButton.onclick = toggleSound;
  panel.querySelector("[data-image]").onclick = () => open("image"); reviewEntry.onclick = () => open("review");
  panel.querySelector("[data-archive]").onclick=()=>open("archive");
  const fullImage = document.createElement("button"); fullImage.type = "button"; fullImage.dataset.uiIcon="camera"; $(".record-options").append(fullImage);
  fullImage.textContent = "截图导入"; fullImage.onclick = () => open("image");
  const fullArchive=document.createElement("button");fullArchive.type="button";fullArchive.dataset.uiIcon="guide";fullArchive.textContent="最近对局";fullArchive.onclick=()=>open("archive");$(".record-options").append(fullArchive);
  const saveImage = async () => { try {
    const position=getPosition(), blob=await boardImageBlob({board:Array.from(position.board),lastMove:position.lastMove,candidates:[...(position.candidates??[])]});
    downloadBlob(blob,exportName('board','png')); notify?.('棋盘图片已导出');
  } catch(error) { notify?.(`保存图片失败：${error.message}`,true); } };
  panel.querySelector('[data-quick-save]').onclick = () => { collapse(); void saveImage(); };
  const fullBoardImage=document.createElement('button');fullBoardImage.type='button';fullBoardImage.dataset.uiIcon='camera';fullBoardImage.textContent='保存棋盘图';fullBoardImage.onclick=()=>{ $("#recordMenu").open=false;void saveImage(); };$(".record-options").append(fullBoardImage);
  const copyRecord = async format => { try {
    if (!navigator.clipboard?.writeText) throw new Error('当前浏览器不支持复制，请使用文件导出');
    const record=getRecord(), text=format==='sgf'?sessionSgf(record):JSON.stringify(record,null,2);
    await navigator.clipboard.writeText(text); notify?.(format==='sgf'?'已复制 SGF 棋谱':'已复制五目棋谱');
  } catch(error) { notify?.(`复制失败：${error.message}`,true); } };
  for(const format of ['sgf','json']) {
    const label=format==='sgf'?'复制 SGF':'复制五目棋谱';
    const full=document.createElement('button');full.type='button';full.dataset.uiIcon='copy';full.textContent=label;full.onclick=()=>{$('#recordMenu').open=false;void copyRecord(format);};$('.record-options').append(full);
    panel.querySelector(`[data-quick-copy=${format}]`).onclick = () => { collapse(); void copyRecord(format); };
  }
  const quickHints = panel.querySelector("[data-hints]"), quickSelf = panel.querySelector("[data-takeover]");
  const fullHints = document.createElement("button"), fullSelf = document.createElement("button");
  fullHints.type = fullSelf.type = "button";
  fullHints.dataset.uiIcon = "eye"; fullSelf.dataset.uiIcon = "bot";
  quickHints.onclick = () => toggleHints?.();
  fullHints.onclick = () => { toggleHints?.(); $("#recordMenu").open = false; };
  quickSelf.onclick = () => {
    const position = getPosition();
    toggleSelfPlay?.(); collapse();
    notify?.(position.selfPlay ? "已结束 AI 接管" : "已开启 AI 自战，可随时暂停");
  };
  fullSelf.onclick = () => {
    const position = getPosition();
    toggleSelfPlay?.(); $("#recordMenu").open = false;
    notify?.(position.selfPlay ? "已结束 AI 接管" : "已开启 AI 自战，可随时暂停");
  };
  const spectatorControls=document.createElement("div"); spectatorControls.className="spectator-controls"; spectatorControls.append(fullHints,fullSelf); $(".game-actions").after(spectatorControls);
  const makeSpectatorPanel=()=>{
    const details=document.createElement("details");details.className="spectator-settings";details.hidden=true;
    details.innerHTML = `<summary>观战设置</summary><div>
      <label>黑棋思考 <select data-spectator="black">${spectatorBudgets()}</select></label>
      <label>白棋思考 <select data-spectator="white">${spectatorBudgets()}</select></label>
      <label>落子间隔 <select data-spectator="delay">${SPECTATOR_DELAYS.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>
      <button type="button" data-reset-spectator>恢复观战默认</button></div>
      <p>设置从下一次思考生效。键盘空格暂停或继续，右方向键单步。开局换色按当前执色分配。</p>`;
    for(const input of details.querySelectorAll("[data-spectator]")) input.onchange=()=>{onSpectatorChange?.(input.dataset.spectator,input.value); render();};
    details.querySelector("[data-reset-spectator]").onclick = () => {
      for (const [key, value] of Object.entries({ black: "shared", white: "shared", delay: "0" })) onSpectatorChange?.(key, value);
      render();
    };
    return details;
  };
  const fullSpectator=makeSpectatorPanel(),quickSpectator=makeSpectatorPanel();
  spectatorControls.after(fullSpectator); panel.querySelector("[data-quick-spectator]").append(quickSpectator);
  const fullSound=document.createElement("button");fullSound.type="button";fullSound.dataset.uiIcon="audio";fullSound.hidden=!sound;fullSound.onclick=toggleSound;$(".record-options").append(fullSound);
  // Put the full-mode postgame entry beside New as well as in the menu.
  const resultButton = document.createElement("button"); resultButton.type = "button"; resultButton.className = "icon-button"; resultButton.textContent = "复盘"; resultButton.hidden = true; resultButton.onclick = () => open("review"); $(".game-actions").append(resultButton);
  const fullPause = document.createElement("button"), fullStep = document.createElement("button");
  for (const button of [fullPause, fullStep]) { button.type = "button"; button.className = "icon-button"; }
  $(".game-actions").append(fullPause, fullStep);
  for (const [pause, step] of [[pauseEntry, simpleStep], [fullPause, fullStep]]) {
    pause.onclick = () => getPosition().paused ? resumeSearch?.() : pauseSearch?.();
    step.setAttribute("data-step", ""); step.textContent = "下一步";
    step.onclick = () => { if (document.activeElement === step) pause.focus(); stepSelfPlay?.(); };
  }
  let lastPreferences = "";
  function render() {
    const position = getPosition(), controls=getControlState?.();
    perspectiveField.hidden = position.workflow !== "follow" || !colorSelect || Boolean(colorSelect.closest("label")?.hidden);
    if (colorSelect && perspective.value !== colorSelect.value) perspective.value = colorSelect.value;
    fullHints.hidden = quickHints.hidden = !controls;
    const hintsLabel = controls?.showHints ? "隐藏棋盘提示" : "显示棋盘提示";
    if (fullHints.textContent !== hintsLabel) fullHints.textContent = hintsLabel;
    fullHints.setAttribute("aria-pressed", String(!controls?.showHints));
    for(const b of [quickSelf,fullSelf]) { b.hidden=!controls || (!controls.canSelfPlay && !controls.selfPlay); const label=controls?.selfPlay?"结束 AI 接管":"AI 接管我方"; if (b.textContent!==label) b.textContent=label; b.setAttribute("aria-pressed", String(Boolean(controls?.selfPlay))); }
    for(const area of [fullSpectator,quickSpectator]) {
      area.hidden=!position.selfPlay;
      if (area.hidden) area.open = false;
      for(const input of area.querySelectorAll("[data-spectator]")) { const value=spectatorSettings?.[input.dataset.spectator]??(input.dataset.spectator==="delay"?"0":"shared"); if(input.value!==value)input.value=value; }
      area.querySelector("[data-reset-spectator]").disabled = [...area.querySelectorAll("[data-spectator]")].every(input => input.selectedIndex === 0);
    }
    retryEntry.hidden = position.state !== "error" || Boolean(position.winner);
    for (const [pause, step] of [[pauseEntry, simpleStep], [fullPause, fullStep]]) {
      const focused = document.activeElement;
      pause.hidden = position.paused ? !resumeSearch : !position.canPause || !pauseSearch;
      const label = position.paused ? "继续思考" : "暂停思考";
      if (pause.textContent !== label) pause.textContent = label;
      step.hidden = !(position.selfPlay && position.paused && stepSelfPlay);
      if (focused === pause && pause.hidden || focused === step && step.hidden) {
        (pause.hidden ? $("#boardSvg") : pause)?.focus({ preventScroll: true });
      }
    }
    syncNotice();
    for (const b of [reviewEntry, resultButton]) b.hidden = !position.winner;
    const preferences = JSON.stringify([timeSelect.value, timeSelect.disabled, ponderInput.checked, ponderInput.disabled, controls?.showHints, sound?.enabled]);
    if (preferences !== lastPreferences) {
      lastPreferences = preferences;
      toggle.title = timeSelect.value === "adaptive" ? "自适应深思 0～6 秒" : `每步最多 ${Number(timeSelect.value) / 1000} 秒`;
      for (const button of times) {
        const selected = button.dataset.time === timeSelect.value;
        button.disabled = timeSelect.disabled;
        button.setAttribute("aria-checked", String(selected));
        button.tabIndex = selected && !timeSelect.disabled ? 0 : -1;
      }
      ponder.disabled = ponderInput.disabled;
      ponder.setAttribute("aria-checked", String(ponderInput.checked));
      quickHints.setAttribute("aria-checked", String(Boolean(controls?.showHints)));
      soundButton.setAttribute("aria-checked", String(Boolean(sound?.enabled)));
      fullSound.setAttribute("aria-pressed", String(Boolean(sound?.enabled)));
      fullSound.textContent = `声效：${sound?.enabled ? "开" : "关"}`;
    }
    if (!document.body.classList.contains("simple-mode")) collapse({ restoreFocus: false, immediate: true });
    // Undo, import and New invalidate a terminal review immediately. Applying a
    // screenshot is allowed to finish its own close without reentrant disposal.
    if (active === "review" && currentReview && !opening && (!position.winner || JSON.stringify(getRecord()) !== recordKey)) close();
  }
  document.addEventListener("keydown", event => { if (event.key !== "Escape") return; if (active) { event.preventDefault(); event.stopImmediatePropagation(); close(); } else if (quick.opened) { event.preventDefault(); event.stopImmediatePropagation(); collapse(); toggle.focus(); } }, true);
  timeSelect.addEventListener("change", render); ponderInput.addEventListener("change", render); colorSelect?.addEventListener("change", render);
  render(); return { render, close, get active() { return active; } };
}
