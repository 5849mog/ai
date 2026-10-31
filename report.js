import {
  validateStrengthReport, positionBudgetRows, gameOutcome, boardCoordinate,
  formatNumber, formatPercent, formatTimestamp
} from "./report-model.js?v=1";

const REPORT_URL = "./reports/strength-baseline-v1-summary.json";
const REFRESH_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const $ = id => document.getElementById(id);
let activeRequest;
let currentReport;
let refreshTimer;

function text(id, value) {
  const node = $(id);
  if (node) node.textContent = value;
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function metric(term, value) {
  const wrapper = document.createElement("div");
  wrapper.append(element("dt", "", term), element("dd", "", value));
  return wrapper;
}

function setCloudStatus(state, message) {
  $("cloudStatus").dataset.state = state;
  text("cloudStatusText", message);
}

function renderReport(report) {
  const runs = report.positionRuns;
  const solved = runs.filter(run => run.correct).length;
  const fixtures = new Set(runs.map(run => run.fixtureId)).size;
  const positions = positionBudgetRows(report);
  const matches = report.summary.matches;
  const completionRate = runs.length ? solved / runs.length : 0;

  text("reportNumber", String(report.version).padStart(3, "0"));
  text("heroSolved", `${solved} / ${runs.length}`);
  text("heroRuns", `${fixtures} 个局面 · ${runs.length} 次搜索`);
  text("heroComplete", report.complete ? "COMPLETE / 完整基线" : "PARTIAL / 部分结果");
  text("heroFinished", `完成于 ${formatTimestamp(report.finishedAt)}`);
  $("dialProgress").style.setProperty("--report-progress", String(completionRate * 100));
  text("ledgerCases", `${solved} / ${runs.length}`);
  text("ledgerFixtures", `${fixtures} 个固定局面 · 全部预算`);
  text("ledgerScore", formatPercent(matches.scoreRate, 2));
  text("ledgerGames", `${matches.games} 盘`);
  text("ledgerVersion", report.appVersion || "未记录");
  text("ledgerCommit", `源码提交 ${report.sourceCommit ? report.sourceCommit.slice(0, 8) : "—"}`);

  const budgetGrid = $("budgetGrid");
  budgetGrid.replaceChildren(...positions.map(row => {
    const card = element("article", "budget-card");
    const header = document.createElement("header");
    header.append(element("span", "", `${formatNumber(row.budgetMs, 0)} ms / 每题`), element("strong", "", formatPercent(row.successRate)));
    const track = element("div", "success-track");
    const fill = document.createElement("i");
    fill.style.setProperty("--success", formatPercent(row.successRate));
    track.append(fill);
    const metrics = document.createElement("dl");
    metrics.append(
      metric("解题", `${row.solved} / ${row.cases}`),
      metric("杀棋", `${row.mateSolved} / ${row.mateCases}`),
      metric("平均墙钟", `${formatNumber(row.search.meanWallMs)} ms`),
      metric("P90 墙钟", `${formatNumber(row.search.p90WallMs)} ms`),
      metric("平均节点", formatNumber(row.search.meanNodes, 0)),
      metric("平均深度", formatNumber(row.search.meanDepth))
    );
    card.append(header, track, metrics, element("footer", "", `引擎耗时均值 ${formatNumber(row.search.meanEngineMs)} ms · 实际搜索可能提前结束`));
    return card;
  }));

  const positionRows = [...runs].sort((a, b) => a.fixtureId.localeCompare(b.fixtureId) || a.budgetMs - b.budgetMs);
  $("positionRows").replaceChildren(...positionRows.map(run => {
    const row = document.createElement("tr");
    row.append(
      element("td", "", run.fixtureId),
      element("td", "", `${formatNumber(run.budgetMs, 0)} ms`),
      element("td", "", boardCoordinate(run.index))
    );
    const result = element("td");
    result.append(element("span", `result-tag ${run.correct ? "is-win" : "is-loss"}`, run.correct ? "答案正确" : "答案错误"));
    row.append(result);
    return row;
  }));

  text("matchScore", formatPercent(matches.scoreRate, 2));
  text("matchRecord", `${matches.wins} 胜 · ${matches.draws} 和 · ${matches.losses} 负 / 共 ${matches.games} 盘`);
  text("matchWins", matches.wins);
  text("matchDraws", matches.draws);
  text("matchLosses", matches.losses);
  const ribbon = $("resultRibbon");
  ribbon.setAttribute("aria-label", `长预算方 ${matches.wins} 胜、${matches.draws} 和、${matches.losses} 负`);
  ribbon.replaceChildren(...[["win", matches.wins], ["draw", matches.draws], ["loss", matches.losses]].map(([key, count]) => {
    const segment = document.createElement("i");
    segment.dataset.result = key;
    segment.style.setProperty("--share", formatPercent(matches.games ? count / matches.games : 0, 4));
    return segment;
  }));
  const budgets = report.matchBudgets || {};
  text("matchBudgetLabel", `短预算 ${formatNumber(budgets.shortMs, 0)} ms · 长预算 ${formatNumber(budgets.longMs, 0)} ms · 每盘交换执色`);

  $("matchSearch").replaceChildren(...[["short", "SHORT BUDGET / 短预算"], ["long", "LONG BUDGET / 长预算"]].map(([key, label]) => {
    const search = report.summary.search[key];
    const column = element("article", "search-column");
    column.append(element("span", "", label));
    const metrics = document.createElement("dl");
    metrics.append(
      metric("搜索手数", formatNumber(search.searches, 0)),
      metric("平均墙钟", `${formatNumber(search.meanWallMs)} ms`),
      metric("平均节点", formatNumber(search.meanNodes, 0)),
      metric("平均深度", formatNumber(search.meanDepth))
    );
    column.append(metrics);
    return column;
  }));

  $("gameRows").replaceChildren(...report.games.map(game => {
    const outcome = gameOutcome(game);
    const row = document.createElement("tr");
    row.append(
      element("td", "", game.openingId),
      element("td", "", game.longColor === 1 ? "黑方" : "白方"),
      element("td", "", outcome.detail),
      element("td", "", formatNumber(game.plies, 0))
    );
    const result = document.createElement("td");
    result.append(element("span", `result-tag is-${outcome.key}`, outcome.label));
    row.append(result);
    return row;
  }));

  const engine = report.engine || {};
  text("methodEngine", `${engine.name || "Rapfi"} · ${engine.network || "mix9svq"} · ${engine.variant || "变体未记录"}`);
  text("methodRuntime", `${engine.threads ?? "—"} 线程 · ${engine.memoryMiB ?? "—"} MiB · ${report.runtime || "运行环境未记录"}`);
  text("methodRule", report.rule || "无禁手 · 15 × 15 · 五子及以上获胜");
  text("methodTime", `${formatTimestamp(report.startedAt)} — ${formatTimestamp(report.finishedAt)}`);
  text("methodCommit", report.sourceCommit || "未记录");
  if (/^[0-9a-f]{40}$/i.test(report.sourceCommit || "")) {
    $("methodCommit").href = `https://github.com/5849mog/ai/commit/${report.sourceCommit}`;
  }

  currentReport = report;
  $("reportContent").hidden = false;
  $("reportLoading").hidden = true;
  $("reportError").hidden = true;
}

function setLoading(loading) {
  $("refreshReport").disabled = loading;
  $("refreshReport").classList.toggle("is-loading", loading);
  if (loading && !currentReport) $("reportLoading").hidden = false;
}

async function loadReport() {
  activeRequest?.abort();
  const controller = new AbortController();
  activeRequest = controller;
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  setLoading(true);
  setCloudStatus("loading", currentReport ? "正在重新获取云端报告…" : "正在连接云端报告…");
  try {
    const separator = REPORT_URL.includes("?") ? "&" : "?";
    const response = await fetch(`${REPORT_URL}${separator}_=${Date.now()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`云端返回 HTTP ${response.status}`);
    const payload = await response.json();
    renderReport(validateStrengthReport(payload));
    setCloudStatus("success", `云端数据已获取 · ${formatTimestamp(new Date())}`);
  } catch (error) {
    if (controller !== activeRequest) return;
    const message = error?.name === "AbortError" ? "请求超时或被取消，请重新获取。" : (error?.message || "未知错误");
    text("reportErrorText", `${message}。${currentReport ? "当前保留上一次成功获取的数据。" : "请检查网络后重试。"}`);
    $("reportError").hidden = false;
    $("reportLoading").hidden = true;
    setCloudStatus("error", currentReport ? "云端刷新失败 · 显示上一次数据" : "云端报告暂时不可用");
  } finally {
    clearTimeout(timeout);
    if (controller === activeRequest) {
      activeRequest = undefined;
      setLoading(false);
    }
  }
}

function startAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (!document.hidden) loadReport();
  }, REFRESH_INTERVAL_MS);
}

$("refreshReport").addEventListener("click", loadReport);
$("retryReport").addEventListener("click", loadReport);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadReport();
});
window.addEventListener("online", loadReport);
startAutoRefresh();
loadReport();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
