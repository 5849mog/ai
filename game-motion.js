export function gamePhase({ busy = false, paused = false, winner = 0, state = "ready" }) {
  if (winner) return "finished";
  if (paused) return "paused";
  if (busy) return "thinking";
  if (state === "error") return "error";
  if (state !== "ready") return "loading";
  return "ready";
}

// One state-driven controller for the DOM around the board. The board itself
// owns stone transitions; this module never starts a perpetual JS render loop.
export function createGameMotion({ root, board, status, frame, notice }) {
  let previousText = "", previousWinner = 0, previousPhase = "";
  let statusAnimation, noticeAnimation;
  const reduced = () => root.ownerDocument?.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  return {
    render(snapshot) {
      const phase = gamePhase(snapshot), text = snapshot.text || "";
      root.dataset.gamePhase = phase;
      root.dataset.gameTurn = String(snapshot.currentColor || 0);
      board.dataset.phase = phase;
      board.dataset.winner = String(snapshot.winner || 0);
      frame.dataset.motionPhase = phase;
      const meaningfulTextChange = previousText && text !== previousText &&
        (phase !== previousPhase || phase === "ready" && previousPhase === "ready");
      if (meaningfulTextChange && !reduced()) {
        statusAnimation?.cancel();
        statusAnimation = status.animate?.([
          { opacity: .25, transform: "translateY(4px)" },
          { opacity: 1, transform: "translateY(-1px)", offset: .68 },
          { opacity: 1, transform: "translateY(0)" }
        ], { duration: 260, easing: "cubic-bezier(.2,.75,.25,1)" });
      }
      if (snapshot.winner && !previousWinner && !reduced()) {
        frame.animate?.([{ opacity: .82 }, { opacity: 1 }], { duration: 720, easing: "ease-out" });
      }
      previousText = text; previousWinner = snapshot.winner || 0; previousPhase = phase;
      return phase;
    },
    announce() {
      if (reduced()) return;
      noticeAnimation?.cancel();
      noticeAnimation = notice.animate?.([{ opacity: 0 }, { opacity: 1, offset: .35 }, { opacity: 1 }],
        { duration: 260, easing: "ease-out" });
    }
  };
}
