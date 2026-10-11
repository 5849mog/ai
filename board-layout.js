// The observed slot is sized by the page, never by the board inside it.
// Absolutely positioning the frame breaks the intrinsic-size feedback path.
export function fitBoardToSlot(boardSvg, { Observer = globalThis.ResizeObserver } = {}) {
  const frame = boardSvg.parentElement, slot = frame?.parentElement;
  if (!frame?.matches?.(".board-frame") || !slot?.matches?.(".board-wrap, .setup-board-wrap") || !Observer) return null;
  let previousAvailable = null, previousSide = null;
  const observer = new Observer(entries => {
    const entry = entries.find(item => item.target === slot);
    if (!entry) return;
    const { width, height } = entry.contentRect;
    const available = Math.min(width, height);
    // Hidden dialogs/workspaces must not overwrite a usable board size.
    if (!Number.isFinite(available) || available <= 0) return;
    if (previousAvailable !== null && Math.abs(available - previousAvailable) < .5) return;
    previousAvailable = available;
    const side = Math.floor(available);
    if (side === previousSide) return;
    previousSide = side;
    frame.style.width = `${side}px`;
  });
  observer.observe(slot);
  return observer;
}
