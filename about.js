const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");

const languageLink = document.querySelector("[data-about-language]");
if (languageLink) {
  const alternate = new URL(languageLink.href);
  function preserveSection() {
    alternate.hash = location.hash;
    languageLink.href = alternate.href;
  }
  preserveSection();
  window.addEventListener("hashchange", preserveSection);
}

// Exploded engine exhibit: one shared state controls all four layers and copy.
const exhibit = document.querySelector("[data-engine-exhibit]");
const steps = Array.from(document.querySelectorAll("[data-step]"));
const initialTitle = document.querySelector("#detailTitle");
const initialText = document.querySelector("#detailText");
const initialPosition = { title: initialTitle.textContent, text: initialText.textContent };
function selectStep(button) {
  if (!exhibit) return;
  const description = button.dataset.step === "board" ? initialPosition : button.dataset;
  exhibit.dataset.active = button.dataset.step;
  for (const step of steps) step.setAttribute("aria-pressed", String(step === button));
  document.querySelector("#detailIndex").textContent = button.dataset.index;
  initialTitle.textContent = description.title;
  initialText.textContent = description.text;
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
const initialSource = location.hash.startsWith("#source-") ? location.hash.slice(8) : "";
if (sourceLabels[initialSource]) activeSource = initialSource;
selectSource(activeSource);
if ("IntersectionObserver" in window && sourceEntries.length) {
  const sourceObserver = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible) selectSource(visible.target.dataset.sourceEntry);
  }, { rootMargin: "-24% 0px -36%", threshold: [0, .2, .5] });
  for (const entry of sourceEntries) sourceObserver.observe(entry);
}

// A restrained proximity field makes the map feel alive without moving its layout.
const constellationCanvas = document.querySelector(".constellation-canvas");
if (constellationCanvas && window.matchMedia("(pointer: fine)").matches) {
  let proximityFrame = 0;
  function resetProximity() {
    for (const node of sourceNodes) node.style.removeProperty("--node-scale");
  }
  constellationCanvas.addEventListener("pointermove", event => {
    if (motionPreference.matches || proximityFrame) return;
    proximityFrame = requestAnimationFrame(() => {
      for (const node of sourceNodes) {
        const bounds = node.getBoundingClientRect();
        const distance = Math.hypot(event.clientX - bounds.left - bounds.width / 2, event.clientY - bounds.top - bounds.height / 2);
        const proximity = Math.max(0, 1 - distance / 150);
        node.style.setProperty("--node-scale", String(1 + proximity * .08));
      }
      proximityFrame = 0;
    });
  });
  constellationCanvas.addEventListener("pointerleave", resetProximity);
  motionPreference.addEventListener("change", resetProximity);
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

// Chapter navigation follows the same reading position as the exhibition.
const chapterLinks = Array.from(document.querySelectorAll("[data-chapter-link]"));
if ("IntersectionObserver" in window && chapterLinks.length) {
  const chapterObserver = new IntersectionObserver(entries => {
    const current = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!current) return;
    for (const link of chapterLinks) {
      if (link.dataset.chapterLink === current.target.id) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
  }, { rootMargin: "-18% 0px -62%", threshold: [0, .05, .2] });
  for (const link of chapterLinks) {
    const chapter = document.getElementById(link.dataset.chapterLink);
    if (chapter) chapterObserver.observe(chapter);
  }
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
const heroSection = document.querySelector(".about-hero");
const cinematicScroll = window.matchMedia("(min-width: 761px)");
function updateProgress() {
  const available = document.documentElement.scrollHeight - window.innerHeight;
  const progress = available > 0 ? Math.min(1, Math.max(0, window.scrollY / available)) : 0;
  document.querySelector(".reading-progress")?.style.setProperty("--reading-progress", String(progress));
  const heroRange = heroSection ? heroSection.offsetHeight * .8 : 1;
  const heroProgress = cinematicScroll.matches && !motionPreference.matches ? Math.min(1, Math.max(0, window.scrollY / heroRange)) : 0;
  heroVisual?.style.setProperty("--hero-scroll", String(heroProgress));
  scrollFrame = 0;
}
window.addEventListener("scroll", () => {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(updateProgress);
}, { passive: true });
window.addEventListener("resize", updateProgress, { passive: true });
cinematicScroll.addEventListener("change", updateProgress);
motionPreference.addEventListener("change", updateProgress);
updateProgress();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
