import { coordinate, boardPoint } from "./board-view.js";

// A separate preview renders only the nearby intersections and never
// participates in the live board's hit-testing or coordinate system.
export function createBoardLoupe(svg) {
  const doc = svg.ownerDocument, ns = "http://www.w3.org/2000/svg";
  const box = doc.createElement("div"), picture = doc.createElementNS(ns, "svg"), caption = doc.createElement("span");
  box.className = "board-aim-loupe";
  box.hidden = true;
  box.setAttribute("aria-hidden", "true");
  picture.setAttribute("viewBox", "0 0 100 100");
  box.append(picture, caption);
  svg.after(box);
  const part = (name, fields) => {
    const node = doc.createElementNS(ns, name);
    for (const [key, value] of Object.entries(fields)) node.setAttribute(key, value);
    return node;
  };
  let signature = "";
  function draw(index, { board, color, available, reversed }) {
    if (index < 0) { box.hidden = true; return; }
    const next = `${index}:${board.join("")}:${color}:${available}:${reversed}`;
    box.hidden = false;
    if (signature === next) return;
    signature = next;
    const center = boardPoint(index, reversed);
    box.dataset.vertical = center.y < 310 ? "bottom" : "top";
    box.dataset.horizontal = center.x > 310 ? "left" : "right";
    box.dataset.available = String(available);
    caption.textContent = `${coordinate(index)} · ${available ? "松手预选" : "不可选"}`;
    const origin = reversed ? 224 - index : index;
    const row = Math.floor(origin / 15), column = origin % 15;
    const inset = step => 50 + step * 19;
    const grid = [], stones = [];
    const left = Math.max(-2, -column), top = Math.max(-2, -row);
    const right = Math.min(2, 14 - column), bottom = Math.min(2, 14 - row);
    for (let dx = left; dx <= right; dx++) {
      grid.push(part("line", { x1: inset(dx), x2: inset(dx), y1: inset(top), y2: inset(bottom) }));
      for (let dy = top; dy <= bottom; dy++) {
        const point = (row + dy) * 15 + column + dx;
        const stone = board[reversed ? 224 - point : point] || (dx === 0 && dy === 0 && available ? color : 0);
        if (stone) stones.push(part("circle", { cx: inset(dx), cy: inset(dy), r: 7, class: stone === 1 ? "black" : "white" }));
      }
    }
    for (let dy = top; dy <= bottom; dy++) grid.push(part("line", { x1: inset(left), x2: inset(right), y1: inset(dy), y2: inset(dy) }));
    picture.replaceChildren(...grid, ...stones,
      part("circle", { cx: 50, cy: 50, r: 9, class: "target" }));
  }
  return { draw, hide() { box.hidden = true; } };
}
