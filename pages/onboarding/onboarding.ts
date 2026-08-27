// pages/onboarding/onboarding.ts - V8 极简首次使用引导：只问"坚持多久"（7/28/90 默认 28）
import {
  DEFAULT_GOAL_DAYS,
  GOAL_DAY_OPTIONS,
  GoalDaysOption,
  STORAGE_KEY_GOAL_DAYS,
  STORAGE_KEY_ONBOARDING_DONE,
  STORAGE_KEY_FIRST_DATE,
} from '../../types/index';
import { getTodayString } from '../../utils/date';

interface OptionItem {
  days: GoalDaysOption;
  label: string;
  sub: string;
  selected: boolean;
}

Page({
  data: {
    options: [] as OptionItem[],
    selected: DEFAULT_GOAL_DAYS as GoalDaysOption,
  },

  onLoad() {
    // V9：修复 V8 已知 bug #7——老用户冷启动会停在 onboarding 页。
    //     已完成引导 → 直接跳首页，不显示任何引导 UI。
    try {
      const done = wx.getStorageSync(STORAGE_KEY_ONBOARDING_DONE);
      if (done === true || done === 1) {
        try {
          wx.switchTab({
            url: '/pages/index/index',
          });
          return;  // switchTab 会 async 跳转，此处返回，防止 onLoad 继续跑数据
        } catch {
          try { wx.redirectTo({ url: '/pages/index/index' }); return; } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }

    const current = (() => {
      try {
        const v = wx.getStorageSync(STORAGE_KEY_GOAL_DAYS);
        const n = Number(v);
        if (n === 7 || n === 28 || n === 90) return n as GoalDaysOption;
      } catch { /* ignore */ }
      return DEFAULT_GOAL_DAYS;
    })();
    this._applySelection(current);
  },

  _applySelection(target: GoalDaysOption) {
    const options: OptionItem[] = GOAL_DAY_OPTIONS.map(d => ({
      days: d,
      label: `${d}天`,
      sub: d === 7 ? '试一试' : d === 28 ? '养成一个小习惯' : '长期坚持',
      selected: d === target,
    }));
    this.setData({ options, selected: target });
  },

  onClickOption(e: any) {
    const raw = e?.currentTarget?.dataset?.days;
    const n = Number(raw);
    if (n !== 7 && n !== 28 && n !== 90) return;
    this._applySelection(n as GoalDaysOption);
  },

  onClickStart() {
    const days: GoalDaysOption = this.data.selected || DEFAULT_GOAL_DAYS;
    try {
      wx.setStorageSync(STORAGE_KEY_GOAL_DAYS, days);
      wx.setStorageSync(STORAGE_KEY_ONBOARDING_DONE, true);
    } catch { /* ignore */ }
    // 保证首次启动日期也已记录（首页"第几天"用）
    try {
      const first = wx.getStorageSync(STORAGE_KEY_FIRST_DATE);
      if (!first || typeof first !== 'string' || first.length === 0) {
        wx.setStorageSync(STORAGE_KEY_FIRST_DATE, getTodayString());
      }
    } catch { /* ignore */ }
    // 完成引导后 → 进入"今日"首页（首页欢迎卡会判断是否显示"记录第一餐"）
    try {
      wx.switchTab({
        url: '/pages/index/index',
      });
    } catch {
      // 异常兜底：redirect 回首页
      try { wx.redirectTo({ url: '/pages/index/index' }); } catch { /* ignore */ }
    }
  }
});
