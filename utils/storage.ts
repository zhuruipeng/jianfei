// utils/storage.ts - 本地存储工具（每日记录）

import {
  type DailyRecord,
  STORAGE_PREFIX_DAILY
} from '../types/index';
import { getTodayString } from './date';

/**
 * 创建一个空白的当日记录（默认值）
 *  - V10：不显式填 exerciseGoalMinutesSnapshot / waterGoalCupsSnapshot（保持 undefined）
 *    snapshot 由 services/dailyService.ensureRecordForDateWithSnapshot 在 plan 存在时写入
 */
export function createEmptyDailyRecord(date: string): DailyRecord {
  return {
    date,
    breakfastCompleted: false,
    lunchCompleted: false,
    dinnerCompleted: false,
    exerciseMinutes: 0,
    waterCups: 0
  };
}

function keyOf(date: string): string {
  return `${STORAGE_PREFIX_DAILY}${date}`;
}

/**
 * 读取指定日期的记录。
 * - 若不存在则返回空记录（但**不写入** Storage，避免空日期被写入）
 * - V10：兼容透传 exerciseGoalMinutesSnapshot / waterGoalCupsSnapshot（旧 record 无字段也安全）
 */
export function getDailyRecord(date: string): DailyRecord {
  try {
    const val = wx.getStorageSync(keyOf(date));
    if (val) {
      // 兼容字段缺失
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
    }
  } catch (e) {
    console.error('[Storage] getDailyRecord failed', date, e);
  }
  return createEmptyDailyRecord(date);
}

/**
 * 保存指定日期记录。
 * - 返回成功/失败
 */
export function saveDailyRecord(record: DailyRecord): boolean {
  try {
    wx.setStorageSync(keyOf(record.date), record);
    return true;
  } catch (e) {
    console.error('[Storage] saveDailyRecord failed', record.date, e);
    return false;
  }
}

/**
 * 读取或初始化当日记录：
 * 若当日没记录则**先创建并保存**一份空白记录，保证后续的部分字段更新不会丢失整个日期。
 *  - V9-fix：today 参数可选，缺省时取今天（services 层经常不传日期）
 */
export function ensureTodayRecord(today?: string): DailyRecord {
  const dateStr = (today && today.length > 0) ? today : getTodayString();
  const existing = getDailyRecord(dateStr);
  // 若 Storage 里有返回的数据，则必然是有记录的（getDailyRecord 会返回空值但不存）
  // 这里显式写回一次空记录，保证记录存在。
  try {
    wx.setStorageSync(keyOf(dateStr), existing);
  } catch (e) {
    console.error('[Storage] ensureTodayRecord write failed', e);
  }
  return existing;
}
