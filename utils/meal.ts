// utils/meal.ts - 三餐记录统一入口（CRUD + 校验 + 查找 + 旧数据迁移）
import {
  AiStatus,
  DailyRecord,
  MealAnalysis,
  MealRecord,
  MealType,
  MealTagKey,
  SatietyLevel,
  STORAGE_KEY_MEAL_RECORDS,
  STORAGE_KEY_MEAL_MIGRATED_PREFIX,
  STORAGE_PREFIX_DAILY,
  MEAL_FOOD_TEXT_MAX,
  MEAL_NOTE_MAX,
  LEGACY_MEAL_TAG_KEY_MAP,
  MEAL_TAG_LIST,
} from '../types/index';
import { formatDateTimeNow, genLocalId, isSameDayYYYYMMDD } from './date';

// ----------------------------------------------------------------
// 读写 Storage（基础）
// ----------------------------------------------------------------
export function loadMealRecords(): MealRecord[] {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY_MEAL_RECORDS);
    if (!raw) return [];
    const arr: any[] = Array.isArray(raw) ? raw : [];
    const now = formatDateTimeNow();
    const out: MealRecord[] = [];
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const dateStr: string = typeof item.date === 'string' ? item.date : '';
      const mealType: any = item.mealType;
      if (!dateStr || !isSameDayYYYYMMDD(dateStr) === false) {
        // 不是合法日期就跳过（保持兼容、不抛错）
      }
      if (mealType !== 'breakfast' && mealType !== 'lunch' && mealType !== 'dinner') continue;
      // V8：标签 normalize（兼容旧 key has_veg/has_sweets/has_sweet_drink/night_snack → 新 9 key，去重，过滤非法）
      const legalTags = new Set<MealTagKey>(MEAL_TAG_LIST.map(t => t.key));
      const rawTags: any[] = Array.isArray(item.tags) ? item.tags : [];
      const tags: MealTagKey[] = [];
      for (const t of rawTags) {
        if (typeof t !== 'string' || t.length === 0) continue;
        const mapped = LEGACY_MEAL_TAG_KEY_MAP[t] || (legalTags.has(t as MealTagKey) ? (t as MealTagKey) : undefined);
        if (mapped && !tags.includes(mapped)) tags.push(mapped);
      }
      const satietyLevel: SatietyLevel | undefined =
        item.satietyLevel === 'seven_tenths' || item.satietyLevel === 'just_right' ||
        item.satietyLevel === 'a_little_full' || item.satietyLevel === 'overfull'
          ? (item.satietyLevel as SatietyLevel) : undefined;
      const foodText: string | undefined =
        typeof item.foodText === 'string' && item.foodText.length > 0 ? item.foodText : undefined;
      const note: string | undefined =
        typeof item.note === 'string' && item.note.length > 0 ? item.note : undefined;
      const photoPath: string | undefined =
        typeof item.photoPath === 'string' && item.photoPath.length > 0 ? item.photoPath : undefined;
      // V6：云端字段（全部可选；白名单只认合法 aiStatus）
      const cloudImageId: string | undefined =
        typeof item.cloudImageId === 'string' && item.cloudImageId.length > 0 ? item.cloudImageId : undefined;
      const cloudImageUrl: string | undefined =
        typeof item.cloudImageUrl === 'string' && item.cloudImageUrl.length > 0 ? item.cloudImageUrl : undefined;
      const aiStatusRaw: any = item.aiStatus;
      const aiStatus: AiStatus | undefined =
        aiStatusRaw === 'none' || aiStatusRaw === 'uploaded' ||
        aiStatusRaw === 'analyzing' || aiStatusRaw === 'completed' || aiStatusRaw === 'failed'
          ? (aiStatusRaw as AiStatus) : undefined;
      // V7：aiAnalysis（只认合理结构，不合法字段丢弃）
      let aiAnalysis: MealAnalysis | undefined;
      if (item.aiAnalysis && typeof item.aiAnalysis === 'object') {
        const a = item.aiAnalysis as any;
        // 必填白名单校验（不通过直接忽略，不崩）
        const foodsOK = Array.isArray(a.foods) && a.foods.every((x: any) => typeof x === 'string');
        const portionOK = a.portionLevel === 'light' || a.portionLevel === 'appropriate' ||
                          a.portionLevel === 'heavy' || a.portionLevel === 'unknown';
        const vegOK = a.vegetables === 'low' || a.vegetables === 'adequate' || a.vegetables === 'unknown';
        const proOK = a.protein === 'low' || a.protein === 'adequate' || a.protein === 'unknown';
        const staOK = a.stapleFood === 'low' || a.stapleFood === 'adequate' ||
                     a.stapleFood === 'high' || a.stapleFood === 'unknown';
        const sugOK = a.sugaryDrink === 'yes' || a.sugaryDrink === 'no' || a.sugaryDrink === 'unknown';
        const confOK = a.confidence === 'low' || a.confidence === 'medium' || a.confidence === 'high';
        const summaryOK = typeof a.summary === 'string' && a.summary.length <= 400;
        const suggOK = typeof a.primarySuggestion === 'string' && a.primarySuggestion.length <= 200;
        const atOK = typeof a.analyzedAt === 'string' && a.analyzedAt.length <= 40;
        if (foodsOK && portionOK && vegOK && proOK && staOK && sugOK && confOK && summaryOK && suggOK && atOK) {
          aiAnalysis = {
            foods: (a.foods as string[]).slice(0, 40).map(s => s.slice(0, 40)),
            portionLevel: a.portionLevel,
            vegetables: a.vegetables,
            protein: a.protein,
            stapleFood: a.stapleFood,
            sugaryDrink: a.sugaryDrink,
            summary: a.summary.slice(0, 400),
            primarySuggestion: a.primarySuggestion.slice(0, 200),
            confidence: a.confidence,
            analyzedAt: a.analyzedAt.slice(0, 40),
          };
        }
      }
      out.push({
        id: typeof item.id === 'string' && item.id.length > 0 ? item.id : genLocalId(),
        date: dateStr,
        mealType,
        foodText,
        satietyLevel,
        tags,
        note,
        photoPath,
        cloudImageId,
        cloudImageUrl,
        aiStatus,
        aiAnalysis,
        createdAt: typeof item.createdAt === 'string' && item.createdAt.length > 0 ? item.createdAt : now,
        updatedAt: typeof item.updatedAt === 'string' && item.updatedAt.length > 0 ? item.updatedAt : undefined,
        migratedFromLegacy: item.migratedFromLegacy === true ? true : undefined,
      });
    }
    return out;
  } catch (e) {
    return [];
  }
}

export function saveMealRecords(records: MealRecord[]): void {
  try {
    wx.setStorageSync(STORAGE_KEY_MEAL_RECORDS, records);
  } catch (e) {
    // swallow
  }
}

// ----------------------------------------------------------------
// 查询
// ----------------------------------------------------------------
export function findMealRecord(list: MealRecord[], dateStr: string, mealType: MealType): MealRecord | undefined {
  return list.find(r => r.date === dateStr && r.mealType === mealType);
}
export function hasMealRecordOn(list: MealRecord[], dateStr: string, mealType: MealType): boolean {
  return !!findMealRecord(list, dateStr, mealType);
}

/** 给定 date+meal 的 3 个布尔完成态（true=已记录/ false=未记录），用于首页摘要。 */
export function getDailyMealCompletions(list: MealRecord[], dateStr: string) {
  return {
    breakfast: hasMealRecordOn(list, dateStr, 'breakfast'),
    lunch:     hasMealRecordOn(list, dateStr, 'lunch'),
    dinner:    hasMealRecordOn(list, dateStr, 'dinner'),
  };
}

// ----------------------------------------------------------------
// 校验 & 保存
// ----------------------------------------------------------------
export interface MealValidationResult {
  ok: boolean;
  /** 校验失败时的提示（目前食物/备注超出不报错，而是截断） */
  msg: string;
  foodTextFinal?: string;
  noteFinal?: string;
  tagsFinal: MealTagKey[];
}
export function validateMealInput(input: {
  foodText?: string;
  tags?: MealTagKey[];
  note?: string;
  satietyLevel?: SatietyLevel;
}): MealValidationResult {
  // 1. foodText：允许空，超出截断
  const rawFood = (input.foodText ?? '').trim();
  const foodTextFinal: string | undefined = rawFood.length === 0
    ? undefined
    : rawFood.slice(0, MEAL_FOOD_TEXT_MAX);

  // 2. tags：去重 + 合法白名单（9 个新 key），如果是旧 key 也 normalize 过去
  const legalTags = new Set<MealTagKey>(MEAL_TAG_LIST.map(t => t.key));
  const tagsArr = Array.isArray(input.tags) ? input.tags : ([] as MealTagKey[]);
  const set = new Set<MealTagKey>();
  for (const t of tagsArr) {
    const mapped: MealTagKey | undefined = LEGACY_MEAL_TAG_KEY_MAP[t as any] || (legalTags.has(t) ? t : undefined);
    if (mapped) set.add(mapped);
  }
  const tagsFinal: MealTagKey[] = Array.from(set);

  // 3. note：允许空，超出截断
  const rawNote = (input.note ?? '').trim();
  const noteFinal: string | undefined = rawNote.length === 0
    ? undefined
    : rawNote.slice(0, MEAL_NOTE_MAX);

  return { ok: true, msg: '', foodTextFinal, noteFinal, tagsFinal };
}

/**
 * 保存一条 meal 记录。
 * 同一天同一餐只允许 1 条：存在则覆盖（保留 id/createdAt，写 updatedAt）；不存在则新建。
 */
export interface SaveMealResult {
  ok: boolean;
  /** created / updated */
  action: 'created' | 'updated';
  record: MealRecord;
}
export function saveMeal(
  dateStr: string,
  mealType: MealType,
  input: {
    foodText?: string;
    satietyLevel?: SatietyLevel;
    tags?: MealTagKey[];
    note?: string;
    photoPath?: string;
    /** V6：是否显式清除云端 AI 关联（用户换照片、删照片时传 true） */
    clearCloudAiRefs?: boolean;
    /** V6：显式写 cloudImageId（不传 = 保留原值） */
    cloudImageId?: string;
    /** V6：显式写 cloudImageUrl（不传 = 保留原值） */
    cloudImageUrl?: string;
    /** V6/V7：显式写 aiStatus（不传 = 保留原值） */
    aiStatus?: AiStatus;
    /** V7：写 AI 分析结果（不传 = 保留原值；传 undefined + clearAiAnalysis=true 会强制清空） */
    aiAnalysis?: MealAnalysis;
    /** V7：强制清空 aiAnalysis（换图/删图/重新分析前清理） */
    clearAiAnalysis?: boolean;
  }
): SaveMealResult {
  const valid = validateMealInput({
    foodText: input.foodText,
    tags: input.tags,
    note: input.note,
    satietyLevel: input.satietyLevel,
  });
  const list = loadMealRecords();
  const idx = list.findIndex(r => r.date === dateStr && r.mealType === mealType);
  const now = formatDateTimeNow();
  if (idx === -1) {
    const newRec: MealRecord = {
      id: genLocalId(),
      date: dateStr,
      mealType,
      foodText: valid.foodTextFinal,
      satietyLevel: input.satietyLevel,
      tags: valid.tagsFinal,
      note: valid.noteFinal,
      photoPath: input.photoPath,
      cloudImageId: input.clearCloudAiRefs === true ? undefined : input.cloudImageId,
      cloudImageUrl: input.clearCloudAiRefs === true ? undefined : input.cloudImageUrl,
      aiStatus: input.clearCloudAiRefs === true ? undefined : input.aiStatus,
      aiAnalysis: input.clearAiAnalysis === true ? undefined : input.aiAnalysis,
      createdAt: now,
    };
    list.push(newRec);
    saveMealRecords(list);
    return { ok: true, action: 'created', record: newRec };
  } else {
    const old = list[idx];
    // ---- 云端字段 ----
    let nextCloudImageId: string | undefined = old.cloudImageId;
    let nextCloudImageUrl: string | undefined = old.cloudImageUrl;
    let nextAiStatus: AiStatus | undefined = old.aiStatus;
    if (input.clearCloudAiRefs === true) {
      nextCloudImageId = undefined; nextCloudImageUrl = undefined; nextAiStatus = undefined;
    } else {
      if (Object.prototype.hasOwnProperty.call(input, 'cloudImageId')) {
        nextCloudImageId = typeof input.cloudImageId === 'string' && input.cloudImageId.length > 0
          ? input.cloudImageId : undefined;
      }
      if (Object.prototype.hasOwnProperty.call(input, 'cloudImageUrl')) {
        nextCloudImageUrl = typeof input.cloudImageUrl === 'string' && input.cloudImageUrl.length > 0
          ? input.cloudImageUrl : undefined;
      }
      if (Object.prototype.hasOwnProperty.call(input, 'aiStatus')) {
        nextAiStatus = input.aiStatus && input.aiStatus.length > 0 ? input.aiStatus : undefined;
      }
    }
    // ---- AI 分析结果：不传保留原值；clearAiAnalysis=true 强制清空；否则用传入 ----
    let nextAiAnalysis: MealAnalysis | undefined = old.aiAnalysis;
    if (input.clearAiAnalysis === true) {
      nextAiAnalysis = undefined;
    } else if (Object.prototype.hasOwnProperty.call(input, 'aiAnalysis')) {
      nextAiAnalysis = input.aiAnalysis && typeof input.aiAnalysis === 'object'
        ? (input.aiAnalysis as MealAnalysis)
        : undefined;
    }
    const updated: MealRecord = {
      ...old,
      foodText: valid.foodTextFinal,
      satietyLevel: input.satietyLevel,
      tags: valid.tagsFinal,
      note: valid.noteFinal,
      // photoPath：外部传值保存；否则保留旧值；'' 作为清除
      photoPath: typeof input.photoPath === 'string'
        ? (input.photoPath.length > 0 ? input.photoPath : undefined)
        : old.photoPath,
      cloudImageId: nextCloudImageId,
      cloudImageUrl: nextCloudImageUrl,
      aiStatus: nextAiStatus,
      aiAnalysis: nextAiAnalysis,
      updatedAt: now,
    };
    list[idx] = updated;
    saveMealRecords(list);
    return { ok: true, action: 'updated', record: updated };
  }
}

/** 删除一条 meal 记录（按 id）；返回删除成功/失败 */
export function deleteMealRecord(id: string): boolean {
  const list = loadMealRecords();
  const idx = list.findIndex(r => r.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  saveMealRecords(list);
  return true;
}

// ----------------------------------------------------------------
// 兼容：DailyRecord.xxxCompleted=true 且无对应 MealRecord -> 自动迁移
// ----------------------------------------------------------------
/**
 * 针对单个 date，把 DailyRecord.xxxCompleted=true 但没有 MealRecord 的三餐
 * 自动创建迁移记录（空内容，migratedFromLegacy=true）。
 * 每个 date 只迁移一次（靠 meal_migrated_v1_{date} 标记位防止重复）。
 */
export function migrateLegacyCompletedToMealRecords(dateStr: string): void {
  try {
    const flagKey = STORAGE_KEY_MEAL_MIGRATED_PREFIX + dateStr;
    const done: any = wx.getStorageSync(flagKey);
    if (done === 1 || done === true) return;

    const dailyKey = STORAGE_PREFIX_DAILY + dateStr;
    const rawDaily: any = wx.getStorageSync(dailyKey);
    if (!rawDaily || typeof rawDaily !== 'object') {
      // 无当天 DailyRecord，不用迁移，也标记跑过（下次不白查）
      try { wx.setStorageSync(flagKey, 1); } catch (e) { /* ignore */ }
      return;
    }
    const daily: DailyRecord = rawDaily;
    const list = loadMealRecords();
    const mealTypes: { key: MealType; done: boolean }[] = [
      { key: 'breakfast', done: daily.breakfastCompleted === true },
      { key: 'lunch',     done: daily.lunchCompleted === true },
      { key: 'dinner',    done: daily.dinnerCompleted === true },
    ];
    let changed = false;
    const now = formatDateTimeNow();
    for (const mt of mealTypes) {
      if (!mt.done) continue;
      const exist = list.find(r => r.date === dateStr && r.mealType === mt.key);
      if (exist) continue;
      list.push({
        id: genLocalId(),
        date: dateStr,
        mealType: mt.key,
        tags: [],
        createdAt: now,
        migratedFromLegacy: true,
      });
      changed = true;
    }
    if (changed) saveMealRecords(list);
    try { wx.setStorageSync(flagKey, 1); } catch (e) { /* ignore */ }
  } catch (e) {
    // swallow
  }
}

/** 扫描目前所有 daily_record_*，依次跑迁移（首次进首页用，保证历史积分不变）。 */
export function migrateAllLegacyDailyRecords(): void {
  try {
    const info = wx.getStorageInfoSync();
    const keys: string[] = Array.isArray(info && (info as any).keys) ? (info as any).keys : [];
    const dailyKeys = keys.filter(k => k && k.indexOf(STORAGE_PREFIX_DAILY) === 0);
    for (const k of dailyKeys) {
      const dateStr = k.substring(STORAGE_PREFIX_DAILY.length);
      if (!dateStr) continue;
      migrateLegacyCompletedToMealRecords(dateStr);
    }
  } catch (e) {
    // swallow
  }
}
