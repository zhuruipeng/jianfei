/**
 * dailyService.ts
 * DailyRecord 数据的薄封装：页面不直接调用 wx.setStorageSync('daily_record_*')
 *  - 所有 DailyRecord 修改经过这里，保证 save / ensureToday 一致。
 *  - 不重写 utils/storage.ts 的工作逻辑。
 *
 * 【V10 计划快照】ensure*WithSnapshot 系列在 plan 存在时写入当日目标 snapshot。
 *  - 无 plan：no-op，旧用户行为不变。
 *  - 已有 snapshot：no-op，不覆盖历史。
 *  - 失败：warn 但不抛错，不阻断主流程。
 */

import { DailyRecord, UI_MSG } from '../types/index';
import { ensureTodayRecord, saveDailyRecord as _saveDaily } from '../utils/storage';
import { ensureDailyRecordForDate, loadAnyDailyRecordForDate } from '../utils/summary';
import { writeSnapshotIfMissing } from './planService';

/** 获取今天的 DailyRecord（没有就创建空的，不写失败抛错） */
export function getTodayRecord(): DailyRecord {
  return ensureTodayRecordWithSnapshot();
}

/** 获取指定日期的 DailyRecord（没有就创建空的） */
export function getRecordForDate(date: string): DailyRecord {
  return ensureRecordForDateWithSnapshot(date);
}

/** 只读读取指定日期（不存在返回 null，不自动创建） */
export function peekRecordForDate(date: string): DailyRecord | null {
  return loadAnyDailyRecordForDate(date);
}

/**
 * 修改并保存 DailyRecord。
 *  @param date 目标日期（默认今天）
 *  @param updater 函数式修改：返回新 record（也可直接原地改并返回同一个对象）
 *  @returns 保存后的 record；失败抛错，调用方转 UI_MSG
 */
export function updateDailyRecord(
  date?: string,
  updater?: (old: DailyRecord) => DailyRecord,
): DailyRecord {
  const old: DailyRecord = date ? ensureRecordForDateWithSnapshot(date) : ensureTodayRecordWithSnapshot();
  const next: DailyRecord = typeof updater === 'function' ? updater(old) : old;
  try {
    _saveDaily(next);
  } catch (e) {
    // 统一抛给上层的友好文案，避免 wx storage 的错暴露给用户
    const err = new Error(UI_MSG.STORAGE_SAVE_FAIL);
    (err as any).cause = e;
    throw err;
  }
  return next;
}

/**
 * 【V10】获取今天的 DailyRecord，并在 plan 存在时写入当日目标 snapshot。
 *  - 不抛错（snapshot 失败仅 warn）。
 *  - 没有 plan 时等同于 ensureTodayRecord。
 */
export function ensureTodayRecordWithSnapshot(): DailyRecord {
  const rec = ensureTodayRecord();
  // 同步 snapshot：仅当日（plan 不存在或已写入时 no-op）
  try {
    writeSnapshotIfMissing(rec.date);
  } catch (e) {
    console.warn('[dailyService] writeSnapshotIfMissing(today) failed', e);
  }
  // 重新读取，确保拿到带 snapshot 的最新版本
  return loadAnyDailyRecordForDate(rec.date) || rec;
}

/**
 * 【V10】获取指定日期的 DailyRecord，并在 plan 存在时写入当日目标 snapshot。
 *  - 注意：仅在当日 record 已经存在或刚被创建时写 snapshot；历史日若不存在不主动补建（避免污染历史）
 *  - 实际策略：先 ensureDailyRecordForDate 创建空白 record（如果不存在），再 writeSnapshotIfMissing
 */
export function ensureRecordForDateWithSnapshot(date: string): DailyRecord {
  const rec = ensureDailyRecordForDate(date);
  try {
    writeSnapshotIfMissing(date);
  } catch (e) {
    console.warn('[dailyService] writeSnapshotIfMissing(date) failed', date, e);
  }
  return loadAnyDailyRecordForDate(date) || rec;
}
