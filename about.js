const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");

// Exploded engine exhibit: one shared state controls all four layers and copy.
const exhibit = document.querySelector("[data-engine-exhibit]");
const steps = Array.from(document.querySelectorAll("[data-step]"));
const descriptions = {
  board: { index: "01 / POSITION", title: "从完整的棋盘开始。", text: "你的落子确认后，当前棋盘与轮到谁行棋一起交给引擎。每次推演，都以真实局面为起点。" },
  evaluate: { index: "02 / EVALUATION", title: "读懂棋形，衡量局面。", text: "mix9svq 神经网络评估棋盘上的棋形，为搜索提供局势判断。评估分数是比较变化的依据，并不等于实测胜率。" },
  search: { index: "03 / SEARCH", title: "沿着变化，再想几手。", text: "Rapfi 推演双方可能的后续着手，在思考预算内比较变化。开启后台思考后，你考虑落子时，引擎也会分段分析当前局面。" },
  move: { index: "04 / MOVE", title: "千般推演，落于一手。", text: "搜索结束后，引擎返回选定着手。主棋盘检查任务仍然有效、落点仍然合法，再显示棋子；悔棋或重开后的旧搜索结果会被丢弃。" }
};
function selectStep(button) {
  const description = descriptions[button.dataset.step];
  if (!description || !exhibit) return;
  exhibit.dataset.active = button.dataset.step;
  for (const step of steps) step.setAttribute("aria-pressed", String(step === button));
  document.querySelector("#detailIndex").textContent = description.index;
  document.querySelector("#detailTitle").textContent = description.title;
  document.querySelector("#detailText").textContent = description.text;
}
for (const [index, button] of steps.entries()) {
  button.disabled = false;
  button.addEventListener("click", () => selectStep(button));
  button.addEventListener("keydown", event => {
    let next;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % steps.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + steps.length - 1) % steps.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = steps.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    steps[next].focus();
    selectStep(steps[next]);
  });
}

// The archive and constellation stay synchronized whether the visitor reads,
// clicks a node, or moves through the nodes with arrow keys.
const constellation = document.querySelector("[data-constellation]");
const sourceNodes = Array.from(document.querySelectorAll("[data-source-node]"));
const sourceEntries = Array.from(document.querySelectorAll("[data-source-entry]"));
const sourceLabels = {
  wumu: "APPLICATION / GPL-3.0-OR-LATER",
  rapfi: "ENGINE / GPL-3.0-OR-LATER",
  networks: "NEURAL NETWORK / CC0-1.0",
  build: "BUILD + DEPENDENCIES / OPEN LICENSES",
  font: "TYPOGRAPHY / SIL OFL 1.1"
};
let activeSource = "wumu";
function selectSource(key, locate = false) {
  if (!sourceLabels[key] || !constellation) return;
  activeSource = key;
  constellation.dataset.active = key;
  const index = sourceNodes.findIndex(node => node.dataset.sourceNode === key);
  document.querySelector("#constellationCount").textContent = `${String(index + 1).padStart(2, "0")} / ${String(sourceNodes.length).padStart(2, "0")}`;
  document.querySelector("#constellationLabel").textContent = sourceLabels[key];
  for (const node of sourceNodes) node.setAttribute("aria-pressed", String(node.dataset.sourceNode === key));
  for (const entry of sourceEntries) entry.classList.toggle("is-active", entry.dataset.sourceEntry === key);
  if (locate) document.querySelector(`#source-${key}`)?.scrollIntoView({ behavior: motionPreference.matches ? "auto" : "smooth", block: "center" });
}
for (const [index, node] of sourceNodes.entries()) {
  node.disabled = false;
  node.addEventListener("click", () => selectSource(node.dataset.sourceNode, true));
  node.addEventListener("keydown", event => {
    let next;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % sourceNodes.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + sourceNodes.length - 1) % sourceNodes.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = sourceNodes.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    sourceNodes[next].focus();
    selectSource(sourceNodes[next].dataset.sourceNode, true);
  });
}
selectSource(activeSource);
if ("IntersectionObserver" in window && sourceEntries.length) {
  const sourceObserver = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible) selectSource(visible.target.dataset.sourceEntry);
  }, { rootMargin: "-24% 0px -36%", threshold: [0, .2, .5] });
  for (const entry of sourceEntries) sourceObserver.observe(entry);
}

// Content is visible by default. Only below-the-fold items receive entrances.
const reveals = Array.from(document.querySelectorAll(".reveal"));
let revealObserver;
function showAll() {
  revealObserver?.disconnect();
  for (const item of reveals) item.classList.remove("reveal-pending");
}
if (!motionPreference.matches && "IntersectionObserver" in window) {
  revealObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.remove("reveal-pending");
      revealObserver.unobserve(entry.target);
    }
  }, { threshold: .04 });
  for (const item of reveals) {
    if (item.getBoundingClientRect().top <= window.innerHeight) continue;
    item.classList.add("reveal-pending");
    revealObserver.observe(item);
  }
  motionPreference.addEventListener("change", showAll);
  document.addEventListener("focusin", event => event.target.closest(".reveal")?.classList.remove("reveal-pending"));
  window.addEventListener("beforeprint", showAll);
}

// Restrained pointer depth and a single scroll-progress transform.
const heroVisual = document.querySelector(".hero-visual");
if (heroVisual && window.matchMedia("(pointer: fine)").matches) {
  let pointerFrame = 0;
  heroVisual.addEventListener("pointermove", event => {
    if (motionPreference.matches || pointerFrame) return;
    pointerFrame = requestAnimationFrame(() => {
      const bounds = heroVisual.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - .5;
      const y = (event.clientY - bounds.top) / bounds.height - .5;
      heroVisual.style.setProperty("--pointer-x", `${x * 5}deg`);
      heroVisual.style.setProperty("--pointer-y", `${y * -5}deg`);
      pointerFrame = 0;
    });
  });
  heroVisual.addEventListener("pointerleave", () => {
    heroVisual.style.setProperty("--pointer-x", "0deg");
    heroVisual.style.setProperty("--pointer-y", "0deg");
  });
}
let scrollFrame = 0;
function updateProgress() {
  const available = document.documentElement.scrollHeight - window.innerHeight;
  const progress = available > 0 ? Math.min(1, Math.max(0, window.scrollY / available)) : 0;
  document.querySelector(".reading-progress")?.style.setProperty("--reading-progress", String(progress));
  scrollFrame = 0;
}
window.addEventListener("scroll", () => {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(updateProgress);
}, { passive: true });
window.addEventListener("resize", updateProgress, { passive: true });
updateProgress();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
