// pages/reward/reward.ts - 奖励页逻辑
import { type Reward, UI_MSG, EMPTY_MSG } from '../../types/index';
import { toUserFriendlyError, toastSafe } from '../../services/uiStrings';
import {
  trackRewardCreated,
  trackRewardUnlockedOnce,
  trackRewardRedeemed,
} from '../../services/usageService';

import {
  REWARD_REQUIRED_POINTS_MIN,
  REWARD_REQUIRED_POINTS_MAX,
  REWARD_TITLE_MAX_LENGTH,
  DEFAULT_EMOJI
} from '../../types/index';

import {
  calculateTotalPoints,
  loadRewards,
  createReward,
  updateReward,
  deleteReward,
  redeemReward,
  validateRewardInput,
  sortRewardsForDisplay,
  calcRewardProgress,
  type RewardProgress
} from '../../utils/reward';

/** WXML 列表项（把奖励 + 派生进度打包） */
interface RewardDisplayItem {
  id: string;                       // 方便 wx:key 使用
  reward: Reward;
  achieved: boolean;
  progress: RewardProgress;
}

interface RewardPageData {
  totalPoints: number;
  heroTip: string;
  displayRewards: RewardDisplayItem[];

  // 常量暴露给 modal 校验提示
  REWARD_REQUIRED_POINTS_MIN: number;
  REWARD_REQUIRED_POINTS_MAX: number;
  REWARD_TITLE_MAX_LENGTH: number;
}

Page({
  data: {
    totalPoints: 0,
    heroTip: '今天又完成了一点。距离自己的奖励又近了一步。',
    displayRewards: [] as RewardDisplayItem[],

    REWARD_REQUIRED_POINTS_MIN,
    REWARD_REQUIRED_POINTS_MAX,
    REWARD_TITLE_MAX_LENGTH
  } as RewardPageData,

  onLoad() {
    this.refreshAll();
  },

  onShow() {
    // 从今日页切回来时刷新累计积分（因为今天可能完成了新任务）
    this.refreshAll();
  },

  /** 内存缓存：所有奖励源列表 */
  rewardsCache: [] as Reward[],

  // ================================================================
  // 刷新核心：累计积分 + 奖励列表 + 派生进度
  // ================================================================
  refreshAll() {
    const totalPoints = calculateTotalPoints();
    const rewards = loadRewards();
    this.rewardsCache = rewards;
    const display = this.buildDisplayItems(rewards, totalPoints);
    const heroTip = this.computeHeroTip(rewards, totalPoints);
    this.setData({
      totalPoints,
      heroTip,
      displayRewards: display
    });
    // V9-fix2：奖励解锁埋点——在刷新时检查所有未领取但已达标奖励，补记 reward_unlocked（每个 rewardId 只记一次）
    try {
      for (const r of rewards) {
        if (!r.redeemed && totalPoints >= r.requiredPoints) {
          trackRewardUnlockedOnce(r.id, r.requiredPoints);
        }
      }
    } catch { /* ignore */ }
  },

  buildDisplayItems(rewards: Reward[], totalPoints: number): RewardDisplayItem[] {
    const sorted = sortRewardsForDisplay(rewards);
    return sorted.map(r => {
      const progress = calcRewardProgress(totalPoints, r.requiredPoints);
      return {
        id: r.id,
        reward: r,
        achieved: r.redeemed ? true : progress.achieved,
        progress
      };
    });
  },

  computeHeroTip(rewards: Reward[], totalPoints: number): string {
    if (rewards.length === 0) {
      // 还没有任何奖励：给"设置第一个奖励"的空态看，这里留一句温和标语
      return '今天又完成了一点。给坚持这件事一点期待。';
    }
    const unredeemed = rewards.filter(r => !r.redeemed);
    if (unredeemed.length === 0) {
      return '这些奖励都已经领啦。可以添加新的期待，继续往前走。';
    }
    const unlocked = unredeemed.find((r: Reward) => totalPoints >= r.requiredPoints);
    if (unlocked) {
      return `「${unlocked.title}」已经解锁，记得对自己好一点～`;
    }
    // 下一个最近的还差多少（温和语气，不喊加油）
    const sorted = [...unredeemed].sort((a, b) => a.requiredPoints - b.requiredPoints);
    const next = sorted[0];
    const remain = Math.max(0, next.requiredPoints - totalPoints);
    if (remain === 0) {
      return `再往前走一点点，就能解锁「${next.title}」啦。`;
    }
    return `还差 ${remain} 积分就能解锁「${next.title}」。`;
  },

  // ================================================================
  // 新建 / 编辑：统一用两次 modal（先名字，后积分）
  // ================================================================
  onClickNewReward() {
    this.openRewardForm({ mode: 'create' });
  },

  onClickEditReward(e: any) {
    const id = e && e.currentTarget && e.currentTarget.dataset.id;
    if (!id || typeof id !== 'string') return;
    const target = this.rewardsCache.find((r: Reward) => r.id === id);
    if (!target) return;
    if (target.redeemed) {
      wx.showToast({ title: '已领取的奖励不可编辑', icon: 'none' });
      return;
    }
    this.openRewardForm({ mode: 'edit', reward: target });
  },

  /**
   * 通用"新建/编辑"表单弹窗：
   * 由于 wx.showModal 一次只支持一个输入框，这里按顺序弹 3 个：
   *   1. 奖励名称（必填，最长 20 字）
   *   2. Emoji（可选，空则用默认 🟟）
   *   3. 所需积分（正整数，10 ~ 100000）
   * 全部填完通过校验后写入 storage。
   */
  openRewardForm(opts: { mode: 'create' } | { mode: 'edit'; reward: Reward }) {
    const page = this;
    const isEdit = opts.mode === 'edit';
    const draft = isEdit
      ? { title: opts.reward.title, emoji: opts.reward.emoji || DEFAULT_EMOJI, points: String(opts.reward.requiredPoints) }
      : { title: '', emoji: DEFAULT_EMOJI, points: '' };

    function askTitle() {
      wx.showModal({
        title: isEdit ? '修改奖励名称' : '1 / 3 奖励名称',
        content: '',
        editable: true,
        placeholderText: '例如：买一件喜欢的衣服（最多 30 字）',
        confirmText: '下一步',
        cancelText: '取消',
        success(r) {
          if (!r.confirm) return;
          const title = (r.content || '').trim();
          if (title.length === 0) {
            wx.showToast({ title: '奖励名称不能为空', icon: 'none' });
            askTitle(); // 重问
            return;
          }
          if (title.length > REWARD_TITLE_MAX_LENGTH) {
            wx.showToast({ title: `最多 ${REWARD_TITLE_MAX_LENGTH} 字`, icon: 'none' });
            askTitle();
            return;
          }
          draft.title = title;
          askEmoji();
        }
      });
    }

    function askEmoji() {
      wx.showModal({
        title: '2 / 3 Emoji 图标（可选）',
        content: '',
        editable: true,
        placeholderText: '例如：🎁 ☕ 🎬 🪁（留空默认 🟟）',
        confirmText: '下一步',
        cancelText: '取消',
        success(r) {
          if (!r.confirm) return;
          const raw = (r.content || '').trim();
          draft.emoji = raw.length > 0 ? raw : DEFAULT_EMOJI;
          askPoints();
        }
      });
    }

    function askPoints() {
      wx.showModal({
        title: isEdit ? '修改所需积分' : `3 / 3 需要积分（${REWARD_REQUIRED_POINTS_MIN}~${REWARD_REQUIRED_POINTS_MAX}）`,
        content: '',
        editable: true,
        placeholderText: '例如：300（正整数）',
        confirmText: isEdit ? '保存' : '创建',
        cancelText: '取消',
        success(r) {
          if (!r.confirm) return;
          const pointsStr = (r.content || '').trim();
          const v = validateRewardInput({ title: draft.title, emoji: draft.emoji, requiredPointsStr: pointsStr });
          if (!v.ok) {
            wx.showToast({ title: v.msg, icon: 'none' });
            askPoints();
            return;
          }
          // 最终落库
          if (isEdit && opts.mode === 'edit') {
            const target = opts.reward;
            updateReward(target.id, {
              title: draft.title,
              emoji: draft.emoji,
              requiredPoints: v.requiredPoints
            });
            wx.showToast({ title: '已更新', icon: 'success' });
          } else {
            createReward({
              title: draft.title,
              emoji: draft.emoji,
              requiredPoints: v.requiredPoints
            });
            // V9：最小行为统计（不存奖励名称，只存所需积分）
            try { trackRewardCreated(v.requiredPoints); } catch { /* ignore */ }
            wx.showToast({ title: '已创建', icon: 'success' });
          }
          page.refreshAll();
        }
      });
    }

    askTitle();
  },

  // ================================================================
  // 删除：二次确认
  // ================================================================
  onClickDeleteReward(e: any) {
    const id = e && e.currentTarget && e.currentTarget.dataset.id;
    if (!id || typeof id !== 'string') return;
    const target = this.rewardsCache.find((r: Reward) => r.id === id);
    if (!target) return;
    const page = this;
    wx.showModal({
      title: target.redeemed ? '删除领取记录？' : '删除这个奖励？',
      content: `${target.emoji} ${target.title}（需要 ${target.requiredPoints} 积分）`,
      confirmText: '删除',
      confirmColor: '#D04343',
      cancelText: '再想想',
      success(r: { confirm: boolean; cancel?: boolean; content?: string }) {
        if (!r.confirm) return;
        const ok = deleteReward(id);
        if (ok) {
          wx.showToast({ title: '已删除', icon: 'success' });
          page.refreshAll();
        } else {
          toastSafe(UI_MSG.STORAGE_SAVE_FAIL);
        }
      }
    });
  },

  // ================================================================
  // 领取奖励
  // ================================================================
  onClickRedeemReward(e: any) {
    const id = e && e.currentTarget && e.currentTarget.dataset.id;
    if (!id || typeof id !== 'string') return;
    const target = this.rewardsCache.find((r: Reward) => r.id === id);
    if (!target) return;
    if (target.redeemed) {
      wx.showToast({ title: '该奖励已领取', icon: 'none' });
      return;
    }
    const totalPoints = calculateTotalPoints();
    if (totalPoints < target.requiredPoints) {
      wx.showToast({ title: `还差 ${target.requiredPoints - totalPoints} 积分`, icon: 'none' });
      return;
    }
    const page = this;
    wx.showModal({
      title: '确定领取这个奖励吗？',
      content: `${target.emoji} ${target.title}`,
      confirmText: '确认领取',
      cancelText: '再等等',
      success(r) {
        if (!r.confirm) return;
        let result = false;
        try {
          result = !!redeemReward(target.id);
        } catch (e) {
          toastSafe(toUserFriendlyError(e, UI_MSG.STORAGE_SAVE_FAIL));
          return;
        }
        if (!result) {
          toastSafe(UI_MSG.STORAGE_SAVE_FAIL);
          return;
        }
        // V9：最小行为统计（不存奖励名称，只存所需积分）
        // V9-fix2：unlock 事件已在 refreshAll 时由 trackRewardUnlockedOnce 记过，这里只记 redeemed
        try {
          trackRewardRedeemed(target.requiredPoints);
        } catch { /* ignore */ }
        wx.showToast({ title: '✓ 已领取', icon: 'none', duration: 900 });
        page.refreshAll();
      }
    });
  }
});
