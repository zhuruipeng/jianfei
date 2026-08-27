// utils/reward.ts - 奖励 CRUD + 累计积分计算（按 DailyRecords 动态求和，永不重复奖励）

import {
  type DailyRecord,
  type Reward,
  STORAGE_PREFIX_DAILY,
  STORAGE_KEY_REWARDS,
  DEFAULT_REWARDS,
  DEFAULT_EMOJI,
  REWARD_REQUIRED_POINTS_MIN,
  REWARD_REQUIRED_POINTS_MAX,
  REWARD_TITLE_MAX_LENGTH
} from '../types/index';

import {
  calculatePoints
} from './summary';

import {
  formatDateTimeNow,
  genLocalId
} from './date';

// =========================================================================
// 一、累计积分（核心：遍历所有 daily_record_*，按 calculatePoints 求和）
// =========================================================================

/**
 * 遍历 Storage 中所有以 daily_record_ 开头的 key，读取并累加每天积分。
 * 积分永远按原始记录"重新计算一遍"，不保存累计字段，杜绝重复奖励。
 */
export function calculateTotalPoints(): number {
  try {
    // 微信小程序没有 getStorageInfoSync 类型？typings 里已声明
    const info = wx.getStorageInfoSync();
    const keys = info.keys as string[];
    let total = 0;
    for (const k of keys) {
      if (!k.startsWith(STORAGE_PREFIX_DAILY)) continue;
      try {
        const val = wx.getStorageSync(k) as Partial<DailyRecord> | undefined;
        if (!val) continue;
        // 兼容缺字段，强制补齐后计算
        // V10：透传 snapshot 字段（calculatePoints 内部会调 getEffectiveExerciseGoal 读 snapshot）
        const r: DailyRecord = {
          date: val.date || '',
          breakfastCompleted: !!val.breakfastCompleted,
          lunchCompleted: !!val.lunchCompleted,
          dinnerCompleted: !!val.dinnerCompleted,
          exerciseMinutes: typeof val.exerciseMinutes === 'number' ? Math.max(0, val.exerciseMinutes) : 0,
          waterCups: typeof val.waterCups === 'number' ? Math.max(0, val.waterCups) : 0,
          exerciseGoalMinutesSnapshot: typeof val.exerciseGoalMinutesSnapshot === 'number' && val.exerciseGoalMinutesSnapshot > 0
            ? val.exerciseGoalMinutesSnapshot : undefined,
          waterGoalCupsSnapshot: typeof val.waterGoalCupsSnapshot === 'number' && val.waterGoalCupsSnapshot > 0
            ? val.waterGoalCupsSnapshot : undefined,
        };
        total += calculatePoints(r);
      } catch (e) {
        // 某条损坏跳过
        console.warn('[Reward] calc total points skip key:', k, e);
      }
    }
    return total;
  } catch (e) {
    console.error('[Reward] calculateTotalPoints failed', e);
    return 0;
  }
}

// =========================================================================
// 二、奖励存储读写 + 默认奖励注入
// =========================================================================

function normalizeReward(raw: Partial<Reward>, idx: number): Reward {
  const title = (raw.title && typeof raw.title === 'string') ? raw.title.trim() : `奖励 ${idx + 1}`;
  const requiredPoints = typeof raw.requiredPoints === 'number'
    ? clampRequiredPoints(raw.requiredPoints)
    : REWARD_REQUIRED_POINTS_MIN;
  const emoji = (raw.emoji && typeof raw.emoji === 'string' && raw.emoji.length > 0) ? raw.emoji : DEFAULT_EMOJI;
  return {
    id: (raw.id && typeof raw.id === 'string' && raw.id.length > 0) ? raw.id : genLocalId(),
    title: title.slice(0, REWARD_TITLE_MAX_LENGTH),
    emoji,
    requiredPoints,
    redeemed: !!raw.redeemed,
    redeemedAt: (raw.redeemed && raw.redeemedAt && typeof raw.redeemedAt === 'string') ? raw.redeemedAt : undefined,
    createdAt: (raw.createdAt && typeof raw.createdAt === 'string') ? raw.createdAt : formatDateTimeNow()
  };
}

function clampRequiredPoints(n: number): number {
  if (!isFinite(n) || isNaN(n)) return REWARD_REQUIRED_POINTS_MIN;
  let v = Math.floor(n);
  if (v < REWARD_REQUIRED_POINTS_MIN) v = REWARD_REQUIRED_POINTS_MIN;
  if (v > REWARD_REQUIRED_POINTS_MAX) v = REWARD_REQUIRED_POINTS_MAX;
  return v;
}

/**
 * 读取所有奖励。
 * 如果 rewards 为空（首次访问或用户全部删除），注入默认奖励 3 个。
 */
export function loadRewards(): Reward[] {
  let arr: Reward[] = [];
  try {
    const val = wx.getStorageSync(STORAGE_KEY_REWARDS);
    if (Array.isArray(val)) {
      arr = (val as Partial<Reward>[]).map((r, i) => normalizeReward(r, i));
    }
  } catch (e) {
    console.error('[Reward] loadRewards read failed', e);
    arr = [];
  }

  // 首次使用：注入默认奖励 3 个
  if (arr.length === 0) {
    arr = DEFAULT_REWARDS.map(tpl => normalizeReward({
      ...tpl,
      id: genLocalId(),
      createdAt: formatDateTimeNow()
    }, 0));
    saveRewards(arr);
  }
  return arr;
}

export function saveRewards(rewards: Reward[]): boolean {
  try {
    wx.setStorageSync(STORAGE_KEY_REWARDS, rewards);
    return true;
  } catch (e) {
    console.error('[Reward] saveRewards failed', e);
    return false;
  }
}

/** 校验创建/编辑奖励入参，返回 {ok, msg, reward(仅创建场景)} */
export function validateRewardInput(input: {
  title: string;
  emoji?: string;
  requiredPointsStr: string;
}): { ok: boolean; msg: string; requiredPoints: number } {
  const title = (input.title || '').trim();
  if (title.length === 0) {
    return { ok: false, msg: '奖励名称不能为空', requiredPoints: 0 };
  }
  if (title.length > REWARD_TITLE_MAX_LENGTH) {
    return { ok: false, msg: `奖励名称最多 ${REWARD_TITLE_MAX_LENGTH} 字`, requiredPoints: 0 };
  }
  const ptsStr = (input.requiredPointsStr || '').trim();
  if (!/^\d+$/.test(ptsStr)) {
    return { ok: false, msg: '请输入正确的积分（正整数）', requiredPoints: 0 };
  }
  const pts = parseInt(ptsStr, 10);
  if (!isFinite(pts) || isNaN(pts)) {
    return { ok: false, msg: '请输入正确的积分', requiredPoints: 0 };
  }
  if (pts < REWARD_REQUIRED_POINTS_MIN) {
    return { ok: false, msg: `最低需要 ${REWARD_REQUIRED_POINTS_MIN} 积分`, requiredPoints: 0 };
  }
  if (pts > REWARD_REQUIRED_POINTS_MAX) {
    return { ok: false, msg: `最高不超过 ${REWARD_REQUIRED_POINTS_MAX} 积分`, requiredPoints: 0 };
  }
  return { ok: true, msg: '', requiredPoints: pts };
}

/** 创建一个新奖励并保存 */
export function createReward(input: { title: string; emoji?: string; requiredPoints: number }): Reward {
  const emoji = (input.emoji && input.emoji.trim().length > 0) ? input.emoji.trim() : DEFAULT_EMOJI;
  const newR: Reward = {
    id: genLocalId(),
    title: input.title.trim().slice(0, REWARD_TITLE_MAX_LENGTH),
    emoji,
    requiredPoints: clampRequiredPoints(input.requiredPoints),
    redeemed: false,
    createdAt: formatDateTimeNow()
  };
  const list = loadRewards();
  list.push(newR);
  saveRewards(list);
  return newR;
}

/** 更新已有奖励（title / emoji / requiredPoints） */
export function updateReward(id: string, patch: { title?: string; emoji?: string; requiredPoints?: number }): Reward | null {
  const list = loadRewards();
  const idx = list.findIndex(r => r.id === id);
  if (idx === -1) return null;
  const cur = list[idx];
  const next: Reward = { ...cur };
  if (typeof patch.title === 'string') {
    const t = patch.title.trim();
    if (t.length > 0) next.title = t.slice(0, REWARD_TITLE_MAX_LENGTH);
  }
  if (typeof patch.emoji === 'string') {
    next.emoji = patch.emoji.trim().length > 0 ? patch.emoji.trim() : DEFAULT_EMOJI;
  }
  if (typeof patch.requiredPoints === 'number') {
    next.requiredPoints = clampRequiredPoints(patch.requiredPoints);
  }
  list[idx] = next;
  saveRewards(list);
  return next;
}

/** 删除奖励 */
export function deleteReward(id: string): boolean {
  const list = loadRewards();
  const next = list.filter(r => r.id !== id);
  saveRewards(next);
  return next.length !== list.length;
}

/** 标记已领取 */
export function redeemReward(id: string): Reward | null {
  const list = loadRewards();
  const idx = list.findIndex(r => r.id === id);
  if (idx === -1) return null;
  const cur = list[idx];
  if (cur.redeemed) return cur; // 幂等
  cur.redeemed = true;
  cur.redeemedAt = formatDateTimeNow();
  list[idx] = cur;
  saveRewards(list);
  return cur;
}

// =========================================================================
// 三、展示层辅助：排序 + 进度 + 下一个奖励
// =========================================================================

/**
 * 奖励显示顺序：
 * - 未领取的排在前面，并按 requiredPoints 升序
 * - 已领取的全部放后面，也按 requiredPoints 升序
 */
export function sortRewardsForDisplay(rewards: Reward[]): Reward[] {
  const unredeemed = rewards.filter(r => !r.redeemed);
  const redeemed = rewards.filter(r => r.redeemed);
  unredeemed.sort((a, b) => a.requiredPoints - b.requiredPoints);
  redeemed.sort((a, b) => a.requiredPoints - b.requiredPoints);
  return [...unredeemed, ...redeemed];
}

export interface RewardProgress {
  current: number;           // 当前累计积分
  required: number;          // 所需积分
  percent: number;           // 0~100，最大 100
  remain: number;            // 还差多少（>=0）
  achieved: boolean;         // 是否达到
}

export function calcRewardProgress(totalPoints: number, requiredPoints: number): RewardProgress {
  const current = Math.max(0, totalPoints);
  const required = Math.max(REWARD_REQUIRED_POINTS_MIN, requiredPoints);
  const ratio = required > 0 ? current / required : 1;
  const percent = Math.round(Math.min(ratio, 1) * 100);
  const remain = current >= required ? 0 : required - current;
  return { current, required, percent, remain, achieved: current >= required };
}

/**
 * 找到"下一个奖励"卡片用于首页展示：
 * 规则：
 *  1. 先找所有"未领取"奖励中 requiredPoints > totalPoints 的最小积分那个（最接近的小目标）
 *  2. 如果刚好有一个"未领取"且"已达到但没领"，则优先显示这个（奖励已解锁）
 *  3. 如果已经没有未领取奖励：返回 null
 */
export function pickNextReward(rewards: Reward[], totalPoints: number): {
  reward: Reward;
  status: 'unlocked' | 'next';
  progress: RewardProgress;
} | null {
  const unredeemed = rewards.filter(r => !r.redeemed);
  if (unredeemed.length === 0) return null;

  const unlocked = unredeemed
    .filter(r => totalPoints >= r.requiredPoints)
    .sort((a, b) => a.requiredPoints - b.requiredPoints);
  if (unlocked.length > 0) {
    const r = unlocked[0];
    return { reward: r, status: 'unlocked', progress: calcRewardProgress(totalPoints, r.requiredPoints) };
  }

  const next = unredeemed
    .filter(r => totalPoints < r.requiredPoints)
    .sort((a, b) => a.requiredPoints - b.requiredPoints);
  if (next.length > 0) {
    const r = next[0];
    return { reward: r, status: 'next', progress: calcRewardProgress(totalPoints, r.requiredPoints) };
  }
  return null;
}

export { DEFAULT_EMOJI, REWARD_REQUIRED_POINTS_MIN, REWARD_REQUIRED_POINTS_MAX, REWARD_TITLE_MAX_LENGTH };
