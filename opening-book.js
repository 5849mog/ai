import { isAutomaticTurn } from "./opening-session.js";
import { transform } from "./renju-rules.js";

function variants(points) {
  const seen = new Set();
  return Array.from({ length: 8 }, (_, symmetry) => points.map(index => transform(index, symmetry)))
    .filter(points => { const key = points.join(":"); if (seen.has(key)) return false; seen.add(key); return true; });
}
function matches(session, points) {
  return session.moves.length <= 3 && session.moves.every((index, turn) => points[turn] === index && session.colors[turn] === [1, 2, 1][turn])
    && session.board.filter(Boolean).length === session.moves.length;
}
const openingTurn = session => session.rule === "rif" && !session.options.seed && ["b1", "w2", "b3"].includes(session.stage) && isAutomaticTurn(session);

// History belongs to the device; a pending plan belongs to its current game.
// Persist the plan with the game so a reload cannot change its remaining stones.
export function createOpeningBook({ pool, storage, storageKey = "gomoku-rif-openings:v1", random = Math.random }) {
  const plans = new WeakMap(), entries = pool.map(entry => ({ ...entry, variants: variants(entry.points) }));
  const keys = new Set(entries.map(entry => entry.key));
  let recent = [];
  try {
    const saved = JSON.parse(storage?.getItem(storageKey) ?? "null");
    if (Array.isArray(saved)) recent = [...new Set(saved.filter(key => keys.has(key)))].slice(0, 8);
  } catch { /* Optional variety history must not block play. */ }
  const draw = () => { const value = random(); return Number.isFinite(value) ? Math.min(1 - Number.EPSILON, Math.max(0, value)) : 0; };
  function plan(session) {
    if (!openingTurn(session)) return null;
    const previous = plans.get(session);
    if (previous && matches(session, previous.points)) return previous;
    let choices = entries.map(entry => ({ ...entry, variants: entry.variants.filter(points => matches(session, points)) })).filter(entry => entry.variants.length);
    if (!choices.length) return null; // Older/manual partial openings use the search advisor.
    if (choices.some(entry => entry.key !== recent[0])) choices = choices.filter(entry => entry.key !== recent[0]);
    const weight = entry => { const age = recent.indexOf(entry.key); return age < 0 ? 1 : Math.min(1, (age + 1) / 5); };
    let remaining = draw() * choices.reduce((sum, entry) => sum + weight(entry), 0);
    const selected = choices.find(entry => (remaining -= weight(entry)) < 0) ?? choices.at(-1);
    const picked = { key: selected.key, points: selected.variants[Math.floor(draw() * selected.variants.length)].slice(), remembered: false };
    plans.set(session, picked); return picked;
  }
  return {
    plan,
    remember(session) {
      const picked = plans.get(session);
      if (!picked || picked.remembered || session.moves.length !== 3 || !matches(session, picked.points)) return;
      picked.remembered = true;
      recent = [picked.key, ...recent.filter(key => key !== picked.key)].slice(0, 8);
      try { storage?.setItem(storageKey, JSON.stringify(recent)); } catch { /* Keep in-memory history when storage is unavailable. */ }
    },
    snapshot(session) {
      const picked = plans.get(session);
      return picked ? { key: picked.key, points: picked.points.slice(), remembered: picked.remembered } : null;
    },
    restore(session, saved) {
      if (!saved || !openingTurn(session) || !Array.isArray(saved.points) || !matches(session, saved.points)) return false;
      const entry = entries.find(entry => entry.key === saved.key);
      if (!entry?.variants.some(points => points.length === saved.points.length && points.every((index, turn) => index === saved.points[turn]))) return false;
      plans.set(session, { key: entry.key, points: saved.points.slice(), remembered: false }); return true;
    }
  };
}
