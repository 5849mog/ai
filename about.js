const exhibit = document.querySelector("[data-engine-exhibit]");
const steps = Array.from(document.querySelectorAll("[data-step]"));
const descriptions = {
  board: { index: "01 / POSITION", title: "从完整的棋盘开始。", text: "你的落子确认后，当前棋盘与轮到谁行棋一起交给引擎。每次推演，都以真实局面为起点。" },
  evaluate: { index: "02 / EVALUATION", title: "读懂棋形，衡量局面。", text: "mix9svq 神经网络评估棋盘上的棋形，为搜索提供局势判断。评估分数是比较变化的依据，并不等于实测胜率。" },
  search: { index: "03 / SEARCH", title: "沿着变化，再想几手。", text: "Rapfi 推演双方可能的后续着手，在思考预算内比较变化。开启后台思考后，你考虑落子时，引擎也会分段分析当前局面。" },
  move: { index: "04 / MOVE", title: "千般推演，落于一手。", text: "搜索结束后，引擎返回选定着手。主棋盘检查任务仍然有效、落点仍然合法，再显示棋子；悔棋或重开后的旧搜索结果会被丢弃。" }
};

function selectStep(button) {
  const key = button.dataset.step;
  const description = descriptions[key];
  if (!description || !exhibit) return;
  exhibit.dataset.active = key;
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

// Content is visible by default. Only elements still below the viewport are
// prepared for a short entrance; reduced-motion users keep the static page.
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const reveals = Array.from(document.querySelectorAll(".reveal"));
let observer;
function showAll() {
  observer?.disconnect();
  for (const item of reveals) item.classList.remove("reveal-pending");
}
if (!motionPreference.matches && "IntersectionObserver" in window) {
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.remove("reveal-pending");
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.05 });
  for (const item of reveals) {
    if (item.getBoundingClientRect().top <= window.innerHeight) continue;
    item.classList.add("reveal-pending");
    observer.observe(item);
  }
  motionPreference.addEventListener("change", showAll);
  document.addEventListener("focusin", event => event.target.closest(".reveal")?.classList.remove("reveal-pending"));
  window.addEventListener("beforeprint", showAll);
}

// A visitor can also arrive on this page before opening the main board.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
}
