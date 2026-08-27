/**
 * weeklySummaryService.ts
 * WeeklySummary 模块的薄封装：首页 refreshAll 调用入口 + 页面查看入口
 *  - ensureWeeklySummariesUpTo：进入首页时按当前 planDay 幂等生成已结束的完整周快照
 *  - loadWeeklySummaryForView / loadPlanSummaryForView：页面跳转前取数
 */

import * as wsUtil from '../utils/weeklySummary';
import * as planSummaryUtil from '../utils/planSummary';
import { WeeklySummary, UserPlan, UI_MSG } from '../types/index';
import { findPlanById } from '../utils/plan';
import { PlanSummaryAggregate } from '../utils/planSummary';

// Re-export：常用工具直接透出
export {
  findWeeklySummary,
  isWeeklySummaryViewed,
  markWeeklySummaryViewed,
  findNextUnviewedWeek,
  getPlanWeekCount,
  buildWeekRange,
  ensureWeeklySummaryForWeek,
} from '../utils/weeklySummary';

/**
 * 进入首页时调用：根据当前 planDay，确保已结束的完整周都生成快照。
 *  - completedWeeks = Math.min(totalWeeks, Math.floor((currentPlanDay - 1) / 7))
 *    currentPlanDay=8 → completedWeeks=1（第一周已结束）
 *    currentPlanDay=28 → completedWeeks=3（Week4=Day22-Day28 还在进行，不生成）
 *    currentPlanDay=29 → completedWeeks=4（Week4 已结束）
 *  - 已存在的 summary 不重算（快照幂等）
 */
export function ensureWeeklySummariesUpTo(plan: UserPlan, currentPlanDay: number): WeeklySummary[] {
  if (!plan || currentPlanDay < 1) return [];
  const totalWeeks = wsUtil.getPlanWeekCount(plan);
  const completedWeeks = Math.min(totalWeeks, Math.floor((currentPlanDay - 1) / 7));
  const out: WeeklySummary[] = [];
  for (let w = 1; w <= completedWeeks; w++) {
    const s = wsUtil.ensureWeeklySummaryForWeek(plan, w);
    if (s) out.push(s);
  }
  return out;
}

/** 跳转周总结页前的取数 */
export function loadWeeklySummaryForView(
  planId: string,
  weekNumber: number
): { ok: boolean; summary?: WeeklySummary; msg?: string } {
  if (!planId || weekNumber < 1) {
    return { ok: false, msg: '参数不合法' };
  }
  const plan = findPlanById(planId);
  if (!plan) {
    return { ok: false, msg: UI_MSG.RECORD_NOT_FOUND };
  }
  // 优先读已生成快照；若无则现场生成（兼容 dev seed 等场景）
  let summary: WeeklySummary | undefined = wsUtil.findWeeklySummary(planId, weekNumber) || undefined;
  if (!summary) {
    summary = wsUtil.ensureWeeklySummaryForWeek(plan, weekNumber) || undefined;
  }
  if (!summary) {
    return { ok: false, msg: '该周总结暂不可用' };
  }
  return { ok: true, summary };
}

/** 跳转 28/90 天总结页前的取数 */
export function loadPlanSummaryForView(
  planId: string
): { ok: boolean; summary?: PlanSummaryAggregate; msg?: string } {
  if (!planId) {
    return { ok: false, msg: '参数不合法' };
  }
  const plan = findPlanById(planId);
  if (!plan) {
    return { ok: false, msg: UI_MSG.RECORD_NOT_FOUND };
  }
  try {
    const summary = planSummaryUtil.computePlanSummary(plan);
    return { ok: true, summary };
  } catch (e) {
    return { ok: false, msg: UI_MSG.STORAGE_SAVE_FAIL };
  }
}
