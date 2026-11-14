import { createBoardView, coordinate } from "./board-view.js";
import { analyzeReview, reviewHighlights } from "./game-review.js";
import { reviewFramesIncludingUnfinished } from "./partial-review.js";
import { reviewBranch } from "./review-branch.js";
import { exportName, downloadText, downloadBlob } from "./export-utils.js";
import { sessionSgf } from "./session-records.js";
import { boardImageBlob } from "./board-image.js";
import { analyzeOpeningReview } from "./opening-review.js";

export function createReviewUi(root, { search, cancelSearch, close, newGame, branch }) {
  root.innerHTML = `<header class="tool-header"><h2>本局复盘</h2><div><button type="button" data-close>返回结果</button><button type="button" data-new>新局</button></div></header>
    <p class="tool-message" role="status"></p><div class="tool-workspace"><div class="tool-board-area"><svg class="board-svg" viewBox="20 20 580 580" role="img" tabindex="0" aria-label="复盘棋盘，方向键逐步回放，上下键跳五步，空格播放或暂停"></svg></div>
    <div class="tool-panel"><div class="review-navigation"><button type="button" data-first>开头</button><button type="button" data-prev>上一手</button><strong data-step></strong><button type="button" data-next>下一手</button><button type="button" data-last>末尾</button></div><input type="range" data-timeline min="0" value="0" aria-label="棋谱回放进度" />
    <p class="review-move"></p><details class="review-jumps"><summary>跳转到开局决策</summary><label>节点 <select data-review-jump aria-label="跳转到开局决策"></select></label></details><div class="review-play-options"><label>播放速度 <select data-speed><option value="1400">慢速</option><option value="800" selected>正常</option><option value="400">快速</option></select></label><label>方向 <select data-direction><option value="1">正放</option><option value="-1">倒放</option></select></label></div><div class="tool-buttons"><button type="button" data-best aria-pressed="false" disabled>查看 AI 建议</button><button type="button" data-play aria-pressed="false">自动播放</button><button type="button" data-stop>停止分析</button></div>
    <p class="review-caption">普通落子每次搜索最多 0.5 秒，开局比较每次最多 1 秒。开局结果为有限候选估算；后续仍可换色的阶段不标成确定失误。</p><div class="tool-buttons"><button type="button" data-branch>从此处另开一局</button><button type="button" data-save-frame>保存此刻棋盘图</button><button type="button" data-save-position>导出此处棋谱</button><button type="button" data-save-sgf>导出此处 SGF</button><button type="button" data-deep-review>深入复盘 · 每次最多 5 秒</button></div><div class="opening-review-list" aria-label="开局决策分析"></div><div class="review-highlights" aria-label="本局关键落子"></div></div></div>`;
  const $ = selector => root.querySelector(selector), svg = $("svg"), view = createBoardView(svg, { idPrefix: "review-" });
  let review = null, rows = [], openingRows = [], savedRecord, step = 0, showBest = false, controller = null, generation = 0, playing = false, playTimer = null;
  function stopPlayback() { if (playTimer !== null) clearTimeout(playTimer); playTimer = null; playing = false; }
  function render() {
    if (!review) return;
    const frame = review.frames[step], row = rows.find(r => r.frame === step) ?? openingRows.find(r=>r.frame===step), suggested = showBest && row && (row.best!==null || row.points?.length);
    const groupSuggestion=suggested&&row.kind==="group";
    const boardChanged = view.render({ board: suggested ? row.before : frame.board, lastMove: suggested ? -1 : frame.lastMove, pendingIndex: -1, canInteract: false,
      overlayKey: suggested ? JSON.stringify(row.points??[row.best]) : frame.candidates.join(","),
      editable: Boolean(frame.forbidden) && !suggested, recommendations: suggested&&!groupSuggestion ? [{ index: row.best }] : [] });
    if (boardChanged && (!suggested || groupSuggestion)) for (const [rank, index] of (groupSuggestion?row.points:frame.candidates).entries()) {
      const x = 46 + index % 15 * 528 / 14, y = 46 + Math.floor(index / 15) * 528 / 14;
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g"); group.setAttribute("class", "review-candidate");
      group.innerHTML = `<circle cx="${x}" cy="${y}" r="14"/><text x="${x}" y="${y}">A${rank + 1}</text>`; svg.append(group);
    }
    $("[data-step]").textContent = `${frame.label} · ${step}/${review.frames.length - 1}`; $("[data-first]").disabled = step === 0; $("[data-last]").disabled = step === review.frames.length - 1; $("[data-prev]").disabled = step === 0; $("[data-next]").disabled = step === review.frames.length - 1;
    $("[data-timeline]").value = String(step); $("[data-timeline]").setAttribute("aria-valuetext", `${frame.label}，第 ${step} 步，共 ${review.frames.length - 1} 步`); $("[data-play]").disabled = review.frames.length <= 1; $("[data-best]").disabled = !row || row.best===null && !row.points?.length; $("[data-best]").setAttribute("aria-pressed", String(Boolean(suggested)));
    $("[data-best]").textContent = suggested ? "返回实战落子" : "查看 AI 建议";
    $("[data-play]").textContent = playing ? "暂停播放" : "自动播放"; $("[data-play]").setAttribute("aria-pressed", String(playing));
    $("[data-branch]").disabled = !branch || Boolean(frame.winner) || Boolean(suggested);
    $(".review-move").textContent = row?.note ? `${row.label}：${row.note}${row.choice?` 建议${({keep:"保持执色",swap:"交换执色",ten:"十打"})[row.choice]}。`:""}${row.loss===null?"":` 相比有限候选，估算损失 ${(row.loss*100).toFixed(1)} 个百分点。`}` : row ? `${row.actor === 0 ? "我方" : "对方"}下在 ${coordinate(row.index)}；AI 建议 ${coordinate(row.best)}${row.loss === null ? "；本手未形成可比较的评估。" : `；估算损失 ${(row.loss * 100).toFixed(1)} 个百分点。`}` : "按原棋谱顺序回放。";
    const openingList=$(".opening-review-list");openingList.replaceChildren();
    for(const item of openingRows) {const button=document.createElement("button");button.type="button";button.textContent=`${item.actor===0?"我方":"对方"} · ${item.label}${item.loss===null?" · 阶段分析":` · 估算损失 ${(item.loss*100).toFixed(1)}%`}`;button.onclick=()=>seek(item.frame);openingList.append(button);}
    const highlights = reviewHighlights(rows), container = $(".review-highlights"); container.replaceChildren();
    if (highlights.length) {
      const title = document.createElement("p"); title.textContent = "胜率下降较多的落子（点击定位）"; container.append(title);
      for (const row of highlights) {
        const button = document.createElement("button"); button.type = "button";
        button.textContent = `第 ${row.ply} 手 · ${row.actor === 0 ? "我方" : "对方"} ${coordinate(row.index)} · −${(row.loss * 100).toFixed(1)}%`;
        button.onclick = () => seek(row.frame); container.append(button);
      }
    } else if (rows.length) { const p = document.createElement("p"); p.textContent = rows.some(row => row.loss !== null) ? "可比较的已分析落子中，未发现超过 5 个百分点的损失。" : "目前暂无可比较的胜率评估，仍可回放并查看 AI 建议。"; container.append(p); }
  }
  function seek(value, manual = true) { if (!review) return; if (manual) stopPlayback(); step = Math.max(0, Math.min(review.frames.length - 1, value)); $("[data-review-jump]").value=""; showBest = false; render(); }
  function schedulePlayback() {
    if (!playing || !review) return;
    playTimer = setTimeout(() => {
      playTimer = null; if (!playing || !review) return;
      const direction = Number($("[data-direction]").value); seek(step + direction, false);
      if (direction > 0 ? step >= review.frames.length - 1 : step <= 0) { stopPlayback(); render(); } else schedulePlayback();
    }, Number($("[data-speed]").value));
  }
  $("[data-first]").onclick = () => seek(0); $("[data-last]").onclick = () => seek(review.frames.length - 1);
  $("[data-prev]").onclick = () => seek(step - 1); $("[data-next]").onclick = () => seek(step + 1);
  $("[data-timeline]").oninput = event => seek(Number(event.target.value));
  $("[data-review-jump]").onchange = event => {if(event.target.value!=="")seek(Number(event.target.value));};
  svg.onkeydown = event => { const keys={ArrowLeft:step-1,ArrowRight:step+1,ArrowUp:step+5,ArrowDown:step-5,Home:0,End:review?.frames.length-1}; if(Object.hasOwn(keys,event.key)){event.preventDefault();seek(keys[event.key]);} else if(event.key===" "){event.preventDefault();$("[data-play]").click();} };
  $("[data-direction]").onchange = () => { stopPlayback(); render(); };
  $("[data-speed]").onchange = () => { if(playing){if(playTimer!==null)clearTimeout(playTimer);playTimer=null;schedulePlayback();} };
  $("[data-best]").onclick = () => { stopPlayback(); showBest = !showBest; render(); };
  $("[data-play]").onclick = () => {
    if (!review || review.frames.length <= 1) return;
    if (playing) { stopPlayback(); render(); return; }
    const direction = Number($("[data-direction]").value);
    if (direction > 0 && step === review.frames.length - 1) seek(0, false);
    if (direction < 0 && step === 0) seek(review.frames.length - 1, false);
    playing = true; showBest = false; render(); schedulePlayback();
  };
  document.addEventListener("visibilitychange", () => { if (document.hidden && playing) { stopPlayback(); render(); } });
  $("[data-stop]").onclick = () => { controller?.abort(); cancelSearch(); $(".tool-message").textContent = "分析已停止，已完成的结果仍可查看。"; $("[data-stop]").hidden = true; };
  $("[data-close]").onclick = close; $("[data-new]").onclick = newGame;
  $("[data-branch]").onclick = () => {
    if (!branch || !review || review.frames[step].winner || showBest) return;
    try { const record = reviewBranch(savedRecord, step); stopPlayback(); branch(record); }
    catch (error) { $(".tool-message").textContent = `无法继续：${error.message}`; }
  };
  $("[data-save-frame]").onclick=async()=>{
    if(!review)return;const frame=review.frames[step],selected=step;
    try {const blob=await boardImageBlob({board:frame.board,lastMove:frame.lastMove,candidates:frame.candidates});downloadBlob(blob,exportName(`review-${selected}`,"png"));$(".tool-message").textContent="棋盘图已导出。";}
    catch(error){$(".tool-message").textContent=`保存图片失败：${error.message}`;}
  };
  function exportFrame(format) {
    try {const record=step===review.frames.length-1?savedRecord:reviewBranch(savedRecord,step);const text=format==='sgf'?sessionSgf(record):JSON.stringify(record,null,2)+'\n';downloadText(text,exportName(`review-${step}`,format==='sgf'?'sgf':'gomoku.json'),format==='sgf'?'application/x-go-sgf':'application/json');$(".tool-message").textContent=format==='sgf'&&record.rule&&record.rule!=='freestyle'?`第 ${step} 步 SGF 已导出；完整开局操作请使用五目棋谱。`:`第 ${step} 步棋谱已导出。`;}
    catch(error){$(".tool-message").textContent=`导出失败：${error.message}`;}
  }
  $("[data-save-position]").onclick=()=>exportFrame('json');
  $("[data-save-sgf]").onclick=()=>exportFrame('sgf');
  $("[data-deep-review]").onclick=()=>{controller?.abort();cancelSearch();void open(savedRecord,true);};
  async function open(record,deep=false) {
      stopPlayback();controller?.abort();
      savedRecord=record;
      $(".review-caption").textContent=deep?"深入复盘：每次搜索最多 5 秒，一组候选需要多次搜索。开局结果为有限候选估算；仍可换色的阶段不标成确定失误。":"普通落子每次搜索最多 0.5 秒，开局比较每次最多 1 秒。开局结果为有限候选估算；后续仍可换色的阶段不标成确定失误。";
      review = reviewFramesIncludingUnfinished(record);
      const jump=$("[data-review-jump]"),options=[];
      if(record.format==='gomoku-opening')record.events.forEach((event,i)=>{if(['decision','select'].includes(event.type)){const option=document.createElement('option');option.value=String(i+1);option.textContent=review.frames[i+1].label;options.push(option);}});
      const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=options.length?'选择换色或候选节点':'暂无开局决策';jump.replaceChildren(placeholder,...options);jump.disabled=!options.length;$(".review-jumps").open=false;
       $("[data-close]").textContent=review.winner ? "返回结果" : "返回棋盘"; rows = []; openingRows=[];step = review.frames.length - 1; showBest = false;
      const token = ++generation; controller = new AbortController(); const signal = controller.signal;
      $("[data-timeline]").max = String(review.frames.length - 1); $("[data-stop]").hidden = false;
      $(".tool-message").textContent = `正在分析 ${review.openings.length?"开局决策":"普通落子"}，可先回放棋谱…`; render();
      try {
        const completedOpening=review.openings.length?await analyzeOpeningReview(review,search,{signal,timeMs:deep?5000:1000,onProgress:progress=>{
          if(token!==generation||signal.aborted)return;openingRows=progress.rows;$(".tool-message").textContent=`正在比较开局 ${progress.completed}/${progress.total} 个节点…`;render();
        }}):[];
        if(token!==generation||signal.aborted)return;
        openingRows=completedOpening;
        const completed = await analyzeReview(review, search, { signal, timeMs:deep?5000:500,onProgress: progress => {
          if (token !== generation || signal.aborted) return;
          rows = progress.rows; $(".tool-message").textContent = `正在分析 ${progress.completed}/${progress.total} 手…`; render();
        } });
        if (token !== generation || signal.aborted) return;
        rows = completed; $(".tool-message").textContent = `复盘完成 · ${openingRows.length} 个开局节点，${rows.length} 手普通落子。点击节点查看比较。`; render();
      } catch (error) {
        if (token !== generation || error.name === "AbortError") return;
        $(".tool-message").textContent = `分析暂未完成：${error.message}。仍可回放棋谱，返回后可重新复盘。`;
      } finally { if (token === generation) $("[data-stop]").hidden = true; }
  }
  return {
    open,
    dispose() { stopPlayback(); generation++; controller?.abort(); cancelSearch(); controller = null; review = null; rows = []; openingRows=[]; }
  };
}
