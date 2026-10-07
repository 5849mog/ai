const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const luma = rgb => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
const chroma = rgb => Math.max(...rgb) - Math.min(...rgb);

export function boardRectangle(a, b, width, height) {
  if (![a?.x, a?.y, b?.x, b?.y, width, height].every(Number.isFinite)) throw new Error("请框选棋盘最外层网格线围成的范围");
  const left = Math.min(a.x, b.x), top = Math.min(a.y, b.y), right = Math.max(a.x, b.x), bottom = Math.max(a.y, b.y);
  if (left < 0 || top < 0 || right >= width || bottom >= height || right - left < 84 || bottom - top < 84) throw new Error("棋盘范围无效或分辨率太低，请重新标定");
  const ratio = (right - left) / (bottom - top);
  if (ratio < .7 || ratio > 1.4) throw new Error("请选择正视的 15 × 15 棋盘，两个角点应接近正方形");
  return { left, top, right, bottom };
}

// All recognition is local. Sample a broad stone interior, avoiding the grid
// cross/star at the centre, and compare it with the surrounding board surface.
export function recognizeBoard({ data, width, height }, rectangle) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || data?.length !== width * height * 4) throw new Error("图像像素数据无效");
  const rect = boardRectangle({ x: rectangle.left, y: rectangle.top }, { x: rectangle.right, y: rectangle.bottom }, width, height);
  const sx = (rect.right - rect.left) / 14, sy = (rect.bottom - rect.top) / 14;
  const board = new Uint8Array(225), uncertain = [], confidence = [];
  const pixel = (x, y) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const i = (y * width + x) * 4;
    return data[i + 3] < 200 ? null : Array.from(data.slice(i, i + 3));
  };
  for (let i = 0; i < 225; i++) {
    const cx = rect.left + i % 15 * sx, cy = rect.top + Math.floor(i / 15) * sy;
    const core = [], outside = [], rim = [];
    for (let n = 0; n < 32; n++) {
      const angle = (n + .5) * Math.PI * 2 / 32, x = Math.cos(angle), y = Math.sin(angle);
      if (Math.abs(x) < .2 || Math.abs(y) < .2) continue;
      for (const radius of [.17, .24, .3]) { const p = pixel(cx + x * sx * radius, cy + y * sy * radius); if (p) core.push(p); }
      for (const [target, radius] of [[outside, .54], [rim, .4]]) { const p = pixel(cx + x * sx * radius, cy + y * sy * radius); if (p) target.push(p); }
    }
    if (core.length < 20 || outside.length < 6) { uncertain.push(i); confidence.push(0); continue; }
    const bg = [0, 1, 2].map(k => median(outside.map(p => p[k]))), surface = luma(bg);
    const dark = core.filter(p => luma(p) < 115 && surface - luma(p) > 32).length / core.length;
    const light = core.filter(p => luma(p) > 150 && (luma(p) - surface > 22 || chroma(bg) - chroma(p) > 30)).length / core.length;
    const edge = rim.length ? rim.filter(p => surface - luma(p) > 28).length / rim.length : 0;
    const neutralWhite = core.filter(p => luma(p) > 205 && chroma(p) < 25).length / core.length;
    const white = Math.max(light, edge > .45 && surface > 185 ? neutralWhite : 0);
    const score = Math.max(dark, white);
    if (dark >= .68 || white >= .68) board[i] = dark > white ? 1 : 2;
    // Ambiguous overlays/skins stay editable, never silently claimed accurate.
    if (score > .2 && score < .82 || surface < 115 || board[i] === 0 && edge > .45) uncertain.push(i);
    confidence.push(score);
  }
  return { board, uncertain, confidence };
}
