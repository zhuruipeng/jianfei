/**
 * utils/companionMessages.ts
 *
 * 小轻情境文案池（不要写死在页面里，集中管理）。
 *
 * 所有"选一条文案"场景：
 *   - 同一天 + 同一个 context → 始终返回同一句（不每次打开跳来跳去）
 *   - 用日期 + context 的稳定哈希取 pool 下标，不用 Math.random()。
 */

import { CompanionMood } from '../types/index';

// ---------------------------------------------------------------
// 文案池（全部温和、正向、不用"失败/偷懒/惩罚"等负面词汇）
// ---------------------------------------------------------------

/** 当天 0/3 任务完成（小轻刚醒来，第一次打开问候）—— encouraging 情绪 */
export const OPENING_0_3_MESSAGES: string[] = [
  '你回来啦。\n今天先完成一件小事就好。',
  '新的这一天开始啦。\n不用做很多，我们慢慢来。',
  '我已经准备好了。\n今天一起走一小步吧。',
  '今天不用做很多。\n完成第一件小事就行。',
];

/** 完成第 1 个任务瞬时反馈（角色短暂 happy） */
export const FIRST_TASK_FEEDBACK: string[] = [
  '收到能量啦 ✨\n今天已经开始了。',
  '第一件小事完成。\n我们出发啦。',
  '今天的第一步已完成 ✨\n继续慢慢来就好。',
];

/** 完成第 2 个任务瞬时反馈（neutral -> neutral，仍温和鼓励） */
export const SECOND_TASK_FEEDBACK: string[] = [
  '已经完成两件啦。\n今天离全部完成只差一步。',
  '你今天做得真不错。\n再来一件小事吧。',
  '两件了，小轻也很开心。\n再走一步就全部完成。',
];

/** 3/3 全部完成（仪式感 + happy 持续久一点） */
export const ALL_THREE_DONE_MESSAGE: string =
  '今天的三件小事都完成啦 ✨\n我们又一起往前走了一点。';

/** 欢迎回归（昨天没完成任务，今天回来时显示 encouraging，不用"你昨天没完成"） */
export const WELCOME_BACK_MESSAGES: string[] = [
  '昨天已经过去啦。\n今天我们重新走一小步。',
  '今天是全新的一天。\n先一起做一件小事吧。',
  '没关系，今天的路才开始。\n慢慢来，我陪着你。',
];

/** 点击角色互动（cooldown 2s，不要每次点都变） */
export const COMPANION_TAP_MESSAGES: string[] = [
  '我在呢。',
  '今天也一起慢慢来。',
  '我们一步步就好。',
  '坚持本身已经很棒了。',
  '我和你在一起 ✨',
  '有你陪着我走就很好。',
];

/** 升级后（升级弹层之外，首页短时间显示 happy + 文案） */
export const LEVEL_UP_BANNER_MESSAGES: string[] = [
  '我们一起长大了一点。\n继续出发吧。',
  '谢谢你陪着我成长。',
  '旅程又往前一步啦 ✨',
];

/** 特别任务完成的小开心（文案） */
export const SPECIAL_TASK_DONE_MESSAGES: string[] = [
  '小挑战也完成啦 ✨',
  '今天的你超用心。',
  '又攒到了新的能量。',
];

// ---------------------------------------------------------------
// 稳定选择函数（date + context + 任意 salt 不会每次刷新变）
// ---------------------------------------------------------------

/** 把一个字符串哈希成一个非负整数（简单版 FNV-1a 64 位截断，纯字符串即可） */
function _hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 从文案池中稳定取一条：同一天 + 同一个 context 不变。
 * @param date YYYY-MM-DD
 * @param context 例如 'opening_0' / 'task_1' / 'tap' / 'welcome_back'
 * @param pool 文案池
 * @param extraSalt 额外 salt（例如 hour、completedCount），需要同一天内不同场景可分别控制是否稳定
 */
export function pickStableMessage(
  date: string,
  context: string,
  pool: string[],
  extraSalt: string | number = '',
): string {
  if (!pool || pool.length === 0) return '';
  if (pool.length === 1) return pool[0];
  const key = `${date}|${context}|${String(extraSalt)}`;
  const idx = _hash(key) % pool.length;
  return pool[idx];
}

// ---------------------------------------------------------------
// 对外：快捷 pick 接口
// ---------------------------------------------------------------

export function pickOpening0Message(date: string): string {
  return pickStableMessage(date, 'opening_0', OPENING_0_3_MESSAGES, '');
}

export function pickFirstTaskFeedback(date: string): string {
  return pickStableMessage(date, 'task_1', FIRST_TASK_FEEDBACK, '');
}

export function pickSecondTaskFeedback(date: string): string {
  return pickStableMessage(date, 'task_2', SECOND_TASK_FEEDBACK, '');
}

export function pickAllThreeDoneMessage(): string {
  return ALL_THREE_DONE_MESSAGE;  // 唯一一句，仪式感
}

export function pickWelcomeBackMessage(date: string): string {
  return pickStableMessage(date, 'welcome_back', WELCOME_BACK_MESSAGES, '');
}

export function pickTapMessage(date: string): string {
  // 每小时允许切换一句；避免同一天每次点都完全一样，又不会"疯狂点疯狂变"
  const hour = new Date().getHours();
  return pickStableMessage(date, 'tap', COMPANION_TAP_MESSAGES, String(Math.floor(hour / 4)));
}

export function pickLevelUpBannerMessage(date: string): string {
  return pickStableMessage(date, 'levelup_banner', LEVEL_UP_BANNER_MESSAGES, '');
}

export function pickSpecialTaskDoneMessage(date: string): string {
  return pickStableMessage(date, 'special_done', SPECIAL_TASK_DONE_MESSAGES, '');
}

// ---------------------------------------------------------------
// 任务完成度 → mood 映射（同需求第五条）
// ---------------------------------------------------------------
export function moodByCompletedCount(n: 0 | 1 | 2 | 3): CompanionMood {
  if (n === 3) return 'happy';
  if (n === 0) return 'encouraging';
  return 'neutral';
}
