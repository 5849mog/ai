// The observed slot is sized by the page, never by the board inside it.
// Absolutely positioning the frame breaks the intrinsic-size feedback path.
export function fitBoardToSlot(boardSvg, { Observer = globalThis.ResizeObserver } = {}) {
  const frame = boardSvg.parentElement, slot = frame?.parentElement;
  if (!frame?.matches?.(".board-frame") || !slot?.matches?.(".board-wrap, .setup-board-wrap") || !Observer) return null;
  const dock = slot.querySelector("[data-board-dock]");
  let slotSize;
  const set = (element, property, value) => { if (element.style[property] !== value) element.style[property] = value; };
  function fitDock() {
    if (!slotSize) return;
    const { width, height } = slotSize;
    if (dock.hidden) {
      set(frame, "top", ""); set(frame, "left", "");
      set(frame, "width", `${Math.floor(Math.min(width, height))}px`); return;
    }
    const gap = 6, beside = width >= 260 && width > height * 1.15;
    const dockWidth = beside ? Math.min(224, Math.max(136, width * .36), width - 90 - gap) : Math.min(480, width);
    dock.dataset.placement = beside ? "side" : "top";
    set(dock, "width", `${Math.floor(dockWidth)}px`);
    set(dock, "maxHeight", `${Math.max(32, Math.floor(beside ? height : height - 84 - gap))}px`);
    const dockHeight = dock.getBoundingClientRect().height;
    const side = Math.max(1, Math.floor(Math.min(beside ? width - dockWidth - gap : width, beside ? height : height - dockHeight - gap)));
    const left = beside ? (width - side - gap - dockWidth) / 2 : (width - side) / 2;
    const top = beside ? (height - side) / 2 : (height - side - gap - dockHeight) / 2 + dockHeight + gap;
    set(frame, "width", `${side}px`); set(frame, "left", `${left + side / 2}px`); set(frame, "top", `${top + side / 2}px`);
    set(dock, "left", `${beside ? left + side + gap : (width - dockWidth) / 2}px`);
    set(dock, "top", `${beside ? Math.max(0, (height - dockHeight) / 2) : top - gap - dockHeight}px`);
  }
  let previousAvailable = null, previousSide = null;
  const observer = new Observer(entries => {
    const entry = entries.find(item => item.target === slot);
    if (dock) {
      if (entry && Number.isFinite(entry.contentRect.width) && Number.isFinite(entry.contentRect.height) && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        const { width, height } = entry.contentRect;
        slotSize = { width: slotSize && Math.abs(width - slotSize.width) < .5 ? slotSize.width : width,
          height: slotSize && Math.abs(height - slotSize.height) < .5 ? slotSize.height : height };
      }
      fitDock(); return;
    }
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
  if (dock) {
    observer.observe(dock);
    // Visibility changes need fitting even when the slot's size stays the same.
    const Mutations = slot.ownerDocument.defaultView?.MutationObserver;
    if (Mutations) new Mutations(fitDock).observe(dock, { attributes: true, attributeFilter: ["hidden"] });
  }
  return observer;
}
