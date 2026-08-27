/**
 * usageService.ts  V9：最小本地行为统计（7 天真实用户测试使用）
 *
 * 数据最小化原则：
 *  - 永远不记录：食物内容 / 真实体重数值 / 奖励名称 / 用户照片 / 个人身份信息（姓名/手机/头像/微信昵称等）
 *  - 只记录：事件 + 日期 + 必要的派生数字/布尔/枚举 metadata
 */

import {
  UsageEvent,
  UsageEventName,
  UsageEventMetadata,
  USAGE_EVENT_NAMES,
  STORAGE_KEY_USAGE_EVENTS,
  STORAGE_KEY_USAGE_FIRST_OPEN_DONE,
  STORAGE_KEY_WATER_GOAL_REACHED_BY_DATE,
  MealType,
  EXERCISE_TARGET_MINUTES,
} from '../types/index';
import { getTodayString, daysBetweenInclusive } from '../utils/date';

function toISOTimestampString(d: Date): string {
  // 直接输出 "YYYY-MM-DDTHH:mm:ss.SSSZ" 兼容小程序 JSON.parse；不使用 toISOString（因微信小程序部分环境 toISOString 有时区差异）
  function pad(n: number, w = 2) { return String(n).padStart(w, '0'); }
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  const ms = pad(d.getMilliseconds(), 3);
  return `${y}-${m}-${day}T${hh}:${mm}:${ss}.${ms}Z`;
}

function randomShortId(prefix = 'e'): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${t}${r}`;
}

// ====== 底层读写 ======
export function loadAllUsageEvents(): UsageEvent[] {
  try {
    const v = wx.getStorageSync(STORAGE_KEY_USAGE_EVENTS);
    if (Array.isArray(v)) {
      // 基本过滤：只保留合法形状
      return (v as any[]).filter(
        (x: any) =>
          x && typeof x === 'object' &&
          typeof x.id === 'string' && x.id.length > 0 &&
          typeof x.eventName === 'string' &&
          typeof x.date === 'string' &&
          typeof x.timestamp === 'string'
      );
    }
  } catch { /* ignore */ }
  return [];
}

function _appendEvents(incoming: UsageEvent[]): UsageEvent[] {
  const list = loadAllUsageEvents();
  // 限制：只保留最近 ~3000 条（避免本地 Storage 爆）
  const cap = 3000;
  const merged: UsageEvent[] = list.length + incoming.length <= cap
    ? list.concat(incoming)
    : list.concat(incoming).slice(list.length + incoming.length - cap);
  try {
    wx.setStorageSync(STORAGE_KEY_USAGE_EVENTS, merged);
  } catch { /* 静默失败：统计失败不应阻断用户主流程 */ }
  return merged;
}

export function trackEvent(
  eventName: UsageEventName,
  metadata?: UsageEventMetadata,
  opts?: { date?: string; nowMs?: number }
): UsageEvent | null {
  try {
    const now = opts?.nowMs ? new Date(opts.nowMs) : new Date();
    const date = opts?.date || getTodayString();
    // 过滤 metadata 中可能意外写入的敏感字段（虽然调用方应遵守，这里兜底再删一次）
    let meta: UsageEventMetadata | undefined;
    if (metadata && typeof metadata === 'object') {
      const cleaned: UsageEventMetadata = {};
      for (const k of Object.keys(metadata)) {
        const v = (metadata as any)[k];
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === undefined) {
          // 禁止长字符串（> 200 字符），防止意外写入用户内容
          if (typeof v === 'string' && v.length > 200) {
            cleaned[k] = v.slice(0, 200);
          } else {
            cleaned[k] = v;
          }
        }
      }
      meta = Object.keys(cleaned).length > 0 ? cleaned : undefined;
    }
    const ev: UsageEvent = {
      id: randomShortId('e'),
      eventName,
      date,
      timestamp: toISOTimestampString(now),
      metadata: meta,
    };
    _appendEvents([ev]);
    return ev;
  } catch {
    // 全部吞异常：埋点不能影响主流程
    return null;
  }
}

// ====== 单例事件：app_first_open 只一次 ======
export function trackAppFirstOpenOnce(firstLaunchDate?: string): UsageEvent | null {
  try {
    const done = wx.getStorageSync(STORAGE_KEY_USAGE_FIRST_OPEN_DONE) === true;
    if (done) return null;
    const ev = trackEvent(USAGE_EVENT_NAMES.APP_FIRST_OPEN, {
      goalDays: Number(wx.getStorageSync('goal_days_v1') || 0) || 0,
    });
    try { wx.setStorageSync(STORAGE_KEY_USAGE_FIRST_OPEN_DONE, true); } catch { /* ignore */ }
    return ev;
  } catch {
    return null;
  }
}

// ====== app_open：每天冷启动/回前台都会记录（不去重，后续统计按每日 unique date 算活跃）======
export function trackAppOpen(): UsageEvent | null {
  return trackEvent(USAGE_EVENT_NAMES.APP_OPEN);
}

// ====== water_goal_reached：同一天只记录第一次 ======
export function trackWaterGoalReachedOnce(date?: string): UsageEvent | null {
  const d = date || getTodayString();
  try {
    const key = STORAGE_KEY_WATER_GOAL_REACHED_BY_DATE + d;
    if (wx.getStorageSync(key) === true) return null;
    const ev = trackEvent(USAGE_EVENT_NAMES.WATER_GOAL_REACHED, { date: d });
    try { wx.setStorageSync(key, true); } catch { /* ignore */ }
    return ev;
  } catch {
    return null;
  }
}

// ====== 便捷：meal 埋点（不带食物内容） ======
export function trackMealCreated(mealType: MealType, hasPhoto: boolean, satietyLevel?: string) {
  trackEvent(USAGE_EVENT_NAMES.MEAL_CREATED, {
    mealType,
    hasPhoto: !!hasPhoto,
    satiety: typeof satietyLevel === 'string' ? satietyLevel : '',
  });
}
export function trackMealUpdated(mealType: MealType, hasPhoto: boolean, satietyLevel?: string) {
  trackEvent(USAGE_EVENT_NAMES.MEAL_UPDATED, {
    mealType,
    hasPhoto: !!hasPhoto,
    satiety: typeof satietyLevel === 'string' ? satietyLevel : '',
  });
}
export function trackMealPhotoAdded(mealType: MealType) {
  trackEvent(USAGE_EVENT_NAMES.MEAL_PHOTO_ADDED, { mealType });
}

// ====== 便捷：exercise ======
export function trackExerciseSaved(minutes: number) {
  const goalReached = Number(minutes) >= EXERCISE_TARGET_MINUTES;
  trackEvent(USAGE_EVENT_NAMES.EXERCISE_SAVED, {
    minutes: Number(minutes) | 0,
    goalReached: !!goalReached,
  });
}

// ====== 便捷：weight ======
export function trackWeightSaved(isFirstWeightRecord: boolean) {
  trackEvent(USAGE_EVENT_NAMES.WEIGHT_SAVED, { isFirstWeightRecord: !!isFirstWeightRecord });
}

// ====== 便捷：reward ======
export function trackRewardCreated(requiredPoints: number) {
  trackEvent(USAGE_EVENT_NAMES.REWARD_CREATED, { requiredPoints: Number(requiredPoints) | 0 });
}
export function trackRewardUnlocked(requiredPoints: number) {
  trackEvent(USAGE_EVENT_NAMES.REWARD_UNLOCKED, { requiredPoints: Number(requiredPoints) | 0 });
}

/**
 * V9-fix2：奖励解锁幂等埋点——每个 rewardId 只记一次 reward_unlocked。
 * 在 reward 页 refreshAll 时调用：如果该奖励未被领取过 且 总积分已达标 且 之前没记过 unlock 事件 → 记一次。
 * Storage key: `reward_unlocked_done_<rewardId>` = true
 */
export function trackRewardUnlockedOnce(rewardId: string, requiredPoints: number): void {
  try {
    const key = `reward_unlocked_done_${rewardId}`;
    if (wx.getStorageSync(key) === true) return;
    trackEvent(USAGE_EVENT_NAMES.REWARD_UNLOCKED, { requiredPoints: Number(requiredPoints) | 0 });
    try { wx.setStorageSync(key, true); } catch { /* ignore */ }
  } catch { /* ignore */ }
}

export function trackRewardRedeemed(requiredPoints: number) {
  trackEvent(USAGE_EVENT_NAMES.REWARD_REDEEMED, { requiredPoints: Number(requiredPoints) | 0 });
}

// ====== 便捷：AI ======
export function trackAiStarted(mealType: MealType) {
  trackEvent(USAGE_EVENT_NAMES.AI_ANALYSIS_STARTED, { mealType });
}
export function trackAiSucceeded(mealType: MealType, metadata?: UsageEventMetadata) {
  trackEvent(USAGE_EVENT_NAMES.AI_ANALYSIS_SUCCEEDED, Object.assign({}, metadata || {}, { mealType }));
}
export function trackAiFailed(mealType: MealType, metadata?: UsageEventMetadata) {
  trackEvent(USAGE_EVENT_NAMES.AI_ANALYSIS_FAILED, Object.assign({}, metadata || {}, { mealType }));
}

// ====== 最小性能 ======
export function trackPerfAppLaunchMs(ms: number) {
  trackEvent(USAGE_EVENT_NAMES.PERF_APP_LAUNCH, { ms: Number(ms) | 0 });
}
export function trackPerfMealSaveMs(ms: number, mealType?: MealType) {
  const meta: UsageEventMetadata = { ms: Number(ms) | 0 };
  if (mealType) meta.mealType = mealType;
  trackEvent(USAGE_EVENT_NAMES.PERF_MEAL_SAVE, meta);
}

// =========================================================================
// 统计派生：开发页 /dev/usage 使用（所有计算为本地同步 O(N)，N ≤ 3000 很快）
// =========================================================================

export interface UsageAggregate {
  // 6 大核心指标（dev page 顶部固定）
  testStartDate: string | null;
  testDaysPassed: number;   // 测试开始到今天经过的天数（含首日）
  activeDays7: number;      // 7 天活跃天数：Day1~Day7 任一天有 APP_OPEN 就算 active
  meaningfulDays7: number;  // 7 天里有"有效记录"的天数（meaningful=true）
  totalMeals7: number;      // 7 天 MEAL_CREATED 总和
  exerciseDays7: number;    // 7 天里 EXERCISE_SAVED（且 goalReached=true）天数
  redeemedRewards: number;  // 全局 REWARD_REDEEMED 总数
  aiStarted: number;        // 全局 AI 点击分析次数（started）

  // 7 天留存 & 有效记录（Day1 为 firstOpen 或 firstDate，按序 Day1~Day7）
  dailyMatrix: Array<{
    day: number;                    // 1~7
    date: string;                   // YYYY-MM-DD
    isFuture: boolean;              // 未到（显示 —）
    active: boolean;                // 当天是否有任意 APP_OPEN
    meaningful: boolean;            // 当天是否有 meal_created/exercise_saved/weight_saved/water_goal_reached
    meals: { breakfast: number; lunch: number; dinner: number };
    hasExerciseGoal: boolean;       // 当天 EXERCISE_SAVED && goalReached=true
    hasWeight: boolean;             // 当天 WEIGHT_SAVED
    waterReached: boolean;          // 当天 WATER_GOAL_REACHED
  }>;

  // 汇总计数
  totalCounts: {
    breakfastCreated: number;
    lunchCreated: number;
    dinnerCreated: number;
    mealPhotoAdded: number;
    exerciseSavedDays: number;      // 有 EXERCISE_SAVED 的天数（去重 date）
    weightSavedDays: number;        // 有 WEIGHT_SAVED 的天数
    rewardsCreated: number;
    rewardsUnlocked: number;
    rewardsRedeemed: number;
    aiStarted: number;
    aiSucceeded: number;
    aiFailed: number;
    appOpenCount: number;           // 总 app 打开次数（一天可能多次）
    appActiveDays: number;          // 总活跃天数（日期去重）
    meaningfulTotalDays: number;    // 总有效记录天数（日期去重）
  };

  // AI 成功率：started > 0 时 = succeeded / started；undefined 代表没点过
  aiSuccessRate: number | null;
}

function getMeaningfulEventSet(): Set<string> {
  return new Set<string>([
    USAGE_EVENT_NAMES.MEAL_CREATED,
    USAGE_EVENT_NAMES.EXERCISE_SAVED,
    USAGE_EVENT_NAMES.WEIGHT_SAVED,
    USAGE_EVENT_NAMES.WATER_GOAL_REACHED,
  ]);
}

/** 以 firstOpen 事件的日期 + firstDate（STORAGE_KEY_FIRST_DATE）取最早者做 Day1。若都没有，返回 0 天矩阵 */
export function calculateUsageAggregate(firstLaunchDate?: string | null): UsageAggregate {
  const events = loadAllUsageEvents();

  // 1. 先找 7 天测试起点：优先 earliestEventDateOf(APP_FIRST_OPEN or first event date)，兜底 firstLaunchDate，再兜底今天
  const meaningfulSet = getMeaningfulEventSet();
  let startDate: string | null = null;
  {
    const firstOpenEv = events.find(e => e.eventName === USAGE_EVENT_NAMES.APP_FIRST_OPEN);
    if (firstOpenEv) startDate = firstOpenEv.date;
    if (!startDate && firstLaunchDate && typeof firstLaunchDate === 'string' && firstLaunchDate.length > 0) {
      startDate = firstLaunchDate;
    }
    if (!startDate) {
      // 没有 first_open 也没 firstDate：取最早事件的日期
      let minD: string | null = null;
      for (const e of events) {
        if (!minD || e.date < minD) minD = e.date;
      }
      startDate = minD || getTodayString();
    }
  }

  const today = getTodayString();
  const dayList = buildDailyMatrix(startDate, today, 7);
  // maps: date -> row index in dayList
  const dateIndex: Record<string, number> = {};
  dayList.forEach((d, i) => { dateIndex[d.date] = i; });

  const totalCounts: UsageAggregate['totalCounts'] = {
    breakfastCreated: 0,
    lunchCreated: 0,
    dinnerCreated: 0,
    mealPhotoAdded: 0,
    exerciseSavedDays: 0,
    weightSavedDays: 0,
    rewardsCreated: 0,
    rewardsUnlocked: 0,
    rewardsRedeemed: 0,
    aiStarted: 0,
    aiSucceeded: 0,
    aiFailed: 0,
    appOpenCount: 0,
    appActiveDays: 0,
    meaningfulTotalDays: 0,
  };

  // 全局去重 sets：exerciseSavedDaysByDate, weightSavedByDate, appActiveDates, meaningfulDates
  const exerciseDates = new Set<string>();
  const weightDates = new Set<string>();
  const appActiveDates = new Set<string>();
  const meaningfulDates = new Set<string>();

  // 先把每日矩阵初始化
  for (const row of dayList) {
    row.meals = { breakfast: 0, lunch: 0, dinner: 0 };
  }

  for (const ev of events) {
    switch (ev.eventName) {
      case USAGE_EVENT_NAMES.APP_OPEN:
        totalCounts.appOpenCount += 1;
        appActiveDates.add(ev.date);
        if (ev.date in dateIndex) dayList[dateIndex[ev.date]].active = true;
        break;
      case USAGE_EVENT_NAMES.MEAL_CREATED: {
        const mt = (ev.metadata as any)?.mealType as any;
        if (mt === 'breakfast') totalCounts.breakfastCreated += 1;
        else if (mt === 'lunch') totalCounts.lunchCreated += 1;
        else if (mt === 'dinner') totalCounts.dinnerCreated += 1;
        if (ev.date in dateIndex) {
          const row = dayList[dateIndex[ev.date]];
          row.meaningful = true;
          if (mt === 'breakfast') row.meals.breakfast += 1;
          else if (mt === 'lunch') row.meals.lunch += 1;
          else if (mt === 'dinner') row.meals.dinner += 1;
          meaningfulDates.add(ev.date);
        }
        break;
      }
      case USAGE_EVENT_NAMES.MEAL_PHOTO_ADDED:
        totalCounts.mealPhotoAdded += 1;
        break;
      case USAGE_EVENT_NAMES.EXERCISE_SAVED: {
        const goal = !!(ev.metadata as any)?.goalReached;
        if (ev.date in dateIndex) {
          dayList[dateIndex[ev.date]].meaningful = true;
          if (goal) dayList[dateIndex[ev.date]].hasExerciseGoal = true;
          meaningfulDates.add(ev.date);
        }
        if (goal) exerciseDates.add(ev.date);
        break;
      }
      case USAGE_EVENT_NAMES.WATER_GOAL_REACHED:
        if (ev.date in dateIndex) {
          dayList[dateIndex[ev.date]].meaningful = true;
          dayList[dateIndex[ev.date]].waterReached = true;
        }
        meaningfulDates.add(ev.date);
        break;
      case USAGE_EVENT_NAMES.WEIGHT_SAVED:
        weightDates.add(ev.date);
        if (ev.date in dateIndex) {
          dayList[dateIndex[ev.date]].meaningful = true;
          dayList[dateIndex[ev.date]].hasWeight = true;
          meaningfulDates.add(ev.date);
        }
        break;
      case USAGE_EVENT_NAMES.REWARD_CREATED: totalCounts.rewardsCreated += 1; break;
      case USAGE_EVENT_NAMES.REWARD_UNLOCKED: totalCounts.rewardsUnlocked += 1; break;
      case USAGE_EVENT_NAMES.REWARD_REDEEMED: totalCounts.rewardsRedeemed += 1; break;
      case USAGE_EVENT_NAMES.AI_ANALYSIS_STARTED: totalCounts.aiStarted += 1; break;
      case USAGE_EVENT_NAMES.AI_ANALYSIS_SUCCEEDED: totalCounts.aiSucceeded += 1; break;
      case USAGE_EVENT_NAMES.AI_ANALYSIS_FAILED: totalCounts.aiFailed += 1; break;
      // perf_* 不进总计数，只 dev 页另算
      default: break;
    }
  }

  totalCounts.exerciseSavedDays = exerciseDates.size;
  totalCounts.weightSavedDays = weightDates.size;
  totalCounts.appActiveDays = appActiveDates.size;
  totalCounts.meaningfulTotalDays = meaningfulDates.size;

  let activeDays7 = 0;
  let meaningfulDays7 = 0;
  let totalMeals7 = 0;
  let exerciseDays7 = 0;
  for (const row of dayList) {
    if (row.isFuture) continue;
    if (row.active) activeDays7 += 1;
    if (row.meaningful) meaningfulDays7 += 1;
    totalMeals7 += (row.meals.breakfast + row.meals.lunch + row.meals.dinner);
    if (row.hasExerciseGoal) exerciseDays7 += 1;
  }

  const daysPassedRaw = daysBetweenInclusive(startDate, today);
  const testDaysPassed = Math.max(1, Math.min(7, daysPassedRaw));

  const aiSuccessRate = totalCounts.aiStarted > 0
    ? Number(((totalCounts.aiSucceeded / totalCounts.aiStarted) * 100).toFixed(0))
    : null;

  return {
    testStartDate: startDate,
    testDaysPassed,
    activeDays7,
    meaningfulDays7,
    totalMeals7,
    exerciseDays7,
    redeemedRewards: totalCounts.rewardsRedeemed,
    aiStarted: totalCounts.aiStarted,
    dailyMatrix: dayList,
    totalCounts,
    aiSuccessRate,
  };
}

function buildDailyMatrix(
  startDate: string,
  today: string,
  totalDays: number,
): UsageAggregate['dailyMatrix'] {
  const s = new Date(startDate.slice(0, 4) + '-' + startDate.slice(5, 7) + '-' + startDate.slice(8, 10));
  if (isNaN(s.getTime())) {
    const t = new Date(today.slice(0, 4) + '-' + today.slice(5, 7) + '-' + today.slice(8, 10));
    return buildMatrixFromDate(t, today, totalDays);
  }
  return buildMatrixFromDate(s, today, totalDays);
}

function buildMatrixFromDate(start: Date, today: string, totalDays: number) {
  const todayDt = new Date(today.slice(0, 4) + '-' + today.slice(5, 7) + '-' + today.slice(8, 10));
  const out: UsageAggregate['dailyMatrix'] = [];
  for (let i = 0; i < totalDays; i++) {
    const dt = new Date(start.getTime() + i * 86400000);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;
    const isFuture = dt.getTime() > todayDt.getTime();
    out.push({
      day: i + 1,
      date: dateStr,
      isFuture,
      active: false,
      meaningful: false,
      meals: { breakfast: 0, lunch: 0, dinner: 0 },
      hasExerciseGoal: false,
      hasWeight: false,
      waterReached: false,
    });
  }
  return out;
}

/** 清除全部 usage 事件（仅开发环境"清除测试数据"调用） */
export function clearAllUsageEvents(): void {
  try {
    wx.removeStorageSync(STORAGE_KEY_USAGE_EVENTS);
    wx.removeStorageSync(STORAGE_KEY_USAGE_FIRST_OPEN_DONE);
    // V9-fix7：改为读 keys 列表过滤 water_goal_reached_flag_v1_ 前缀（不再扫 90 天兜底）
    try {
      const allKeys = wx.getStorageInfoSync().keys || [];
      for (const k of allKeys) {
        if (typeof k === 'string' && k.indexOf(STORAGE_KEY_WATER_GOAL_REACHED_BY_DATE) === 0) {
          try { wx.removeStorageSync(k); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  } catch { /* ignore */ }
}
