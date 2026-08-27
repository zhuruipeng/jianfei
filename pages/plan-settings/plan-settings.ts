// pages/plan-settings/plan-settings.ts
// V10 计划设置页：修改目标 / 结束计划 / 重新开始
//
// 设计：
//  - 进入时 loadActivePlan；无 plan 显示空状态
//  - 修改目标：本地先暂存选中值，goalsChanged=true 时显示"保存目标"按钮
//    保存 → planService.updateActivePlanGoals（内部同步今日 snapshot，历史日不动）
//  - 结束计划：showModal 二次确认 → planService.stopActivePlan → 回首页
//  - 重新开始新计划：navigateTo plan-setup
import {
  EXERCISE_GOAL_OPTIONS,
  WATER_GOAL_OPTIONS,
  UI_MSG,
} from '../../types/index';
import * as planService from '../../services/planService';
import {
  getTodayString,
  formatDateCN,
  calculatePlanDay,
} from '../../utils/date';
import type { UserPlan } from '../../types/index';

interface OptionItem {
  value: number;
  label: string;
  selected: boolean;
}

interface PlanSettingsPageData {
  hasPlan: boolean;
  plan: UserPlan | null;
  planTitle: string;
  planStartDateText: string;
  planDay: number;

  exerciseOptions: OptionItem[];
  waterOptions: OptionItem[];

  pendingExercise: number;   // 用户在 UI 上选中但尚未保存的运动目标
  pendingWater: number;      // 同上 喝水目标
  goalsChanged: boolean;     // pending 与当前 plan 目标是否不一致

  errorMsg: string;
}

Page({
  data: {
    hasPlan: false,
    plan: null,
    planTitle: '',
    planStartDateText: '',
    planDay: 1,

    exerciseOptions: [] as OptionItem[],
    waterOptions: [] as OptionItem[],

    pendingExercise: 30,
    pendingWater: 8,
    goalsChanged: false,

    errorMsg: '',
  } as PlanSettingsPageData,

  onLoad() {
    this._refresh();
  },

  onShow() {
    // 从 plan-setup 创建后返回时刷新
    this._refresh();
  },

  _refresh() {
    const plan = planService.loadActivePlan();
    if (!plan) {
      this.setData({ hasPlan: false, plan: null });
      return;
    }
    const planDay = Math.max(1, calculatePlanDay(plan.startDate, getTodayString()));
    const planTitle = `${plan.durationDays}天轻步计划`;
    const planStartDateText = `从 ${formatDateCN(plan.startDate)} 开始`;

    const pendingExercise = plan.exerciseGoalMinutes;
    const pendingWater = plan.waterGoalCups;

    this.setData({
      hasPlan: true,
      plan,
      planTitle,
      planStartDateText,
      planDay,
      pendingExercise,
      pendingWater,
      goalsChanged: false,
      errorMsg: '',
      exerciseOptions: this._buildOptions(EXERCISE_GOAL_OPTIONS, pendingExercise, '分钟'),
      waterOptions: this._buildOptions(WATER_GOAL_OPTIONS, pendingWater, '杯'),
    });
  },

  _buildOptions(values: readonly number[], selected: number, unit: string): OptionItem[] {
    return values.map(v => ({
      value: v,
      label: `${v}${unit}`,
      selected: v === selected,
    }));
  },

  onSelectExercise(e: any) {
    const v = Number(e?.currentTarget?.dataset?.value);
    if (!(EXERCISE_GOAL_OPTIONS as readonly number[]).includes(v)) return;
    const oldPending = (this.data as PlanSettingsPageData).pendingExercise;
    if (v === oldPending) return;
    const plan = (this.data as PlanSettingsPageData).plan;
    const goalsChanged = (v !== plan?.exerciseGoalMinutes) || ((this.data as PlanSettingsPageData).pendingWater !== plan?.waterGoalCups);
    this.setData({
      pendingExercise: v,
      goalsChanged,
      exerciseOptions: this._buildOptions(EXERCISE_GOAL_OPTIONS, v, '分钟'),
    });
  },

  onSelectWater(e: any) {
    const v = Number(e?.currentTarget?.dataset?.value);
    if (!(WATER_GOAL_OPTIONS as readonly number[]).includes(v)) return;
    const oldPending = (this.data as PlanSettingsPageData).pendingWater;
    if (v === oldPending) return;
    const plan = (this.data as PlanSettingsPageData).plan;
    const goalsChanged = (v !== plan?.waterGoalCups) || ((this.data as PlanSettingsPageData).pendingExercise !== plan?.exerciseGoalMinutes);
    this.setData({
      pendingWater: v,
      goalsChanged,
      waterOptions: this._buildOptions(WATER_GOAL_OPTIONS, v, '杯'),
    });
  },

  onSaveGoals() {
    const plan = (this.data as PlanSettingsPageData).plan;
    if (!plan) return;
    const pendingExercise = (this.data as PlanSettingsPageData).pendingExercise;
    const pendingWater = (this.data as PlanSettingsPageData).pendingWater;
    try {
      const updated = planService.updateActivePlanGoals({
        exerciseGoalMinutes: pendingExercise,
        waterGoalCups: pendingWater,
      });
      if (!updated) {
        this.setData({ errorMsg: UI_MSG.STORAGE_SAVE_FAIL });
        return;
      }
      wx.showToast({ title: '✓ 已保存', icon: 'none', duration: 1200 });
      this.setData({
        plan: updated,
        goalsChanged: false,
        errorMsg: '',
      });
    } catch (e) {
      console.error('[plan-settings] updateActivePlanGoals failed', e);
      this.setData({ errorMsg: UI_MSG.STORAGE_SAVE_FAIL });
    }
  },

  onStopPlan() {
    wx.showModal({
      title: '结束当前计划',
      content: '确定结束当前计划吗？\n\n已经记录的数据不会删除。',
      confirmText: '结束计划',
      cancelText: '再想想',
      confirmColor: '#FF6B6B',
      success: (res) => {
        if (!res.confirm) return;
        try {
          const stopped = planService.stopActivePlan();
          if (!stopped) {
            this.setData({ errorMsg: UI_MSG.STORAGE_SAVE_FAIL });
            return;
          }
          wx.showToast({ title: '计划已结束', icon: 'none', duration: 1200 });
          setTimeout(() => this._goHome(), 800);
        } catch (e) {
          console.error('[plan-settings] stopActivePlan failed', e);
          this.setData({ errorMsg: UI_MSG.STORAGE_SAVE_FAIL });
        }
      },
    });
  },

  onStartNewPlan() {
    wx.navigateTo({
      url: '/pages/plan-setup/plan-setup',
      fail: () => {
        this.setData({ errorMsg: '暂时打不开，请稍后再试。' });
      },
    });
  },

  onGoSetup() {
    wx.navigateTo({
      url: '/pages/plan-setup/plan-setup',
      fail: () => {
        this.setData({ errorMsg: '暂时打不开，请稍后再试。' });
      },
    });
  },

  _goHome() {
    try {
      wx.switchTab({ url: '/pages/index/index' });
    } catch {
      try { wx.redirectTo({ url: '/pages/index/index' }); } catch { /* ignore */ }
    }
  },
});
