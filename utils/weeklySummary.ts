// utils/weeklySummary.ts - WeeklySummary 低级 CRUD + 派生计算
//
// 【V10 规则】
//  - 按自然 7 天区间生成（Day1-7=Week1, Day8-14=Week2, ...）
//  - 一旦生成即冻结（快照）：用户后来修改历史记录不影响已生成的 summary（需求三十三条）
//  - 数据从 MealRecord/DailyRecord/WeightRecord/UsageEvent 动态计算，不维护第二套累计（需求十七条）
//  - 90 天 plan 共 12 周 + 6 天尾段；尾段不生成 WeeklySummary（由 planSummary 单独处理）
//
// 分层约束：本文件只 import types/ 与 utils/；不 import services/
//  → usage events 通过 wx.getStorageSync(STORAGE_KEY_USAGE_EVENTS) 直接读，不依赖 usageService

import {
  UserPlan,
  WeeklySummary,
  UsageEvent,
  USAGE_EVENT_NAMES,
  STORAGE_KEY_WEEKLY_SUMMARIES,
  STORAGE_PREFIX_WEEKLY_VIEWED,
  STORAGE_KEY_USAGE_EVENTS,
  STORAGE_PREFIX_DAILY,
  MealType,
} from '../types/index';
import { formatDateTimeNow, genLocalId, formatDateYYYYMMDD } from './date';
import { loadMealRecords } from './meal';
import { loadWeightRecords, sortWeightRecordsByDateAsc } from './weight';
import { calculatePoints, getEffectiveExerciseGoal, getEffectiveWaterGoal } from './summary';

// =========================================================================
// 一、周区间与总周数
// =========================================================================

/** 解析 YYYY-MM-DD 为本地 Date（中午 12 点避免时区） */
function parseDateLocal(dateStr: string): Date {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return new Date(NaN);
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  return new Date(y, m, d, 12, 0, 0, 0);
}

function addDays(dateStr: string, days: number): string {
  const d = parseDateLocal(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  d.setDate(d.getDate() + days);
  return formatDateYYYYMMDD(d);
}

/**
 * 计算某周自然区间 [start, end]（YYYY-MM-DD）
 *  - Week1: startDate ~ startDate+6
 *  - Week2: startDate+7 ~ startDate+13
 *  - 越界（weekNumber 超出 plan 总周数）返回 null
 */
export function buildWeekRange(plan: UserPlan, weekNumber: number): { startDate: string; endDate: string } | null {
  if (!plan || weekNumber < 1) return null;
  const totalWeeks = getPlanWeekCount(plan);
  if (weekNumber > totalWeeks) return null;
  const start = addDays(plan.startDate, (weekNumber - 1) * 7);
  const end = addDays(start, 6);
  return { startDate: start, endDate: end };
}

/** 计划总周数（28→4；90→12；7→1） */
export function getPlanWeekCount(plan: UserPlan): number {
  if (!plan) return 0;
  return Math.floor(plan.durationDays / 7);
}

/** 给定某 planDay（1-based），返回"该天属于第几周"（1-based）；planDay 越界返回总周数 */
export function getWeekNumberOfPlanDay(plan: UserPlan, planDay: number): number {
  if (!plan || planDay < 1) return 1;
  return Math.min(getPlanWeekCount(plan), Math.floor((planDay - 1) / 7) + 1);
}

// =========================================================================
// 二、CRUD
// =========================================================================

export function loadAllWeeklySummaries(): WeeklySummary[] {
  try {
    const v = wx.getStorageSync(STORAGE_KEY_WEEKLY_SUMMARIES);
    if (!Array.isArray(v)) return [];
    return v.filter((s: any) =>
      s && typeof s === 'object' &&
      typeof s.id === 'string' && s.id.length > 0 &&
      typeof s.planId === 'string' && s.planId.length > 0 &&
      typeof s.weekNumber === 'number'
    );
  } catch (e) {
    console.error('[WeeklySummary] loadAll failed', e);
    return [];
  }
}

export function saveWeeklySummaries(arr: WeeklySummary[]): boolean {
  try {
    wx.setStorageSync(STORAGE_KEY_WEEKLY_SUMMARIES, arr);
    return true;
  } catch (e) {
    console.error('[WeeklySummary] saveAll failed', e);
    return false;
  }
}

export function findWeeklySummary(planId: string, weekNumber: number): WeeklySummary | undefined {
  if (!planId || weekNumber < 1) return undefined;
  return loadAllWeeklySummaries().find(s => s.planId === planId && s.weekNumber === weekNumber);
}

/** 覆盖 upsert（按 planId+weekNumber 唯一） */
export function upsertWeeklySummary(summary: WeeklySummary): boolean {
  if (!summary || !summary.planId || summary.weekNumber < 1) return false;
  const list = loadAllWeeklySummaries();
  const idx = list.findIndex(s => s.planId === summary.planId && s.weekNumber === summary.weekNumber);
  if (idx >= 0) {
    list[idx] = summary;
  } else {
    list.push(summary);
  }
  return saveWeeklySummaries(list);
}

// =========================================================================
// 三、viewed 标记
// =========================================================================

function viewedKey(planId: string, weekNumber: number): string {
  return `${STORAGE_PREFIX_WEEKLY_VIEWED}${planId}_${weekNumber}`;
}

export function markWeeklySummaryViewed(planId: string, weekNumber: number): void {
  try {
    if (!planId || weekNumber < 1) return;
    wx.setStorageSync(viewedKey(planId, weekNumber), true);
  } catch { /* ignore */ }
}

export function isWeeklySummaryViewed(planId: string, weekNumber: number): boolean {
  try {
    if (!planId || weekNumber < 1) return false;
    return wx.getStorageSync(viewedKey(planId, weekNumber)) === true;
  } catch {
    return false;
  }
}

/**
 * 找到"已生成但未查看的"最大周号（<= maxWeekNumber）。
 * 用于首页"第 N 周完成了"入口。
 */
export function findNextUnviewedWeek(planId: string, maxWeekNumber: number): { weekNumber: number; summary: WeeklySummary } | null {
  if (!planId || maxWeekNumber < 1) return null;
  const list = loadAllWeeklySummaries().filter(s => s.planId === planId && s.weekNumber <= maxWeekNumber);
  // 按 weekNumber 降序找第一个未 viewed
  list.sort((a, b) => b.weekNumber - a.weekNumber);
  for (const s of list) {
    if (!isWeeklySummaryViewed(planId, s.weekNumber)) {
      return { weekNumber: s.weekNumber, summary: s };
    }
  }
  return null;
}

// =========================================================================
// 四、动态计算（从原始数据派生，永远重算）
// =========================================================================

/** 读取 usage events（不依赖 services/usageService，避免分层违规） */
function loadUsageEventsRaw(): UsageEvent[] {
  try {
    const v = wx.getStorageSync(STORAGE_KEY_USAGE_EVENTS);
    if (!Array.isArray(v)) return [];
    return v.filter((e: any) =>
      e && typeof e === 'object' &&
      typeof e.eventName === 'string' &&
      typeof e.date === 'string'
    );
  } catch {
    return [];
  }
}

/** 列出某区间 [start, end] 内的所有日期（YYYY-MM-DD，含首尾） */
function listDatesInRange(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let cur = startDate;
  let guard = 0;
  while (cur <= endDate && guard < 400) {
    out.push(cur);
    if (cur === endDate) break;
    cur = addDays(cur, 1);
    guard++;
  }
  return out;
}

/**
 * 从原始数据动态计算某周 summary（不读已存 summary，永远重算）
 * 适用于首次生成 / dev 重建场景。
 */
export function computeWeeklySummary(plan: UserPlan, weekNumber: number): WeeklySummary | null {
  const range = buildWeekRange(plan, weekNumber);
  if (!range) return null;
  const { startDate, endDate } = range;

  // 1. MealRecord：按 date∈区间 + mealType 分组计数
  const meals = loadMealRecords();
  const mealsInRange = meals.filter(m => m.date >= startDate && m.date <= endDate);
  const mealCount = mealsInRange.length;
  let breakfastCount = 0, lunchCount = 0, dinnerCount = 0;
  for (const m of mealsInRange) {
    const mt = m.mealType as MealType;
    if (mt === 'breakfast') breakfastCount++;
    else if (mt === 'lunch') lunchCount++;
    else if (mt === 'dinner') dinnerCount++;
  }

  // 2. DailyRecord：遍历区间日期，按 snapshot 判定运动/喝水达标；累计 pointsEarned
  const dates = listDatesInRange(startDate, endDate);
  let exerciseGoalDays = 0;
  let waterGoalDays = 0;
  let pointsEarned = 0;
  for (const d of dates) {
    let rec: any = null;
    try {
      rec = wx.getStorageSync(STORAGE_PREFIX_DAILY + d);
    } catch { /* ignore */ }
    if (!rec) continue;
    const exMin = typeof rec.exerciseMinutes === 'number' ? rec.exerciseMinutes : 0;
    const wCups = typeof rec.waterCups === 'number' ? rec.waterCups : 0;
    const exGoal = getEffectiveExerciseGoal(rec);
    const wGoal = getEffectiveWaterGoal(rec);
    if (exMin >= exGoal) exerciseGoalDays++;
    if (wCups >= wGoal) waterGoalDays++;
    // pointsEarned：复用 calculatePoints（三餐需 MealRecord 已计入）
    //   构造临时 DailyRecord 传给 calculatePoints
    try {
      pointsEarned += calculatePoints({
        date: d,
        breakfastCompleted: !!rec.breakfastCompleted,
        lunchCompleted: !!rec.lunchCompleted,
        dinnerCompleted: !!rec.dinnerCompleted,
        exerciseMinutes: exMin,
        waterCups: wCups,
        exerciseGoalMinutesSnapshot: typeof rec.exerciseGoalMinutesSnapshot === 'number' ? rec.exerciseGoalMinutesSnapshot : undefined,
        waterGoalCupsSnapshot: typeof rec.waterGoalCupsSnapshot === 'number' ? rec.waterGoalCupsSnapshot : undefined,
      });
    } catch { /* ignore single day */ }
  }

  // 3. WeightRecord：区间内按日期升序取首末
  const weights = loadWeightRecords();
  const weightsInRange = sortWeightRecordsByDateAsc(
    weights.filter(w => w.date >= startDate && w.date <= endDate)
  );
  let weightStart: number | undefined;
  let weightEnd: number | undefined;
  let weightChange: number | undefined;
  if (weightsInRange.length >= 1) {
    weightStart = weightsInRange[0].weight;
    weightEnd = weightsInRange[weightsInRange.length - 1].weight;
  }
  if (weightsInRange.length >= 2) {
    weightChange = Number((weightEnd! - weightStart!).toFixed(1));
  }

  // 4. UsageEvent：按区间统计 activeDays / meaningfulDays / rewardsUnlocked / rewardsRedeemed / aiAnalysisCount
  const events = loadUsageEventsRaw();
  const eventsInRange = events.filter(e => e.date >= startDate && e.date <= endDate);

  // activeDays：当周有 APP_OPEN 的 unique date 数
  const activeDates = new Set<string>();
  // meaningfulDates：当周有 meal_created / exercise_saved / water_goal_reached / weight_saved 任一事件的 unique date
  const meaningfulDates = new Set<string>();
  let rewardsUnlocked = 0;
  let rewardsRedeemed = 0;
  let aiAnalysisCount = 0;
  for (const ev of eventsInRange) {
    switch (ev.eventName) {
      case USAGE_EVENT_NAMES.APP_OPEN:
      case USAGE_EVENT_NAMES.APP_FIRST_OPEN:
        activeDates.add(ev.date);
        break;
      case USAGE_EVENT_NAMES.MEAL_CREATED:
      case USAGE_EVENT_NAMES.EXERCISE_SAVED:
      case USAGE_EVENT_NAMES.WATER_GOAL_REACHED:
      case USAGE_EVENT_NAMES.WEIGHT_SAVED:
        meaningfulDates.add(ev.date);
        break;
      case USAGE_EVENT_NAMES.REWARD_UNLOCKED:
        rewardsUnlocked++;
        break;
      case USAGE_EVENT_NAMES.REWARD_REDEEMED:
        rewardsRedeemed++;
        break;
      case USAGE_EVENT_NAMES.AI_ANALYSIS_SUCCEEDED:
        aiAnalysisCount++;
        break;
      default:
        break;
    }
  }

  return {
    id: `ws_${genLocalId().slice(2)}`,  // ws_ 前缀区分
    planId: plan.id,
    weekNumber,
    startDate,
    endDate,
    activeDays: activeDates.size,
    meaningfulDays: meaningfulDates.size,
    mealCount,
    breakfastCount,
    lunchCount,
    dinnerCount,
    exerciseGoalDays,
    waterGoalDays,
    weightStart,
    weightEnd,
    weightChange,
    pointsEarned,
    rewardsUnlocked,
    rewardsRedeemed,
    aiAnalysisCount,
    createdAt: formatDateTimeNow(),
  };
}

/**
 * 幂等：若已存在直接返回；否则 compute + upsert + 返回。
 *  - 一旦生成即冻结：后续修改历史数据不会影响已存 summary
 *  - 返回 null 表示 plan 不存在或周号越界
 */
export function ensureWeeklySummaryForWeek(plan: UserPlan, weekNumber: number): WeeklySummary | null {
  if (!plan || weekNumber < 1) return null;
  if (weekNumber > getPlanWeekCount(plan)) return null;
  const existing = findWeeklySummary(plan.id, weekNumber);
  if (existing) return existing;
  const fresh = computeWeeklySummary(plan, weekNumber);
  if (!fresh) return null;
  upsertWeeklySummary(fresh);
  return fresh;
}
