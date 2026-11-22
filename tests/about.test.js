import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const pages = [
  { path: "about.html", language: "en", searchTitle: "Compare continuations" },
  { path: "about.zh-CN.html", language: "zh-CN", searchTitle: "沿着变化，再想几手。" }
];
const script = await readFile(new URL("../about.js", import.meta.url), "utf8");

test("both About languages preserve section links and explain engine steps in their own language", async () => {
  const sectionIds = ["engine", "recommendation", "sources", "license", "source-rapfi"];
  for (const [index, page] of pages.entries()) {
    const other = pages[1 - index];
    const html = await readFile(new URL("../" + page.path, import.meta.url), "utf8");
    const url = "https://example.test/ai/" + page.path;
    const { window } = new JSDOM(html, { url: url + "#source-rapfi", runScripts: "outside-only" });
    try {
      const doc = window.document;
      assert.equal(doc.documentElement.lang, page.language);
      for (const id of sectionIds) assert.ok(doc.getElementById(id), id);
      const alternate = doc.querySelector("[data-about-language]");
      assert.equal(alternate.getAttribute("hreflang"), other.language);
      assert.equal(alternate.getAttribute("href"), "./" + other.path);

      window.matchMedia = () => ({ matches: true, addEventListener() {} });
      window.eval(script);
      assert.equal(new URL(alternate.href).hash, "#source-rapfi");
      await new Promise(resolve => {
        window.addEventListener("hashchange", resolve, { once: true });
        window.location.hash = "#license";
      });
      assert.equal(new URL(alternate.href).hash, "#license");

      const initialTitle = doc.querySelector("#detailTitle").textContent;
      doc.querySelector('[data-step="search"]').click();
      assert.equal(doc.querySelector("#detailTitle").textContent, page.searchTitle);
      doc.querySelector('[data-step="board"]').click();
      assert.equal(doc.querySelector("#detailTitle").textContent, initialTitle);
    } finally {
      window.close();
    }
  }
});
