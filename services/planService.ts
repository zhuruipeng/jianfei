/**
 * planService.ts
 * UserPlan 模块的薄封装：UI 错误文案映射 + snapshot 写入 + 目标修改
 *  - 页面不直接调用 utils/plan.ts，统一经过这里
 *  - writeSnapshotIfMissing：保证 DailyRecord 在 plan 存在时写入当日目标快照
 *  - updateActivePlanGoals：修改目标后同步覆盖今日 snapshot（历史日不动）
 */

import * as planUtil from '../utils/plan';
import {
  UserPlan,
  UI_MSG,
  STORAGE_KEY_PLAN_SETUP_DISMISSED,
} from '../types/index';
import { getTodayString } from '../utils/date';
import { ensureDailyRecordForDate, loadAnyDailyRecordForDate } from '../utils/summary';
import { saveDailyRecord } from '../utils/storage';

// Re-export：低级 CRUD 直接透出（避免页面绕过 service 调用 utils）
export {
  loadPlanHistory,
  loadAllPlans,
} from '../utils/plan';

// 页面常用：loadActivePlan / findPlanById / markActivePlanCompleted / stopActivePlan /
// validatePlanInput / createPlan 在下面单独 export function（统一加 UI 错误处理）
export function loadActivePlan(): UserPlan | null {
  return planUtil.loadActivePlan();
}

export function findPlanById(planId: string): UserPlan | null {
  return planUtil.findPlanById(planId);
}

export function markActivePlanCompleted(): UserPlan | null {
  return planUtil.markActivePlanCompleted();
}

export function stopActivePlan(): UserPlan | null {
  return planUtil.stopActivePlan();
}

export function validatePlanInput(input: planUtil.PlanCreateInput): ReturnType<typeof planUtil.validatePlanInput> {
  return planUtil.validatePlanInput(input);
}

/**
 * 创建新 plan（UI 错误统一抛 UI_MSG.STORAGE_SAVE_FAIL）
 *  - 内部：旧 active 移入 history；写新 plan；同步 STORAGE_KEY_FIRST_DATE
 */
export function createPlan(input: planUtil.PlanCreateInput): UserPlan {
  try {
    return planUtil.createPlan(input);
  } catch (e) {
    const err = new Error(UI_MSG.STORAGE_SAVE_FAIL);
    (err as any).cause = e;
    throw err;
  }
}

/**
 * 写入 snapshot 到指定日期的 DailyRecord（若缺失且 plan 存在）。
 *  - 若无 active plan，no-op
 *  - 若已有 snapshot，no-op（避免覆盖历史）
 *  - 否则读 plan.exerciseGoalMinutes / waterGoalCups 写入 record 并 save
 */
export function writeSnapshotIfMissing(date: string): void {
  try {
    if (!date || date.length === 0) return;
    const plan = planUtil.loadActivePlan();
    if (!plan) return;  // 无 plan 不写 snapshot（旧用户行为不变）

    // 只读读当日 record（不自动创建，避免历史日被无意补写）
    let rec = loadAnyDailyRecordForDate(date);
    if (!rec) {
      // 当日还没记录：创建空白并保存（仅当日，不影响历史）
      rec = ensureDailyRecordForDate(date);
    }

    // 已有 snapshot 不覆盖
    const hasExSnapshot = typeof rec.exerciseGoalMinutesSnapshot === 'number' && rec.exerciseGoalMinutesSnapshot > 0;
    const hasWaterSnapshot = typeof rec.waterGoalCupsSnapshot === 'number' && rec.waterGoalCupsSnapshot > 0;
    if (hasExSnapshot && hasWaterSnapshot) return;

    const updated = { ...rec };
    if (!hasExSnapshot) updated.exerciseGoalMinutesSnapshot = plan.exerciseGoalMinutes;
    if (!hasWaterSnapshot) updated.waterGoalCupsSnapshot = plan.waterGoalCups;
    saveDailyRecord(updated);
  } catch (e) {
    // snapshot 写入失败不应阻断主流程
    console.warn('[planService] writeSnapshotIfMissing failed', date, e);
  }
}

/**
 * 修改 active plan 的运动/喝水目标（startDate 不可改）。
 *  - 二次确认由调用方（页面）做
 *  - 更新 plan.exerciseGoalMinutes / waterGoalCups
 *  - 同步更新今日 DailyRecord 的 snapshot 为新值（覆盖今日旧 snapshot — "今天及以后用新目标"）
 *  - 历史日的 snapshot 不动（保证历史完成状态不漂移）
 */
export function updateActivePlanGoals(patch: { exerciseGoalMinutes?: number; waterGoalCups?: number }): UserPlan | null {
  const plan = planUtil.loadActivePlan();
  if (!plan) return null;

  const updated: UserPlan = { ...plan };
  if (typeof patch.exerciseGoalMinutes === 'number' && patch.exerciseGoalMinutes > 0) {
    updated.exerciseGoalMinutes = patch.exerciseGoalMinutes;
  }
  if (typeof patch.waterGoalCups === 'number' && patch.waterGoalCups > 0) {
    updated.waterGoalCups = patch.waterGoalCups;
  }
  try {
    planUtil.saveActivePlan(updated);
  } catch (e) {
    const err = new Error(UI_MSG.STORAGE_SAVE_FAIL);
    (err as any).cause = e;
    throw err;
  }

  // 同步覆盖今日 snapshot（今日及以后用新目标）
  try {
    const today = getTodayString();
    let rec = loadAnyDailyRecordForDate(today);
    if (!rec) {
      rec = ensureDailyRecordForDate(today);
    }
    const newRec = { ...rec };
    if (typeof patch.exerciseGoalMinutes === 'number' && patch.exerciseGoalMinutes > 0) {
      newRec.exerciseGoalMinutesSnapshot = patch.exerciseGoalMinutes;
    }
    if (typeof patch.waterGoalCups === 'number' && patch.waterGoalCups > 0) {
      newRec.waterGoalCupsSnapshot = patch.waterGoalCups;
    }
    saveDailyRecord(newRec);
  } catch (e) {
    console.warn('[planService] updateActivePlanGoals: sync today snapshot failed', e);
  }

  return updated;
}

/** 标记"加入 28 天计划"提示卡 dismissed */
export function markPlanSetupDismissed(): void {
  try {
    wx.setStorageSync(STORAGE_KEY_PLAN_SETUP_DISMISSED, true);
  } catch { /* ignore */ }
}

export function isPlanSetupDismissed(): boolean {
  try {
    return wx.getStorageSync(STORAGE_KEY_PLAN_SETUP_DISMISSED) === true;
  } catch {
    return false;
  }
}
