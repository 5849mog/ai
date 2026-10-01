// Twenty fixed three-ply freestyle openings. Each is tested with colors swapped.
const thirds = [[7,5],[8,5],[9,5],[9,6],[9,7],[9,8],[8,8],[7,8],[6,8],[5,8],
  [5,7],[5,6],[5,5],[6,5],[8,6],[8,7],[6,6],[6,7],[7,9],[8,9]];
export const OPENINGS = thirds.map((third, i) => ({
  id: `opening-${String(i + 1).padStart(2, "0")}`,
  moves: [[7,7], [7,6], third]
}));
