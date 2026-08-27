/**
 * rewardService.ts
 * 奖励模块统一封装：积分/奖励/领取，不要让页面自己实现逻辑
 *  - 累计积分"累计努力值"模型（redeem 不扣分）。
 *  - pickNextReward：优先"已解锁未领取"→"下一个未解锁"。
 */

import {
  Reward,
  DEFAULT_REWARDS,
  DEFAULT_EMOJI,
  REWARD_REQUIRED_POINTS_MIN,
  REWARD_REQUIRED_POINTS_MAX,
  REWARD_TITLE_MAX_LENGTH,
  UI_MSG,
} from '../types/index';
import {
  calculateTotalPoints,
  loadRewards as _loadAll,
  saveRewards as _saveAll,
  pickNextReward as _pickNext,
  redeemReward as _redeem,
  sortRewardsForDisplay,
  createReward as _create,
  updateReward as _update,
  deleteReward as _delete,
  validateRewardInput,
  calcRewardProgress,
} from '../utils/reward';

export {
  calculateTotalPoints,
  sortRewardsForDisplay,
  validateRewardInput,
  calcRewardProgress,
  DEFAULT_REWARDS,
  DEFAULT_EMOJI,
  REWARD_REQUIRED_POINTS_MIN,
  REWARD_REQUIRED_POINTS_MAX,
  REWARD_TITLE_MAX_LENGTH,
};

/** 读所有奖励（rewards 为空 & 从未创建时，返回 DEFAULT_REWARDS 作为 UI 展示 —— 但不立刻写入 Storage，避免用户未操作就"被创建"） */
export function loadRewards(withDefaultsForDisplay = true): Reward[] {
  const list = _loadAll();
  if (list.length === 0 && withDefaultsForDisplay) {
    return DEFAULT_REWARDS.map((d, i) => ({
      id: 'default_preview_' + i,
      createdAt: 'default_preview',
      ...d,
    }));
  }
  return sortRewardsForDisplay(list);
}

/** 下一奖励（首页用）。没有任何奖励也返回 null，由页面做空态判断。 */
export function pickNextReward(): Reward | null {
  const rewards = _loadAll();
  if (rewards.length === 0) return null;
  const total = calculateTotalPoints();
  const r = _pickNext(rewards, total);
  return r ? r.reward : null;
}

/** 是否已创建过至少一个真实奖励（非预览 default） */
export function hasAnyUserReward(): boolean {
  return _loadAll().length > 0;
}

/** 创建新奖励（validate+写 Storage） */
export function createReward(input: { title: string; emoji?: string; requiredPoints: number }): Reward {
  try {
    return _create(input);
  } catch (e) {
    const err = new Error(UI_MSG.STORAGE_SAVE_FAIL);
    (err as any).cause = e;
    throw err;
  }
}

export function updateReward(id: string, patch: Partial<Pick<Reward, 'title' | 'emoji' | 'requiredPoints'>>): Reward | null {
  try {
    return _update(id, patch);
  } catch (e) {
    const err = new Error(UI_MSG.STORAGE_SAVE_FAIL);
    (err as any).cause = e;
    throw err;
  }
}

export function deleteReward(id: string): boolean {
  try {
    return _delete(id);
  } catch (e) {
    const err = new Error(UI_MSG.STORAGE_SAVE_FAIL);
    (err as any).cause = e;
    throw err;
  }
}

/** 领取奖励（redeem 不扣积分，仅置 redeemed=true+redeemedAt）；积分不足则返回 ok=false */
export function redeemReward(id: string): { ok: boolean; msg: string; reward?: Reward } {
  const total = calculateTotalPoints();
  const r = _redeem(id);
  if (!r) {
    return { ok: false, msg: '奖励不存在或已被删除' };
  }
  if (total < r.requiredPoints) {
    return { ok: false, msg: '积分还不够，再坚持一下' };
  }
  return { ok: true, msg: '已领取', reward: r };
}
