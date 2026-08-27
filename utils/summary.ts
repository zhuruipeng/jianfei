// utils/summary.ts - 动态计算积分与完成度
// 重点：三餐完成态现在以 MealRecord（当天存在对应记录）为权威。
// 为了兼容旧用户，所有 summary 入口在计算前会先对该 date 跑迁移。
// V10：运动/喝水目标改为 effective goal（snapshot → active plan → 常量 回退），不破坏历史判定。
import {
  type DailyRecord,
  type TaskKey,
  type DailySummary,
  type MealRecord,
  STORAGE_PREFIX_DAILY,
  EXERCISE_TARGET_MINUTES,
  WATER_TARGET_CUPS,
  REWARD,
  TOTAL_TASKS
} from '../types/index';
import {
  hasMealRecordOn,
  loadMealRecords,
  migrateLegacyCompletedToMealRecords,
} from './meal';
import { ensureTodayRecord } from './storage';
import { getTodayString } from './date';
import { loadActivePlan } from './plan';

/** Re-export：旧数据迁移工具，services 层直接从 summary 拿 */
export { migrateLegacyCompletedToMealRecords };

/**
 * 获取指定日期的 DailyRecord（不存在则创建并保存一份空白）。
 *  - 同时保证该 date 的 legacy xxxCompleted -> MealRecord 迁移已跑过。
 *  - services 层"权威获取 daily record"入口（不直接调用 utils/storage）。
 */
export function ensureDailyRecordForDate(date?: string): DailyRecord {
  const dateStr = (date && date.length > 0) ? date : getTodayString();
  migrateLegacyCompletedToMealRecords(dateStr);
  return ensureTodayRecord(dateStr);
}

/**
 * 只读读取指定日期的 DailyRecord（不存在返回 null，**不**自动创建）。
 *  - 用于"今天是否已有 X 字段"等不希望副作用产生 Storage 写入的场景。
 *  - V10：兼容透传 snapshot 字段
 */
export function loadAnyDailyRecordForDate(date: string): DailyRecord | null {
  try {
    const val = wx.getStorageSync(STORAGE_PREFIX_DAILY + date);
    if (!val) return null;
    const raw = val as Partial<DailyRecord>;
    return {
      date,
      breakfastCompleted: !!raw.breakfastCompleted,
      lunchCompleted: !!raw.lunchCompleted,
      dinnerCompleted: !!raw.dinnerCompleted,
      exerciseMinutes: typeof raw.exerciseMinutes === 'number' ? Math.max(0, raw.exerciseMinutes) : 0,
      waterCups: typeof raw.waterCups === 'number' ? Math.max(0, raw.waterCups) : 0,
      exerciseGoalMinutesSnapshot: typeof raw.exerciseGoalMinutesSnapshot === 'number' && raw.exerciseGoalMinutesSnapshot > 0
        ? raw.exerciseGoalMinutesSnapshot : undefined,
      waterGoalCupsSnapshot: typeof raw.waterGoalCupsSnapshot === 'number' && raw.waterGoalCupsSnapshot > 0
        ? raw.waterGoalCupsSnapshot : undefined,
    };
  } catch (e) {
    return null;
  }
}

// =========================================================================
// V10：effective goal（运动/喝水目标动态化，带历史 snapshot 防漂移）
// =========================================================================

/**
 * 解析当日 effective 运动目标（分钟）。
 * 回退链路（保证历史不漂移、旧用户行为不变）：
 *   1. record.exerciseGoalMinutesSnapshot 是 number 且 > 0 → 返回之（历史日冻结值）
 *   2. 否则 loadActivePlan()?.exerciseGoalMinutes > 0 → 返回之（当前计划目标）
 *   3. 否则 EXERCISE_TARGET_MINUTES (=30)（兜底常量，旧用户行为不变）
 */
export function getEffectiveExerciseGoal(record: DailyRecord | null | undefined): number {
  if (record && typeof record.exerciseGoalMinutesSnapshot === 'number' && record.exerciseGoalMinutesSnapshot > 0) {
    return record.exerciseGoalMinutesSnapshot;
  }
  try {
    const plan = loadActivePlan();
    if (plan && typeof plan.exerciseGoalMinutes === 'number' && plan.exerciseGoalMinutes > 0) {
      return plan.exerciseGoalMinutes;
    }
  } catch { /* ignore */ }
  return EXERCISE_TARGET_MINUTES;
}

/**
 * 解析当日 effective 喝水目标（杯）。回退链路同上。
 */
export function getEffectiveWaterGoal(record: DailyRecord | null | undefined): number {
  if (record && typeof record.waterGoalCupsSnapshot === 'number' && record.waterGoalCupsSnapshot > 0) {
    return record.waterGoalCupsSnapshot;
  }
  try {
    const plan = loadActivePlan();
    if (plan && typeof plan.waterGoalCups === 'number' && plan.waterGoalCups > 0) {
      return plan.waterGoalCups;
    }
  } catch { /* ignore */ }
  return WATER_TARGET_CUPS;
}

/**
 * 计算并返回某条 DailyRecord 的"已完成任务"清单。
 *  - 返回对象形式（便于未来扩展，例如同时返回未完成清单）。
 *  - pointsService 用 ReturnType<typeof calculateTaskListForRecord>['completed'] 派生类型。
 */
export function calculateTaskListForRecord(record: DailyRecord): { completed: TaskKey[] } {
  return { completed: getCompletedTasks(record) };
}

/** 获取某个日期的 MealRecord 列表（同时保证：若有旧 DailyRecord xxxCompleted=true，已经迁移过来） */
export function getMealRecordsForDate(dateStr: string): MealRecord[] {
  migrateLegacyCompletedToMealRecords(dateStr);
  return loadMealRecords();
}

/**
 * 判断单个任务是否完成。
 * 三餐：以 MealRecord 是否存在为唯一标准；迁移已经在 getMealRecordsForDate 内执行，
 *      所以旧 xxxCompleted=true 会先产生迁移 MealRecord，因此结果不会变、历史积分不丢。
 * V10：运动/喝水改为 effective goal（snapshot → plan → 常量 回退）
 */
export function isTaskCompleted(
  record: DailyRecord,
  task: TaskKey,
  mealRecordsForDateCached?: MealRecord[]
): boolean {
  switch (task) {
    case 'breakfast':
    case 'lunch':
    case 'dinner': {
      const list = mealRecordsForDateCached
        ? mealRecordsForDateCached
        : getMealRecordsForDate(record.date);
      return hasMealRecordOn(list, record.date, task);
    }
    case 'exercise': return record.exerciseMinutes >= getEffectiveExerciseGoal(record);
    case 'water':     return record.waterCups >= getEffectiveWaterGoal(record);
  }
}

/**
 * 列出所有完成的任务（一次拿到 list 缓存，避免重复读 Storage）
 */
export function getCompletedTasks(record: DailyRecord): TaskKey[] {
  const mealList = getMealRecordsForDate(record.date);
  const all: TaskKey[] = ['breakfast', 'lunch', 'dinner', 'exercise', 'water'];
  return all.filter(k => isTaskCompleted(record, k, mealList));
}

/**
 * 计算今日积分（严格按每个任务"已完成"布尔值计一次）
 */
export function calculatePoints(record: DailyRecord): number {
  const mealList = getMealRecordsForDate(record.date);
  let points = 0;
  if (isTaskCompleted(record, 'breakfast', mealList)) points += REWARD.BREAKFAST;
  if (isTaskCompleted(record, 'lunch',     mealList)) points += REWARD.LUNCH;
  if (isTaskCompleted(record, 'dinner',    mealList)) points += REWARD.DINNER;
  if (isTaskCompleted(record, 'exercise',  mealList)) points += REWARD.EXERCISE;
  if (isTaskCompleted(record, 'water',     mealList)) points += REWARD.WATER;
  return points;
}

/**
 * 计算完成度百分比（0~100），基于 5 个总任务
 */
export function calculateCompletionPercent(record: DailyRecord): number {
  const completed = getCompletedTasks(record).length;
  return Math.round((completed / TOTAL_TASKS) * 100);
}

/**
 * 汇总所有派生字段
 */
export function getDailySummary(record: DailyRecord): DailySummary {
  return {
    points: calculatePoints(record),
    completionPercent: calculateCompletionPercent(record),
    completedTasks: getCompletedTasks(record)
  };
}
