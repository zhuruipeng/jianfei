// pages/plan-summary/plan-summary.ts
// V10 28/90 天计划总结页：展示聚合后的 PlanSummaryAggregate
//  - 入口参数：planId
//  - 数据：weeklySummaryService.loadPlanSummaryForView(planId)
//  - 底部按钮："再开始一个计划" → navigateTo plan-setup
//              "先保持记录" → switchTab 回首页（不锁死任何功能）
import * as weeklySummaryService from '../../services/weeklySummaryService';
import * as planService from '../../services/planService';
import { formatDateCN } from '../../utils/date';
import type { PlanSummaryAggregate } from '../../utils/planSummary';
import { UI_MSG } from '../../types/index';

/** 简单 wrapper：loadActivePlan 出错返回 null（不抛错） */
function planService_loadActivePlanSafe() {
  try { return planService.loadActivePlan(); } catch { return null; }
}

/** 简单的日期加法（YYYY-MM-DD + days → YYYY-MM-DD），按本地时区中午 12 点计算避免时区漂移 */
function addDaysToDate(dateStr: string, days: number): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0, 0);
  if (isNaN(d.getTime())) return dateStr;
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface PlanSummaryPageData {
  loaded: boolean;
  summary: PlanSummaryAggregate | null;

  planTitle: string;
  dateRangeText: string;

  // 体重展示
  weightHasTwo: boolean;
  weightStartText: string;
  weightEndText: string;
  weightChangeText: string;
  weightChangeNegative: boolean;

  errorMsg: string;
}

Page({
  data: {
    loaded: false,
    summary: null,

    planTitle: '',
    dateRangeText: '',

    weightHasTwo: false,
    weightStartText: '',
    weightEndText: '',
    weightChangeText: '',
    weightChangeNegative: false,

    errorMsg: '',
  } as PlanSummaryPageData,

  onLoad(query: Record<string, string>) {
    const planId = String(query?.planId || '');
    if (!planId) {
      this.setData({ loaded: true, errorMsg: '参数不合法' });
      return;
    }
    this._load(planId);
  },

  _load(planId: string) {
    const res = weeklySummaryService.loadPlanSummaryForView(planId);
    if (!res.ok || !res.summary) {
      this.setData({
        loaded: true,
        errorMsg: res.msg || UI_MSG.RECORD_NOT_FOUND,
      });
      return;
    }
    const s = res.summary;
    const planTitle = `${s.plan.durationDays}天轻步计划完成`;
    const planEnd = addDaysToDate(s.plan.startDate, s.plan.durationDays - 1);
    const dateRangeText = `${formatDateCN(s.plan.startDate)} - ${formatDateCN(planEnd)}`;

    // 体重展示
    const hasStart = typeof s.weightStart === 'number' && isFinite(s.weightStart);
    const hasEnd = typeof s.weightEnd === 'number' && isFinite(s.weightEnd);
    const hasChange = typeof s.weightChange === 'number' && isFinite(s.weightChange);
    let weightHasTwo = false;
    let weightStartText = '';
    let weightEndText = '';
    let weightChangeText = '';
    let weightChangeNegative = false;
    if (hasStart && hasEnd) {
      weightHasTwo = true;
      weightStartText = `${s.weightStart!.toFixed(1)} kg`;
      weightEndText = `${s.weightEnd!.toFixed(1)} kg`;
      if (hasChange) {
        const sign = s.weightChange! > 0 ? '+' : (s.weightChange! < 0 ? '' : '');
        weightChangeText = `变化 ${sign}${s.weightChange!.toFixed(1)} kg`;
        weightChangeNegative = s.weightChange! < 0;
      } else {
        weightChangeText = '变化 0 kg';
      }
    }

    this.setData({
      loaded: true,
      summary: s,
      planTitle,
      dateRangeText,
      weightHasTwo,
      weightStartText,
      weightEndText,
      weightChangeText,
      weightChangeNegative,
      errorMsg: '',
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

  onKeepRecording() {
    // V10：标记 plan 为 completed（下次首页 loadActivePlan 返回 null，完成入口不再显示）
    //   同时 markPlanSetupDismissed，避免首页立刻弹"加入计划"提示卡
    try {
      const s = (this.data as PlanSummaryPageData).summary;
      if (s && s.plan.id) {
        // 仅当当前 active plan 就是本总结对应的 plan 时才标记（防止用户已新建计划的边界）
        const active = planService_loadActivePlanSafe();
        if (active && active.id === s.plan.id) {
          planService.markActivePlanCompleted();
        }
      }
      planService.markPlanSetupDismissed();
    } catch (e) {
      console.warn('[plan-summary] markActivePlanCompleted failed', e);
    }
    this._goHome();
  },

  onGoHome() {
    this._goHome();
  },

  _goHome() {
    try {
      wx.switchTab({ url: '/pages/index/index' });
    } catch {
      try { wx.redirectTo({ url: '/pages/index/index' }); } catch { /* ignore */ }
    }
  },
});
