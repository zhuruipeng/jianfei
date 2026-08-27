import type { WorldTransitionKind } from '../types/index';

export const WORLD_FEEDBACK_MESSAGES: Partial<Record<WorldTransitionKind, string>> = {
  plant: '🌱 它长出新叶子啦',
  path: '路又往前了一点。',
  water: '听，水回来了 💧',
  all: '今天的花园完整啦。\n我们一起让这里又变好了一点。',
  'plant-level': '花园里长出了新的植物。',
  'path-level': '小路通向了更远的地方。',
  'water-level': '水池变得更清澈了。',
};
