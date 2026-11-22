import { WORDMARK_TRUST } from "./wordmark-trust.js";

export const WORDMARK_URL = new URL("./content/wordmark.wm", import.meta.url);
const STORE = `gomoku-wordmark:${WORDMARK_URL.pathname}:v2`;
const encoder = new TextEncoder();
const version = "WM2";
const signatureAlgorithm = { name: "ECDSA", hash: "SHA-256" };
const ivSize = 12;
const maxSize = 6000;

const encode = bytes => btoa(String.fromCharCode(...bytes));
const decode = text => Uint8Array.from(atob(text), character => character.charCodeAt(0));
const signedBytes = payload => encoder.encode("Gomoku Studio wordmark\n" + payload);

// Public derivation material keeps the contours out of ordinary page markup.
// Trust in the file comes from the separate, pinned signing key.
async function wordmarkKey() {
  const material = await crypto.subtle.importKey("raw", encoder.encode("Gomoku Studio public wordmark"), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({
    name: "HKDF", hash: "SHA-256", salt: encoder.encode(version), info: encoder.encode("gomoku-studio/vector-contours")
  }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function sealWordmark(outline, revision, signingKey) {
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > 999999999) throw new Error("Invalid wordmark revision");
  const header = `${version}.${revision}`;
  const iv = crypto.getRandomValues(new Uint8Array(ivSize));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(header) },
    await wordmarkKey(), encoder.encode(JSON.stringify(outline)));
  const payload = header + "." + encode([...iv, ...new Uint8Array(data)]);
  const signature = await crypto.subtle.sign(signatureAlgorithm, signingKey, signedBytes(payload));
  return payload + "." + encode(new Uint8Array(signature)) + "\n";
}

export async function openWordmark(envelope, trust = WORDMARK_TRUST) {
  if (envelope.length > maxSize) throw new Error("Wordmark envelope is too large");
  const text = envelope.trim();
  const fields = /^WM2\.([1-9][0-9]{0,8})\.([A-Za-z0-9+/]+={0,2})\.([A-Za-z0-9+/]{86}==)$/.exec(text);
  if (!fields) throw new Error("Invalid signed wordmark envelope");
  const [, revisionText, ciphertext, signature] = fields;
  const revision = Number(revisionText);
  if (revision < trust.minimumRevision) throw new Error("Outdated wordmark revision");
  const header = `${version}.${revision}`;
  const publicKey = await crypto.subtle.importKey("spki", decode(trust.publicKey),
    { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify(signatureAlgorithm, publicKey, decode(signature), signedBytes(header + "." + ciphertext));
  if (!valid) throw new Error("Invalid wordmark signature");

  const bytes = decode(ciphertext);
  if (bytes.length < ivSize + 16) throw new Error("Incomplete wordmark envelope");
  const clear = await crypto.subtle.decrypt({
    name: "AES-GCM", iv: bytes.subarray(0, ivSize), additionalData: encoder.encode(header)
  }, await wordmarkKey(), bytes.subarray(ivSize));
  const outline = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(clear));
  if (!Number.isInteger(outline?.width) || !Number.isInteger(outline?.height) || outline.width <= 0 || outline.height <= 0 ||
      outline.width > 4096 || outline.height > 4096 || outline.width / outline.height > 3 || typeof outline.path !== "string" ||
      !/^M[0-9 .eE+\-MLHVQCSZ]+Z$/.test(outline.path)) throw new Error("Invalid wordmark contours");
  return { revision, outline };
}

async function readEnvelope(response) {
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > maxSize) {
    throw new Error("Wordmark unavailable");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > maxSize) throw new Error("Wordmark envelope is too large");
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}

function readBackup(storage) {
  try { return storage?.getItem(STORE) ?? ""; } catch { return ""; }
}

export async function loadWordmark({ request = fetch, storage, trust = WORDMARK_TRUST } = {}) {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 2500);
  let envelope, remote;
  try {
    const response = await request(WORDMARK_URL, { cache: "no-store", redirect: "error", signal: abort.signal });
    envelope = await readEnvelope(response);
    remote = await openWordmark(envelope, trust);
  } catch { /* The last valid signed revision remains usable. */ }
  finally { clearTimeout(timeout); }

  const cached = readBackup(storage);
  if (remote && cached === envelope) return remote.outline;
  const previous = cached ? await openWordmark(cached, trust).catch(() => null) : null;
  if (!remote || previous && previous.revision >= remote.revision) return previous?.outline ?? null;
  try {
    // Avoid replacing a backup saved by another page during verification.
    if (readBackup(storage) === cached) storage?.setItem(STORE, envelope);
  } catch { /* Drawing does not depend on persistent storage. */ }
  return remote.outline;
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
