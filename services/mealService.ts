/**
 * mealService.ts
 * MealRecord 的薄封装 + 便捷查找。
 *  - 页面不直接调用 wx.setStorageSync(STORAGE_KEY_MEAL_RECORDS)。
 *  - 不重写 utils/meal.ts，仅包一层常用场景。
 */

import {
  MealRecord,
  MealType,
  MEAL_FOOD_TEXT_MAX,
  MEAL_NOTE_MAX,
  UI_MSG,
} from '../types/index';
import {
  loadMealRecords as _loadAll,
  saveMeal as _saveMeal,
  deleteMealRecord as _delete,
  SaveMealResult,
  validateMealInput,
  hasMealRecordOn,
} from '../utils/meal';
import { deletePhotoFile as _deletePhotoFile } from '../utils/image';
import { ensureRecordForDateWithSnapshot } from './dailyService';

/** 读所有 MealRecord（已 normalize tags + 兼容旧 key） */
export function loadAllMealRecords(): MealRecord[] {
  return _loadAll();
}

/** 拿今天的某一餐 MealRecord，不存在返回 null（用于首页 3 行摘要 / 餐次页预填） */
export function findMealByDateAndType(date: string, mealType: MealType): MealRecord | null {
  // V10：通过 snapshot-aware ensure，保证当日 record 在 plan 存在时写入目标快照
  ensureRecordForDateWithSnapshot(date);
  const list = _loadAll();
  for (const m of list) {
    if (m.date === date && m.mealType === mealType) return m;
  }
  return null;
}

/** 指定日期+餐次是否有记录（权威判断：三餐完成态唯一来源 = MealRecord） */
export function isMealRecorded(date: string, mealType: MealType): boolean {
  ensureRecordForDateWithSnapshot(date);
  return hasMealRecordOn(_loadAll(), date, mealType);
}

/**
 * 保存一餐（不重写逻辑，只把 Storage 抛错统一转成 UI_MSG.STORAGE_SAVE_FAIL）
 * - 兼容逻辑：存完后若 dailyRecord 的 legacy completed 字段不同步再跑一次 migrate（兜底）
 */
export function saveMealRecord(input: Partial<MealRecord> & { date: string; mealType: MealType }): Omit<SaveMealResult, 'record'> & { record: MealRecord | null } {
  let result: SaveMealResult;
  try {
    result = _saveMeal(input.date, input.mealType, {
      foodText: input.foodText,
      satietyLevel: input.satietyLevel,
      tags: input.tags,
      note: input.note,
      photoPath: input.photoPath,
      cloudImageId: input.cloudImageId,
      cloudImageUrl: input.cloudImageUrl,
      aiStatus: input.aiStatus,
      aiAnalysis: input.aiAnalysis,
      clearCloudAiRefs: input.cloudImageId === undefined ? undefined : false,
      clearAiAnalysis: input.aiAnalysis === undefined ? undefined : false,
    });
  } catch (e) {
    const err = new Error(UI_MSG.STORAGE_SAVE_FAIL);
    (err as any).cause = e;
    throw err;
  }
  // 保证 DailyRecord.date 存在 & 旧数据迁移已跑（V10：通过 snapshot-aware ensure 写入当日目标快照）
  ensureRecordForDateWithSnapshot(input.date);
  const record = findMealByDateAndType(input.date, input.mealType);
  return { ok: result.ok, action: result.action, record };
}

/**
 * 删除整顿饭 + 本地照片 + 云端图片 + AI 关联 联动清理（utils/meal.ts 已负责 cloud.uploadFile/mealRecord 绑定字段）
 * - 如果删图失败，**不能阻止**用户删 MealRecord（V8 规则 10）
 *   返回 deletePhotoFailed 给 UI 做弱提示。
 */
export function deleteMealRecordById(id: string): { ok: boolean; deletePhotoFailed: boolean; recordDeleted: boolean } {
  // 先查出该记录的 photoPath，删除记录前先尝试删本地照片（失败不阻止删除记录）
  const list = _loadAll();
  const target = list.find(r => r.id === id);
  let deletePhotoFailed = false;
  if (target && target.photoPath) {
    try {
      const photoOk = _deletePhotoFile(target.photoPath);
      deletePhotoFailed = !photoOk;
    } catch {
      deletePhotoFailed = true;
    }
  }
  // _delete 内部只操作 Storage（已 splice 并 saveMealRecords），不会抛错
  const deleted: boolean = _delete(id);
  return {
    ok: deleted,
    deletePhotoFailed,
    recordDeleted: deleted,
  };
}

/** 快捷：创建餐次页初始化用的空输入（已过校验：foodText/tags 白名单 + 超长截断） */
export function normalizeMealInput(input: {
  foodText?: string;
  tags?: any[];
  note?: string;
  satietyLevel?: any;
}) {
  return validateMealInput({
    foodText: typeof input.foodText === 'string' ? input.foodText : '',
    tags: Array.isArray(input.tags) ? input.tags : [],
    note: typeof input.note === 'string' ? input.note : '',
    satietyLevel: input.satietyLevel,
  });
}

export { MEAL_FOOD_TEXT_MAX, MEAL_NOTE_MAX };
