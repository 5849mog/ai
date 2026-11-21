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
  simpleRate: ["简洁界面显示胜率", true]
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
      <div class="appearance-options">${Object.entries(switches).map(([key, [label]]) =>
        `<label><input type="checkbox" data-appearance="${key}">${label}</label>`).join("")}</div>
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
    return { fields: [...mount.querySelectorAll("[data-appearance]")], reset: mount.querySelector("[data-reset-appearance]") };
  });
  function apply() {
    for (const [key, value] of Object.entries(settings)) board.dataset[key] = String(value);
    const defaults = defaultBoardAppearance();
    for (const view of views) {
      view.reset.disabled = Object.keys(defaults).every(key => defaults[key] === settings[key]);
      for (const input of view.fields) {
        const key = input.dataset.appearance;
        if (key === "theme") input.value = settings.theme;
        else input.checked = settings[key];
        input.disabled = key === "farCoordinates" && !settings.coordinates;
      }
    }
    onChange?.(settings);
  }
  function save() {
    try { storage.setItem(KEY, JSON.stringify(settings)); } catch { /* Apply for this page. */ }
    apply();
  }
  for (const view of views) {
    view.reset.onclick = () => { settings = defaultBoardAppearance(); save(); };
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
