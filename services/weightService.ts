/**
 * weightService.ts
 * 体重记录的薄封装：统一 save / load / findToday / calcTodayDiff
 *  - 页面不直接 getStorageSync(STORAGE_KEY_WEIGHT_RECORDS)
 */

import {
  WeightRecord,
  STORAGE_KEY_WEIGHT_RECORDS,
  WEIGHT_MIN,
  WEIGHT_MAX,
  WEIGHT_DECIMALS,
  UI_MSG,
} from '../types/index';
import {
  loadWeightRecords as _loadAll,
  saveWeight as _save,
  hasRecordOnDate,
  validateWeightInput,
  calcTodayDiff,
} from '../utils/weight';
import { formatDateToday } from '../utils/date';

export { hasRecordOnDate, calcTodayDiff };

/** 校验输入体重，返回 { ok, weight(kg, 已截断为1位小数), msg } */
export function validateWeight(weightRaw: number | string) {
  const rawStr = typeof weightRaw === 'number' ? String(weightRaw) : weightRaw;
  return validateWeightInput(rawStr);
}

/** 所有体重记录（按日期倒序） */
export function loadAllWeightRecords(): WeightRecord[] {
  return _loadAll();
}

/** 今日体重（不存在返回 null） */
export function findTodayRecord(): WeightRecord | null {
  const today = formatDateToday();
  const list = _loadAll();
  for (const r of list) if (r.date === today) return r;
  return null;
}

/**
 * 保存体重（同一天覆盖更新）
 *  - 入参 date 可选（缺省=今天），由 utils/weight.saveWeight 内部兜底
 *  - Storage 出错统一抛 UI_MSG.STORAGE_SAVE_FAIL
 *  - 返回保存后的 WeightRecord（与 utils 的 SaveWeightResult 拆包）
 */
export function saveWeight(weightKg: number, date?: string): WeightRecord {
  try {
    const result = _save(weightKg, date && date.length > 0 ? date : formatDateToday());
    if (!result.ok || !result.record) {
      throw new Error(result.error || UI_MSG.STORAGE_SAVE_FAIL);
    }
    return result.record;
  } catch (e) {
    const err = new Error(UI_MSG.STORAGE_SAVE_FAIL);
    (err as any).cause = e;
    throw err;
  }
}
