// Find a regular, axis-aligned 15-line grid in a screenshot. A result is only
// a proposed crop: the user still checks it and confirms every imported board.
// Work on a small image so even phone screenshots have bounded CPU and memory.
export function findBoardGrid({ data, width, height }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || data?.length !== width * height * 4 || Math.min(width, height) < 100) return null;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const p = i * 4;
    gray[i] = data[p + 3] < 200 ? 255 : .2126 * data[p] + .7152 * data[p + 1] + .0722 * data[p + 2];
  }
  const pixel = (x, y) => gray[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))];
  function projections(vertical) {
    const size = vertical ? width : height, other = vertical ? height : width;
    const scores = new Float32Array(size), stride = Math.max(1, Math.floor(other / 500));
    for (let pos = 2; pos < size - 2; pos++) {
      let sum = 0, count = 0;
      for (let cross = 0; cross < other; cross += stride) {
        const center = vertical ? pixel(pos, cross) : pixel(cross, pos);
        const before = vertical ? pixel(pos - 2, cross) : pixel(cross, pos - 2);
        const after = vertical ? pixel(pos + 2, cross) : pixel(cross, pos + 2);
        sum += Math.min(80, Math.max(0, (before + after) / 2 - center)); count++;
      }
      scores[pos] = sum / count;
    }
    return scores;
  }
  function candidates(scores, maxStep) {
    const all = [], size = scores.length;
    // Quarter-pixel steps keep the last line aligned on scaled screenshots.
    for (let step = 6; step <= maxStep; step += .25) {
      const limit = size - 3 - 14 * step;
      for (let start = 2; start <= limit; start++) {
        let sum = 0, good = 0;
        for (let i = 0; i < 15; i++) {
          const p = Math.round(start + i * step);
          const value = Math.max(scores[p - 1], scores[p], scores[p + 1]);
          sum += value; if (value >= 1.2) good++;
        }
        if (good >= 12 && sum >= 22) all.push({ start, step, score: sum });
      }
    }
    all.sort((a, b) => b.score - a.score);
    const picked = [];
    for (const value of all) {
      // Several nearly identical candidates do not deserve the entire shortlist.
      if (picked.some(p => Math.abs(p.start - value.start) < 4 && Math.abs(p.step - value.step) < .4)) continue;
      picked.push(value); if (picked.length === 36) break;
    }
    return picked;
  }
  const maxStep = Math.min(width, height) * 1.35 / 14;
  const xs = candidates(projections(true), Math.min(maxStep, (width - 6) / 14));
  const ys = candidates(projections(false), Math.min(maxStep, (height - 6) / 14));
  if (!xs.length || !ys.length) return null;

  function lineEvidence(vertical, coordinate, from, step, gap) {
    let best = null;
    // The source line may fall between output pixels after image resizing.
    for (let offset = -1; offset <= 1; offset++) {
      const p = Math.round(coordinate) + offset;
      let sum = 0, strong = 0, count = 0;
      for (let cell = 0; cell < 14; cell++) for (const fraction of [.42, .5, .58]) {
        const cross = Math.round(from + (cell + fraction) * step);
        const center = vertical ? pixel(p, cross) : pixel(cross, p);
        const before = vertical ? pixel(p - gap, cross) : pixel(cross, p - gap);
        const after = vertical ? pixel(p + gap, cross) : pixel(cross, p + gap);
        const contrast = Math.max(0, (before + after) / 2 - center);
        sum += Math.min(contrast, 70); if (contrast >= 6) strong++; count++;
      }
      const evidence = { p, mean: sum / count, coverage: strong / count };
      if (!best || evidence.mean > best.mean) best = evidence;
    }
    return best;
  }
  function inspect(x, y) {
    let total = 0, coverage = 0, goodX = 0, goodY = 0;
    const xp = [], yp = [];
    const gapX = Math.max(2, Math.round(x.step * .17)), gapY = Math.max(2, Math.round(y.step * .17));
    for (let i = 0; i < 15; i++) {
      const a = lineEvidence(true, x.start + i * x.step, y.start, y.step, gapX);
      const b = lineEvidence(false, y.start + i * y.step, x.start, x.step, gapY);
      xp.push(a.p); yp.push(b.p);
      total += a.mean + b.mean; coverage += a.coverage + b.coverage;
      if (a.mean >= 5 && a.coverage >= .35) goodX++;
      if (b.mean >= 5 && b.coverage >= .35) goodY++;
    }
    if (goodX < 12 || goodY < 12 || coverage / 30 < .43) return null;
    // Fit all 15 detected lines, reducing the effect of a stone or number on one.
    const fit = points => {
      const mean = points.reduce((a, b) => a + b, 0) / 15;
      const slope = points.reduce((s, p, i) => s + (i - 7) * (p - mean), 0) / 280;
      return [mean - 7 * slope, mean + 7 * slope];
    };
    const [left, right] = fit(xp), [top, bottom] = fit(yp);
    if (left < 0 || top < 0 || right >= width || bottom >= height) return null;
    return { left, top, right, bottom, score: total / 30 * (coverage / 30) };
  }
  let best = null;
  for (const x of xs) for (const y of ys) {
    if (x.step / y.step < .7 || x.step / y.step > 1.4) continue;
    const match = inspect(x, y);
    if (match && (!best || match.score > best.score)) best = match;
  }
  return best && { left: best.left, top: best.top, right: best.right, bottom: best.bottom };
}
