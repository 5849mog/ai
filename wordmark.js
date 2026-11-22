export const WORDMARK_URL = new URL("./content/wordmark.wm", import.meta.url);
const STORE = `gomoku-wordmark:${WORDMARK_URL.pathname}:v1`;
const encoder = new TextEncoder();
const version = "WM1";
const ivSize = 12;

// Public derivation material. The envelope is for the visual experiment, not
// access control. Anyone running the page has everything needed to open it.
async function wordmarkKey() {
  const material = await crypto.subtle.importKey("raw", encoder.encode("Gomoku Studio public wordmark"), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({
    name: "HKDF", hash: "SHA-256", salt: encoder.encode(version), info: encoder.encode("gomoku-studio/vector-contours")
  }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function sealWordmark(glyphs) {
  const iv = crypto.getRandomValues(new Uint8Array(ivSize));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(version) },
    await wordmarkKey(), encoder.encode(JSON.stringify(glyphs)));
  return version + "." + btoa(String.fromCharCode(...iv, ...new Uint8Array(data))) + "\n";
}

export async function openWordmark(envelope) {
  const text = envelope.trim();
  if (text.length > 6000 || !/^WM1\.[A-Za-z0-9+/]+={0,2}$/.test(text)) throw new Error("Invalid wordmark envelope");
  const bytes = Uint8Array.from(atob(text.slice(version.length + 1)), character => character.charCodeAt(0));
  if (bytes.length < ivSize + 16) throw new Error("Incomplete wordmark envelope");
  const clear = await crypto.subtle.decrypt({
    name: "AES-GCM", iv: bytes.subarray(0, ivSize), additionalData: encoder.encode(version)
  }, await wordmarkKey(), bytes.subarray(ivSize));
  const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(clear));
  if (!Number.isInteger(data?.width) || !Number.isInteger(data?.height) || data.width <= 0 || data.height <= 0 ||
      data.width > 4096 || data.height > 4096 || typeof data.path !== "string" ||
      !/^M[0-9 .eE+\-MLHVQCSZ]+Z$/.test(data.path)) throw new Error("Invalid wordmark contours");
  return data;
}

export async function loadWordmark({ request = fetch, storage } = {}) {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 2500);
  try {
    const response = await request(WORDMARK_URL, { cache: "no-store", signal: abort.signal });
    if (!response.ok) throw new Error("Wordmark unavailable");
    const envelope = await response.text();
    const outline = await openWordmark(envelope);
    try { storage?.setItem(STORE, envelope); } catch { /* Drawing does not depend on persistent storage. */ }
    return outline;
  } catch {
    try { return await openWordmark(storage?.getItem(STORE) ?? ""); }
    catch { return null; }
  } finally { clearTimeout(timeout); }
}

async function renderWordmarks(slots) {
  if (!slots.length || !globalThis.crypto?.subtle || typeof Path2D !== "function") return;
  let storage;
  try { storage = localStorage; } catch { /* Private browsing can restrict storage. */ }
  const outline = await loadWordmark({ storage });
  if (!outline) return;
  const path = new Path2D(outline.path);
  const marks = slots.map(slot => {
    const canvas = document.createElement("canvas");
    return { slot, canvas, ctx: canvas.getContext("2d") };
  }).filter(mark => mark.ctx);

  function draw() {
    for (const { slot, canvas, ctx } of marks) {
      const style = getComputedStyle(slot);
      const height = Math.max(1, Math.round(parseFloat(style.fontSize) * devicePixelRatio));
      const scale = height / outline.height;
      canvas.width = Math.round(outline.width * scale);
      canvas.height = height;
      ctx.scale(scale, scale);
      ctx.fillStyle = style.color;
      ctx.fill(path);
      if (!canvas.parentNode) slot.replaceChildren(canvas);
    }
  }

  draw();
  addEventListener("resize", draw);
  matchMedia("(forced-colors: active)").addEventListener("change", draw);
}

if (typeof document !== "undefined") {
  void renderWordmarks(Array.from(document.querySelectorAll("[data-wordmark]"))).catch(() => {
    // A capability or rendering failure leaves the accessible wordmark fallback.
  });
}
