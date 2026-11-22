const KEY = "gomoku-board-appearance:v1";
const switches = {
  coordinates: ["棋盘坐标", false],
  farCoordinates: ["四边都显示坐标", false],
  moveNumbers: ["最近八手编号", false],
  starPoints: ["星位", true],
  lastMarker: ["最后一手圆环", true],
  answerMarker: ["AI 应手圆环", true],
  aimGuides: ["触屏十字线", true],
  texturedStones: ["棋子纹理", true],
  winningLine: ["连五标线", true],
  largeMarkers: ["加大推荐数字", false],
  contrast: ["加深棋盘线", false],
  stillBoard: ["关闭棋盘动效", false],
  touchConfirm: ["触屏二次确认", true],
  touchLoupe: ["触屏瞄准放大镜", false],
  reversed: ["翻转棋盘 180°", false],
  tacticalNotes: ["显示战术提示", true],
  tacticalMap: ["棋盘标出攻守点", false],
  simpleRate: ["简洁界面显示胜率", true]
};

const appearanceGroups = [
  ["坐标与手数", ["coordinates", "farCoordinates", "moveNumbers", "reversed"]],
  ["落子提示", ["lastMarker", "answerMarker", "aimGuides", "winningLine", "largeMarkers", "tacticalMap"]],
  ["棋盘外观", ["starPoints", "texturedStones", "contrast"]],
  ["操作与显示", ["stillBoard", "touchConfirm", "touchLoupe", "tacticalNotes", "simpleRate"]]
];
const presets = {
  plain: { theme: "paper", starPoints: true, texturedStones: false, contrast: true, stillBoard: true },
  practice: { theme: "wood", coordinates: true, farCoordinates: true, moveNumbers: true, largeMarkers: true, contrast: true }
};

export function defaultBoardAppearance() {
  return { theme: "wood", ...Object.fromEntries(Object.entries(switches).map(([key, [, value]]) => [key, value])) };
}

export function readBoardAppearance(storage) {
  const defaults = defaultBoardAppearance();
  try {
    const saved = JSON.parse(storage.getItem(KEY));
    if (["wood", "paper", "slate"].includes(saved?.theme)) defaults.theme = saved.theme;
    for (const key of Object.keys(switches)) if (typeof saved?.[key] === "boolean") defaults[key] = saved[key];
  } catch { /* Use the standard board. */ }
  return defaults;
}

export function setupBoardAppearance({ document: doc, board, storage, onChange }) {
  let settings = readBoardAppearance(storage);
  const views = [...doc.querySelectorAll("[data-board-appearance]")].map((mount, index) => {
    const id = `boardAppearance-${index}`;
    const inline = mount.dataset.boardAppearance === "inline";
    mount.innerHTML = `${inline ? "" : `<button type="button" data-open-appearance data-ui-icon="board" aria-expanded="false" aria-controls="${id}">棋盘显示</button>`}
      <section class="board-appearance" id="${id}" aria-label="棋盘显示"${inline ? "" : " hidden"}>
      <label class="appearance-theme">棋盘主题 <select data-appearance="theme"><option value="wood">原木</option><option value="paper">浅纸</option><option value="slate">青灰</option></select></label>
      <div class="appearance-presets" aria-label="棋盘显示方案"><button type="button" data-appearance-preset="plain">清晰棋盘</button><button type="button" data-appearance-preset="practice">记谱辅助</button></div>
      ${appearanceGroups.map(([title, keys]) => `<fieldset class="appearance-group"><legend>${title}</legend>
        <div class="appearance-options">${keys.map(key => `<label><input type="checkbox" data-appearance="${key}">${switches[key][0]}</label>`).join("")}</div></fieldset>`).join("")}
      <button type="button" data-reset-appearance>恢复默认</button></section>`;
    const toggle = mount.querySelector("[data-open-appearance]"), panel = mount.querySelector("section");
    if (toggle) toggle.onclick = () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute("aria-expanded", String(!panel.hidden));
      const menu = mount.closest(".record-options");
      if (!panel.hidden && menu && panel.getBoundingClientRect().bottom > menu.getBoundingClientRect().bottom) {
        menu.scrollTop += Math.max(0, toggle.getBoundingClientRect().top - menu.getBoundingClientRect().top - 6);
      }
    };
    return { fields: [...mount.querySelectorAll("[data-appearance]")], reset: mount.querySelector("[data-reset-appearance]"),
      presets: [...mount.querySelectorAll("[data-appearance-preset]")] };
  });
  function apply() {
    for (const [key, value] of Object.entries(settings)) board.dataset[key] = String(value);
    const defaults = defaultBoardAppearance();
    for (const view of views) {
      view.reset.disabled = Object.keys(defaults).every(key => defaults[key] === settings[key]);
      for (const button of view.presets) {
        const preset = presets[button.dataset.appearancePreset];
        button.setAttribute("aria-pressed", String(Object.entries(preset).every(([key, value]) => settings[key] === value)));
      }
      for (const input of view.fields) {
        const key = input.dataset.appearance;
        if (key === "theme") input.value = settings.theme;
        else input.checked = settings[key];
        input.disabled = key === "farCoordinates" && !settings.coordinates;
        if (key === "farCoordinates") input.parentElement.title = input.disabled ? "先开启棋盘坐标" : "";
      }
    }
    onChange?.(settings);
  }
  function save() {
    try { storage.setItem(KEY, JSON.stringify(settings)); } catch { /* Apply for this page. */ }
    apply();
  }
  for (const view of views) {
    for (const button of view.presets) button.onclick = () => {
      settings = { ...settings, ...presets[button.dataset.appearancePreset] };
      save();
    };
    view.reset.onclick = () => {
      const focused = doc.activeElement === view.reset;
      settings = defaultBoardAppearance(); save();
      if (focused) view.fields[0].focus({ preventScroll: true });
    };
    for (const field of view.fields) field.onchange = () => {
      const key = field.dataset.appearance;
      settings = { ...settings, [key]: key === "theme" ? field.value : field.checked };
      save();
    };
  }
  doc.defaultView?.addEventListener("storage", event => {
    if (event.key !== KEY && event.key !== null) return;
    settings = readBoardAppearance(storage); apply();
  });
  apply();
}
