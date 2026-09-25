import { SIZE } from "./engine.js";

export const SKILLS = ["double", "mirror", "freeze", "removeWhite"];

function validIndex(index, size) {
  return Number.isInteger(index) && index >= 0 && index < size * size;
}

function validBoard(board, size) {
  return board && board.length === size * size;
}

function failure(error) {
  return { ok: false, error };
}

export function mirrorIndex(index, size = SIZE) {
  if (!validIndex(index, size)) return -1;
  return size * size - 1 - index;
}

export function planPlayerMove(board, skillId = null, selected = [], size = SIZE) {
  if (!validBoard(board, size)) return failure("棋盘数据无效");
  if (!Array.isArray(selected)) return failure("落点数据无效");
  if (skillId === "removeWhite") return failure("该技能需要选择白子");
  if (skillId !== null && !SKILLS.includes(skillId)) return failure("未知技能");

  const required = skillId === "double" ? 2 : 1;
  if (selected.length !== required || selected.some(index => !validIndex(index, size))) {
    return failure("落点数量或位置无效");
  }
  if (selected.some(index => board[index] !== 0)) return failure("该位置已被占用");
  if (new Set(selected).size !== selected.length) return failure("不能重复选择同一位置");

  if (skillId === "mirror") {
    const other = mirrorIndex(selected[0], size);
    if (other === selected[0]) return failure("中心点没有镜像位置");
    if (board[other] !== 0) return failure("镜像位置已被占用");
    return { ok: true, placements: [selected[0], other], skipAI: false, consumedSkill: skillId };
  }

  return {
    ok: true,
    placements: [...selected],
    skipAI: skillId === "freeze",
    consumedSkill: skillId
  };
}

export function planWhiteRemoval(board, index, size = SIZE) {
  if (!validBoard(board, size)) return failure("棋盘数据无效");
  if (!validIndex(index, size)) return failure("落点位置无效");
  if (board[index] !== 2) return failure("只能移除 AI 的白子");
  return { ok: true, index, consumedSkill: "removeWhite" };
}

export function applyPlayerMove(board, skillId = null, selected = [], size = SIZE) {
  const plan = planPlayerMove(board, skillId, selected, size);
  if (!plan.ok) return plan;
  for (const index of plan.placements) board[index] = 1;
  return plan;
}

export function applyWhiteRemoval(board, index, size = SIZE) {
  const plan = planWhiteRemoval(board, index, size);
  if (!plan.ok) return plan;
  board[index] = 0;
  return plan;
}

export function captureTurnSnapshot(board, usedSkills, lastMove) {
  return {
    board: Array.from(board),
    usedSkills: [...usedSkills],
    lastMove
  };
}

export function restoreTurnSnapshot(board, snapshot) {
  if (!snapshot || !Array.isArray(snapshot.board) || snapshot.board.length !== board.length) {
    throw new TypeError("回合快照与棋盘尺寸不匹配");
  }
  board.set(snapshot.board);
  return {
    usedSkills: new Set(snapshot.usedSkills),
    lastMove: snapshot.lastMove
  };
}
