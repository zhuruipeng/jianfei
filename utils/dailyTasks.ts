/**
 * utils/dailyTasks.ts - V12 每日 3 任务 + 特别任务
 *
 * 设计原则：
 *   1) 3 核心任务完成态 —— 直接读取 MealRecord / DailyRecord 的真实数据，
 *      绝不新建第二套打卡状态。
 *   2) 特别任务 —— 用日期哈希稳定选择（同一日期永远同一任务），
 *      绝不使用真正随机数。
 */

import {
  DAILY_TASK_CONFIG,
  DailyTaskKey,
  DailyTaskDef,
  SPECIAL_TASK_POOL,
  SPECIAL_TASK_AMOUNT,
  STORAGE_KEY_SPECIAL_TASK_SKIPPED_PREFIX,
} from '../types/index';
import { getEffectiveExerciseGoal, getEffectiveWaterGoal } from './summary';

import { getTodayString } from './date';

import { loadAllMealRecords } from '../services/mealService';
import { peekRecordForDate } from '../services/dailyService';
import { loadEnergyLedger } from './energy';

// ================================================================
// 每日3任务完成态（读真实数据，不写新状态）
// ================================================================

export interface DailyTaskVM {
  key: DailyTaskKey;
  def: DailyTaskDef;

  completed: boolean;

  /** 展示用：当前进度（数字） */
  current: number;
  /** 展示用：目标值（数字），餐类=1，运动=20，喝水=当日目标 */
  target: number;
  /** 展示用：单位文案（空 / 分钟 / 杯） */
  unitText: string;

  /** 这条任务是否已经发放过能量（来自 energy ledger 防重） */
  energyAwarded: boolean;
  /** 完成这一条给多少能量（固定 20） */
  amount: number;
}

/**
 * 读取某日 3 任务完成态 + 是否发过能量。
 *
 * 注：这里只"计算"，不发能量。
 *   发能量由 companionService.grantEnergyForCompletedDailyTasks() 负责。
 */
export function computeDailyTasksForDate(date: string): DailyTaskVM[] {
  const d = date || getTodayString();

  // 1) 真实数据：当日 MealRecord 数
  const mealsForDate = loadAllMealRecords().filter((m) => m.date === d);
  const hasAnyMeal = mealsForDate.length > 0;

  // 2) 真实数据：当日 DailyRecord（可空）
  const rec = peekRecordForDate(d) || null;
  const exMin = rec ? (typeof rec.exerciseMinutes === 'number' ? rec.exerciseMinutes : 0) : 0;
  const wCups = rec ? (typeof rec.waterCups === 'number' ? rec.waterCups : 0) : 0;
  // 世界、每日任务、积分统一读取同一个计划目标口径，不额外维护“花园运动目标”。
  const exGoal = getEffectiveExerciseGoal(rec);
  const waterGoal = (rec ? getEffectiveWaterGoal(rec) : null) || null;

  // 3) 能量是否已发放：加载 ledger（只看 date+source+sourceId）
  const ledger = loadEnergyLedger();
  function awarded(key: DailyTaskKey): boolean {
    return ledger.some((l) => l.date === d && l.source === 'daily_task' && l.sourceId === key);
  }
  const allCompleteAwarded = ledger.some(
    (l) => l.date === d && l.source === 'daily_all_complete' && l.sourceId === d
  );
  // all_complete_bonus 在单条里不显示，统一在 3 条都完成后额外计算

  const out: DailyTaskVM[] = [];
  for (const def of DAILY_TASK_CONFIG) {
    if (def.key === 'meal_any') {
      out.push({
        key: def.key, def,
        completed: hasAnyMeal,
        current: hasAnyMeal ? 1 : 0,
        target: 1,
        unitText: '',
        energyAwarded: awarded(def.key),
        amount: def.amountPerTask,
      });
    } else if (def.key === 'exercise_min') {
      out.push({
        key: def.key, def,
        completed: exMin >= exGoal,
        current: exMin,
        target: exGoal,
        unitText: '分钟',
        energyAwarded: awarded(def.key),
        amount: def.amountPerTask,
      });
    } else if (def.key === 'water_goal') {
      out.push({
        key: def.key, def,
        completed: waterGoal !== null && wCups >= waterGoal,
        current: wCups,
        target: waterGoal !== null ? waterGoal : 8,
        unitText: '杯',
        energyAwarded: awarded(def.key),
        amount: def.amountPerTask,
      });
    }
  }
  return out;
}

/**
 * 检查"3 任务全完成 -> bonus 20"是否已发过能量（all_complete + date）。
 * 由 companionService 判断是否需要发。
 */
export function isDailyAllCompleteBonusAwarded(date: string): boolean {
  const d = date || getTodayString();
  const ledger = loadEnergyLedger();
  return ledger.some(
    (l) => l.date === d && l.source === 'daily_all_complete' && l.sourceId === d
  );
}

// ================================================================
// 特别任务：日期稳定生成 + 跳过记录
// ================================================================

/**
 * 根据日期稳定选择：
 *   同一天 -> 同一池下标；同一天是否出现 -> 每 7 天有 3~4 天（按 dayOfYear % 7 < 4）
 *   不依赖随机数，保证同一日期关闭再打开都一样。
 */
export function getSpecialTaskForDate(date: string): {
  shown: boolean;              // 今天是否显示（每周 3~4 天）
  text: string;                // 任务文案
  amount: number;              // 30
  index: number;               // 池中 index（供比较，debug 用）
} {
  const d = date || getTodayString();
  const parts = d.split('-').map(Number);
  let y = parts[0] || 0, mo = parts[1] || 1, da = parts[2] || 1;
  if (y < 1970) y = 2026;
  // 简单"今年第几天"算法
  const isLeap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
  const monthDays = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let doy = 0;
  for (let i = 0; i < Math.max(0, mo - 1); i++) doy += monthDays[i];
  doy += da;
  // 是否显示：约每 7 天 4 天有
  const shown = (doy % 7) < 4;
  // 稳定下标
  const idx = ((y * 10000) + (mo * 100) + da) % SPECIAL_TASK_POOL.length;
  const text = SPECIAL_TASK_POOL[idx];
  return { shown, text, amount: SPECIAL_TASK_AMOUNT, index: idx };
}

export function isSpecialTaskSkipped(date: string): boolean {
  const d = date || getTodayString();
  try {
    return !!wx.getStorageSync(STORAGE_KEY_SPECIAL_TASK_SKIPPED_PREFIX + d);
  } catch {
    return false;
  }
}

export function markSpecialTaskSkipped(date: string): void {
  const d = date || getTodayString();
  try {
    wx.setStorageSync(STORAGE_KEY_SPECIAL_TASK_SKIPPED_PREFIX + d, true);
  } catch (e) {
    const err = new Error('跳过失败');
    (err as any).cause = e;
    throw err;
  }
}

/** 特别任务是否已经领取过能量（同一天同 date 只一次） */
export function isSpecialTaskEnergyAwarded(date: string): boolean {
  const d = date || getTodayString();
  const ledger = loadEnergyLedger();
  return ledger.some(
    (l) => l.date === d && l.source === 'special_task' && l.sourceId === d
  );
}
