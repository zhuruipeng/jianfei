/**
 * devService.ts
 * 开发环境测试数据生成器。
 *
 * 【V8 规则 20】：仅小程序开发工具里的"开发版"（__wxConfig.envVersion==='develop'）可用。
 * - 正式版 / 体验版 / 预览版即便代码还带着，guard 也 return，不会写任何假数据。
 * - 7天：三餐记录 + 运动 + 喝水 + 体重 + 3个奖励 + 若干AI分析结果（模拟）。
 */

import {
  DailyRecord,
  MealRecord,
  MealType,
  WeightRecord,
  Reward,
  MealAnalysis,
  SATIETY_ORDER,
  MEAL_TAG_LIST,
  STORAGE_PREFIX_DAILY,
  STORAGE_KEY_FIRST_DATE,
  STORAGE_KEY_REWARDS,
  STORAGE_KEY_MEAL_RECORDS,
  STORAGE_KEY_WEIGHT_RECORDS,
  // V10：计划闭环测试数据
  UsageEvent,
  USAGE_EVENT_NAMES,
  STORAGE_KEY_USAGE_EVENTS,
  STORAGE_KEY_USAGE_FIRST_OPEN_DONE,
  STORAGE_KEY_WATER_GOAL_REACHED_BY_DATE,
} from '../types/index';
import { formatDateYYYYMMDD, formatDateTimeNow, genLocalId, getTodayString } from '../utils/date';
import * as planService from './planService';

function isDevelop(): boolean {
  try {
    const g = (globalThis as any)?.wx as any;
    const info = g?.getAccountInfoSync?.()?.miniProgram;
    return info?.envVersion === 'develop';
  } catch {
    return false;
  }
}

/** 开发环境 guard：非 develop 调用全部 noop */
export function isDevEnv(): boolean {
  return isDevelop();
}

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 生成 7 天前 ~ 今天（共 days 天）的日期列表 */
function lastNDates(days = 7): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 24 * 3600 * 1000);
    out.push(formatDateYYYYMMDD(d));
  }
  return out;
}

/**
 * 写入 7 天假数据（不删老数据，会覆盖同一天同 meal/date，体重同一天覆盖）
 * 返回成功与否 + 写入条目摘要
 */
export function seedDemoDataFor7Days(opts: { days?: number; resetFirstLaunchDate?: boolean } = {}): {
  ok: boolean;
  reason?: string;
  dailyCount: number;
  mealCount: number;
  weightCount: number;
  rewardCount: number;
} {
  if (!isDevelop()) {
    return { ok: false, reason: '仅开发环境可生成测试数据', dailyCount: 0, mealCount: 0, weightCount: 0, rewardCount: 0 };
  }
  const days = Math.min(30, Math.max(3, opts.days ?? 7));
  const dates = lastNDates(days);

  // 1. firstLaunchDate：置为 N 天前，保证首页"第 8 天"是对的
  if (opts.resetFirstLaunchDate !== false) {
    try { wx.setStorageSync(STORAGE_KEY_FIRST_DATE, dates[0]); } catch { /* ignore */ }
  }

  // 2. 现有 meals/weights/rewards 读出来，准备合并（同 date+type 覆盖）
  const meals: MealRecord[] = (() => {
    try {
      const raw = wx.getStorageSync(STORAGE_KEY_MEAL_RECORDS);
      return Array.isArray(raw) ? raw : [];
    } catch { return []; }
  })();
  const weights: WeightRecord[] = (() => {
    try {
      const raw = wx.getStorageSync(STORAGE_KEY_WEIGHT_RECORDS);
      return Array.isArray(raw) ? raw : [];
    } catch { return []; }
  })();
  const rewards: Reward[] = (() => {
    try {
      const raw = wx.getStorageSync(STORAGE_KEY_REWARDS);
      return Array.isArray(raw) ? raw : [];
    } catch { return []; }
  })();

  let mealCount = 0;
  let weightCount = 0;

  const baseWeight = 72.4;
  dates.forEach((date, idx) => {
    // DailyRecord：尽量保留用户真实修改，不存在则创建，默认旧字段全 false
    const key = STORAGE_PREFIX_DAILY + date;
    const existing: DailyRecord | null = (() => {
      try {
        const r = wx.getStorageSync(key);
        return r && typeof r === 'object' ? r : null;
      } catch { return null; }
    })();
    const daily: DailyRecord = existing ?? {
      date,
      breakfastCompleted: false,
      lunchCompleted: false,
      dinnerCompleted: false,
      exerciseMinutes: 0,
      waterCups: 0,
    };
    // 前 6 天：随机 20~65 分钟；今天先 20 分钟（便于首页测试 20/30）
    const isToday = (idx === dates.length - 1);
    daily.exerciseMinutes = isToday ? 20 : (20 + Math.floor(Math.random() * 50));
    // 前 6 天：6~10 杯；今天：6 杯（便于首页测试 6/8）
    daily.waterCups = isToday ? 6 : (6 + Math.floor(Math.random() * 5));
    try { wx.setStorageSync(key, daily); } catch { /* ignore */ }

    // 3 meals（V7 标准结构 + 偶尔 AI 结果）
    const mealTypes: MealType[] = ['breakfast', 'lunch', 'dinner'];
    mealTypes.forEach((mt, mi) => {
      // 最近 2 天早餐都有 AI 分析模拟结果
      const wantAi = (idx >= dates.length - 2) && mt === 'breakfast';
      // 去掉同一天同一 meal 旧记录（覆盖）
      const otherMeals = meals.filter(m => !(m.date === date && m.mealType === mt));
      const now = formatDateTimeNow();
      const meal: MealRecord = {
        id: genLocalId(),
        date, mealType: mt,
        foodText: {
          breakfast: '鸡蛋、牛奶、一片全麦面包',
          lunch: '米饭、清蒸鱼、炒青菜',
          dinner: '小米粥、凉拌黄瓜',
        }[mt],
        satietyLevel: rand(SATIETY_ORDER),
        tags: (() => {
          const t = new Set<string>();
          t.add('has_protein');
          t.add('has_staple');
          if (mt !== 'dinner') t.add('has_vegetables');
          if (Math.random() > 0.6) t.add('has_fruit');
          if (Math.random() > 0.8) t.add('has_soup');
          return Array.from(t) as any;
        })(),
        createdAt: now, updatedAt: now,
        aiStatus: wantAi ? 'completed' : 'none',
        aiAnalysis: wantAi
          ? ({
              foods: ['鸡蛋', '牛奶', '全麦面包'],
              portionLevel: 'appropriate',
              vegetables: mi === 2 ? 'adequate' : (Math.random() > 0.5 ? 'adequate' : 'low'),
              protein: 'adequate',
              stapleFood: 'adequate',
              sugaryDrink: 'no',
              summary: mt === 'breakfast' ? '早餐有蛋有奶，有主食，是一份不错的开始。' : '这一餐搭配整体比较均衡。',
              primarySuggestion: mt === 'breakfast' ? '明天加一份蔬菜（例如一个番茄）会更完整～' : '下一餐可以多吃一口蔬菜。',
              confidence: Math.random() > 0.3 ? 'high' : 'medium',
              analyzedAt: now,
            } as MealAnalysis)
          : undefined,
      };
      otherMeals.push(meal as any);
      meals.length = 0;
      meals.push(...otherMeals);
      mealCount++;
    });

    // 体重：线性缓慢下降一点（从 baseWeight 开始每天 -0.05 ~ -0.2 波动；今天写 72.6 做展示）
    const oldWeights = weights.filter(w => w.date !== date);
    const weightKg = (() => {
      if (isToday) return 72.6;
      return +(baseWeight + (dates.length - 1 - idx) * 0.08 + (Math.random() - 0.5) * 0.2).toFixed(1);
    })();
    oldWeights.push({
      id: genLocalId(),
      date, weight: weightKg,
      createdAt: formatDateTimeNow(),
      updatedAt: formatDateTimeNow(),
    });
    weights.length = 0;
    weights.push(...oldWeights);
    weightCount++;
  });

  // 写入 meals / weights
  try { wx.setStorageSync(STORAGE_KEY_MEAL_RECORDS, meals); } catch { /* ignore */ }
  try { wx.setStorageSync(STORAGE_KEY_WEIGHT_RECORDS, weights); } catch { /* ignore */ }

  // 3 个奖励（不覆盖用户真实奖励：如果 rewards 已经有就不塞）
  let rewardCount = 0;
  if (rewards.length === 0) {
    const now = formatDateTimeNow();
    const base: Omit<Reward, 'id' | 'createdAt'>[] = [
      { title: '喝一杯喜欢的咖啡', emoji: '☕', requiredPoints: 100, redeemed: true,  redeemedAt: now },
      { title: '看一场电影',       emoji: '🎬', requiredPoints: 300, redeemed: false },
      { title: '给自己买一件喜欢的小东西', emoji: '🎁', requiredPoints: 500, redeemed: false },
    ];
    base.forEach(b => {
      rewards.push({ ...b, id: genLocalId(), createdAt: now });
      rewardCount++;
    });
    try { wx.setStorageSync(STORAGE_KEY_REWARDS, rewards); } catch { /* ignore */ }
  } else {
    rewardCount = rewards.length;
  }

  return { ok: true, dailyCount: dates.length, mealCount, weightCount, rewardCount };
}

// =========================================================================
// V10：28 天计划闭环测试数据
//   用于快速验证：第1~4周总结 + 28天计划完成页
//   策略：startDate = today - 28天 → 今天 = Day 29（planDay > durationDays）
//         4 个完整周都已结束（首页 ensureWeeklySummariesUpTo 会自动生成 4 个 WeeklySummary）
//         首页显示"🎉 28天计划完成"入口
// =========================================================================

/** YYYY-MM-DD 加减天数（本地时区中午 12 点，避免时区漂移） */
function addDaysLocal(dateStr: string, days: number): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0, 0);
  if (isNaN(d.getTime())) return dateStr;
  d.setDate(d.getDate() + days);
  return formatDateYYYYMMDD(d);
}

/** 列出 [start, end] 区间所有日期（含首尾） */
function listDatesRange(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard < 400) {
    out.push(cur);
    if (cur === end) break;
    cur = addDaysLocal(cur, 1);
    guard++;
  }
  return out;
}

/** 构造一个 UsageEvent（不写 storage，由调用方批量写） */
function makeEvent(
  eventName: string,
  date: string,
  metadata?: Record<string, string | number | boolean | undefined>
): UsageEvent {
  return {
    id: genLocalId(),
    eventName: eventName as any,
    date,
    timestamp: new Date(`${date}T12:00:00`).toISOString(),
    metadata,
  };
}

export interface Seed28DaysResult {
  ok: boolean;
  reason?: string;
  planId?: string;
  startDate?: string;
  durationDays?: number;
  dailyCount: number;
  mealCount: number;
  weightCount: number;
  rewardCount: number;
  eventCount: number;
}

/**
 * 生成完整 28 天计划测试数据：
 *  - 创建 28 天 active plan（startDate = today - 28 天，今天 = Day 29）
 *  - Day1~Day28 每天生成 DailyRecord(snapshot=30/8) + 3 餐 + 体重 + UsageEvent
 *  - 今天（Day29）只生成空白 DailyRecord + APP_OPEN 事件
 *  - 3 个奖励（若已存在则不覆盖）
 *  - APP_FIRST_OPEN 事件 1 次（startDate 当天）
 *  - WeeklySummary 不主动生成（首页 ensureWeeklySummariesUpTo 自动生成）
 */
export function seedDemoDataFor28Days(): Seed28DaysResult {
  if (!isDevelop()) {
    return { ok: false, reason: '仅开发环境可生成测试数据', dailyCount: 0, mealCount: 0, weightCount: 0, rewardCount: 0, eventCount: 0 };
  }

  const today = getTodayString();
  // startDate = today - 28 天 → 今天 = Day 29（planDay > 28 触发完成入口；4 周都已结束）
  const startDate = addDaysLocal(today, -28);

  // 1. 创建 28 天计划（旧的 active plan 会被移入 history，旧数据保留）
  let planId = '';
  try {
    const plan = planService.createPlan({
      durationDays: 28,
      exerciseGoalMinutes: 30,
      waterGoalCups: 8,
      startWeight: 75.0,
      targetWeight: 72.0,
      startDate,
    });
    planId = plan.id;
  } catch (e) {
    return { ok: false, reason: '创建计划失败', dailyCount: 0, mealCount: 0, weightCount: 0, rewardCount: 0, eventCount: 0 };
  }

  // 2. 读取已有 meals/weights/rewards/events（合并，同 date+type 覆盖）
  const meals: MealRecord[] = (() => {
    try { const raw = wx.getStorageSync(STORAGE_KEY_MEAL_RECORDS); return Array.isArray(raw) ? raw : []; } catch { return []; }
  })();
  const weights: WeightRecord[] = (() => {
    try { const raw = wx.getStorageSync(STORAGE_KEY_WEIGHT_RECORDS); return Array.isArray(raw) ? raw : []; } catch { return []; }
  })();
  const rewards: Reward[] = (() => {
    try { const raw = wx.getStorageSync(STORAGE_KEY_REWARDS); return Array.isArray(raw) ? raw : []; } catch { return []; }
  })();
  const events: UsageEvent[] = (() => {
    try { const raw = wx.getStorageSync(STORAGE_KEY_USAGE_EVENTS); return Array.isArray(raw) ? raw : []; } catch { return []; }
  })();

  // 清理旧 plan 区间内的同 date 数据（避免与旧 plan 数据混合造成统计混乱）
  //   仅清理 startDate~today 区间内的 meals/weights/events（daily_record_* 由前缀清理）
  const planEnd = today;
  const cleanOldInRange = <T extends { date: string }>(arr: T[]): T[] => arr.filter(x => !(x.date >= startDate && x.date <= planEnd));
  let mealArr = cleanOldInRange(meals);
  let weightArr = cleanOldInRange(weights);
  let eventArr = events.filter(e => !(e.date >= startDate && e.date <= planEnd));

  // 3. 生成 Day1~Day28 的完整数据
  const dates28 = listDatesRange(startDate, addDaysLocal(startDate, 27));  // Day1~Day28
  let mealCount = 0;
  let weightCount = 0;
  let eventCount = 0;
  const baseWeight = 75.0;
  const targetWeight = 72.5;

  // APP_FIRST_OPEN（startDate 当天，只 1 次；同时设 first_open_done 标记）
  eventArr.push(makeEvent(USAGE_EVENT_NAMES.APP_FIRST_OPEN, startDate, { goalDays: 28 }));
  eventCount++;
  try { wx.setStorageSync(STORAGE_KEY_USAGE_FIRST_OPEN_DONE, true); } catch { /* ignore */ }

  dates28.forEach((date, idx) => {
    const dayNumber = idx + 1;  // 1~28
    // DailyRecord（带 snapshot=30/8，运动/喝水随机但大部分达标）
    const dailyKey = STORAGE_PREFIX_DAILY + date;
    const exerciseMinutes = 25 + Math.floor(Math.random() * 30);   // 25~54，多数达标
    const waterCups = 6 + Math.floor(Math.random() * 5);            // 6~10，多数达标
    const daily: DailyRecord = {
      date,
      breakfastCompleted: false,  // 三餐完成态由 MealRecord 决定，这里保持 false
      lunchCompleted: false,
      dinnerCompleted: false,
      exerciseMinutes,
      waterCups,
      exerciseGoalMinutesSnapshot: 30,
      waterGoalCupsSnapshot: 8,
    };
    try { wx.setStorageSync(dailyKey, daily); } catch { /* ignore */ }

    // 3 餐 MealRecord
    const mealTypes: MealType[] = ['breakfast', 'lunch', 'dinner'];
    mealTypes.forEach((mt) => {
      // 去掉同一天同一 meal 旧记录
      mealArr = mealArr.filter(m => !(m.date === date && m.mealType === mt));
      const now = formatDateTimeNow();
      const meal: MealRecord = {
        id: genLocalId(),
        date, mealType: mt,
        foodText: {
          breakfast: '鸡蛋、牛奶、一片全麦面包',
          lunch: '米饭、清蒸鱼、炒青菜',
          dinner: '小米粥、凉拌黄瓜',
        }[mt],
        satietyLevel: rand(SATIETY_ORDER),
        tags: ['has_protein', 'has_staple', mt !== 'dinner' ? 'has_vegetables' : 'has_soup'].filter(Boolean) as any,
        createdAt: now, updatedAt: now,
        aiStatus: 'none',
      };
      mealArr.push(meal as any);
      mealCount++;
    });

    // 体重：线性从 baseWeight 缓慢下降到 targetWeight（带轻微波动）
    weightArr = weightArr.filter(w => w.date !== date);
    const progress = dayNumber / 28;
    const weightKg = +(baseWeight + (targetWeight - baseWeight) * progress + (Math.random() - 0.5) * 0.2).toFixed(1);
    weightArr.push({
      id: genLocalId(),
      date, weight: weightKg,
      createdAt: formatDateTimeNow(),
      updatedAt: formatDateTimeNow(),
    });
    weightCount++;

    // UsageEvents：APP_OPEN + MEAL_CREATED×3 + EXERCISE_SAVED + (WATER_GOAL_REACHED if达标) + WEIGHT_SAVED
    eventArr.push(makeEvent(USAGE_EVENT_NAMES.APP_OPEN, date));
    eventArr.push(makeEvent(USAGE_EVENT_NAMES.MEAL_CREATED, date, { mealType: 'breakfast', hasPhoto: false }));
    eventArr.push(makeEvent(USAGE_EVENT_NAMES.MEAL_CREATED, date, { mealType: 'lunch', hasPhoto: false }));
    eventArr.push(makeEvent(USAGE_EVENT_NAMES.MEAL_CREATED, date, { mealType: 'dinner', hasPhoto: false }));
    eventArr.push(makeEvent(USAGE_EVENT_NAMES.EXERCISE_SAVED, date, { minutes: exerciseMinutes, goalReached: exerciseMinutes >= 30 }));
    if (waterCups >= 8) {
      eventArr.push(makeEvent(USAGE_EVENT_NAMES.WATER_GOAL_REACHED, date));
      // 同步 water_goal_reached 标记（防止 usageService 重复统计）
      try { wx.setStorageSync(STORAGE_KEY_WATER_GOAL_REACHED_BY_DATE + date, true); } catch { /* ignore */ }
    }
    const isFirstWeight = (dayNumber === 1);
    eventArr.push(makeEvent(USAGE_EVENT_NAMES.WEIGHT_SAVED, date, { isFirstWeightRecord: isFirstWeight }));
    eventCount += 5 + (waterCups >= 8 ? 1 : 0);
  });

  // 4. 今天（Day29）：空白 DailyRecord + APP_OPEN（让首页显示"第29天"和完成入口）
  const todayDailyKey = STORAGE_PREFIX_DAILY + today;
  try {
    const todayDaily: DailyRecord = {
      date: today,
      breakfastCompleted: false,
      lunchCompleted: false,
      dinnerCompleted: false,
      exerciseMinutes: 0,
      waterCups: 0,
      exerciseGoalMinutesSnapshot: 30,
      waterGoalCupsSnapshot: 8,
    };
    wx.setStorageSync(todayDailyKey, todayDaily);
  } catch { /* ignore */ }
  eventArr.push(makeEvent(USAGE_EVENT_NAMES.APP_OPEN, today));
  eventCount++;

  // 5. 写入 meals / weights / events
  try { wx.setStorageSync(STORAGE_KEY_MEAL_RECORDS, mealArr); } catch { /* ignore */ }
  try { wx.setStorageSync(STORAGE_KEY_WEIGHT_RECORDS, weightArr); } catch { /* ignore */ }
  try { wx.setStorageSync(STORAGE_KEY_USAGE_EVENTS, eventArr); } catch { /* ignore */ }

  // 6. 奖励（不覆盖用户已有奖励）
  let rewardCount = 0;
  if (rewards.length === 0) {
    const now = formatDateTimeNow();
    const base: Omit<Reward, 'id' | 'createdAt'>[] = [
      { title: '喝一杯喜欢的咖啡', emoji: '☕', requiredPoints: 100, redeemed: true, redeemedAt: now },
      { title: '看一场电影', emoji: '🎬', requiredPoints: 300, redeemed: true, redeemedAt: now },
      { title: '给自己买一件喜欢的小东西', emoji: '🎁', requiredPoints: 500, redeemed: false },
    ];
    base.forEach(b => {
      rewards.push({ ...b, id: genLocalId(), createdAt: now });
      rewardCount++;
    });
    try { wx.setStorageSync(STORAGE_KEY_REWARDS, rewards); } catch { /* ignore */ }
    // 模拟 reward_unlocked / reward_redeemed 事件（前两个奖励解锁+领取）
    eventArr.push(makeEvent(USAGE_EVENT_NAMES.REWARD_UNLOCKED, addDaysLocal(startDate, 3), { requiredPoints: 100 }));
    eventArr.push(makeEvent(USAGE_EVENT_NAMES.REWARD_REDEEMED, addDaysLocal(startDate, 4)));
    eventArr.push(makeEvent(USAGE_EVENT_NAMES.REWARD_UNLOCKED, addDaysLocal(startDate, 10), { requiredPoints: 300 }));
    eventArr.push(makeEvent(USAGE_EVENT_NAMES.REWARD_REDEEMED, addDaysLocal(startDate, 12)));
    eventCount += 4;
    try { wx.setStorageSync(STORAGE_KEY_USAGE_EVENTS, eventArr); } catch { /* ignore */ }
  } else {
    rewardCount = rewards.length;
  }

  // 7. 清除 weekly_summary_viewed_* 标记（让周总结入口重新出现，便于测试）
  try {
    const allKeys = wx.getStorageInfoSync().keys || [];
    for (const k of allKeys) {
      if (typeof k === 'string' && k.indexOf('weekly_summary_viewed_') === 0) {
        try { wx.removeStorageSync(k); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

  return {
    ok: true,
    planId,
    startDate,
    durationDays: 28,
    dailyCount: dates28.length + 1,  // 28 天 + 今天
    mealCount,
    weightCount,
    rewardCount,
    eventCount,
  };
}

// ================================================================
// V12：养成系统开发工具（仅 develop 环境）
// ================================================================
import {
  STORAGE_KEY_ENERGY_LEDGER,
  STORAGE_KEY_COMPANION_STATE,
  STORAGE_KEY_COMPANION_INTRO_SHOWN,
  STORAGE_KEY_COMPANION_WELCOME_GIVEN,
  STORAGE_KEY_SPECIAL_TASK_SKIPPED_PREFIX,
  STORAGE_KEY_JOURNEY_CARDS_UNLOCKED_V1,
  STORAGE_KEY_WORLD_UI_STATE,
  STORAGE_KEY_WORLD_DISCOVERIES,
  JOURNEY_CARDS,
} from '../types/index';
import { awardEnergy, calculateTotalEnergy, loadEnergyLedger } from '../utils/energy';
import { computeLevelByEnergy, saveCompanionState, loadCompanionState, unlockJourneyCardsForPlanDay } from '../utils/companion';

interface DevEnergyResult {
  ok: boolean;
  reason?: string;
  awardedAmount: number;
  totalEnergy: number;
  levelUp: { from: number; to: number } | null;
}

/** 开发工具：+20 能量（当天 special_task） */
export function devAdd20Energy(date?: string): DevEnergyResult {
  return _devAddEnergyDev(date || getTodayString(), 20, 'dev_add_20');
}

/** 开发工具：+100 能量（当天 special_task 加另一个 sourceId，用 growth_bonus） */
export function devAdd100Energy(date?: string): DevEnergyResult {
  return _devAddEnergyDev(date || getTodayString(), 100, 'dev_add_100');
}

function _devAddEnergyDev(date: string, amount: number, idSuffix: string): DevEnergyResult {
  if (!isDevelop()) return { ok: false, reason: '仅开发环境', awardedAmount: 0, totalEnergy: 0, levelUp: null };
  const beforeTotal = calculateTotalEnergy();
  const fromLv = computeLevelByEnergy(beforeTotal);
  const sourceId = `${idSuffix}_${date}`;
  const r = awardEnergy({ date, source: 'growth_bonus' as any, sourceId, amount });
  if (!r.ok) return { ok: false, reason: '发能量失败', awardedAmount: 0, totalEnergy: beforeTotal, levelUp: null };
  const newTotal = calculateTotalEnergy();
  const toLv = computeLevelByEnergy(newTotal);
  // 同步 CompanionState.lastKnownLevel
  try {
    const cur = loadCompanionState();
    if (cur) {
      cur.lastKnownLevel = toLv;
      saveCompanionState(cur);
    }
  } catch { /* ignore */ }
  return {
    ok: true,
    awardedAmount: r.created ? amount : 0,
    totalEnergy: newTotal,
    levelUp: fromLv !== toLv ? { from: fromLv, to: toLv } : null,
  };
}

/** 开发工具：模拟下一天（改 app_first_launch_date 和 plan.startDate 回退一天，让 planDay 自增） */
export function devSimulateNextDay(): { ok: boolean; reason?: string; newDate?: string } {
  if (!isDevelop()) return { ok: false, reason: '仅开发环境' };
  try {
    // 把 firstLaunchDate 和 plan.startDate 同时 -1 day
    const _minusOne = (ds: string) => addDaysLocal(ds, -1);
    const today = getTodayString();
    // 方法：把 firstLaunchDate 往前挪 1 天；有 plan 也往前挪 1 天，planDay = (today - startDate) + 1 就自动 +1
    try {
      const first = String(wx.getStorageSync('app_first_launch_date') || '');
      if (first) wx.setStorageSync('app_first_launch_date', _minusOne(first));
    } catch { /* ignore */ }
    // 同步 app.globalData
    try {
      const app = getApp();
      if (app && app.globalData && app.globalData.firstLaunchDate) {
        app.globalData.firstLaunchDate = _minusOne(app.globalData.firstLaunchDate);
      }
    } catch { /* ignore */ }
    // 把 active plan.startDate 往前挪 1 天（优先走 planService 公开方法，否则直接改 active_plan storage）
    try {
      const plan = planService.loadActivePlan && planService.loadActivePlan();
      if (plan && plan.startDate) {
        const nextStart = _minusOne(plan.startDate);
        // 若 planService 提供了修改入口则调用，否则直接写 storage
        let done = false;
        if ((planService as any).updateActivePlanStartDate) {
          try { (planService as any).updateActivePlanStartDate(nextStart); done = true; }
          catch { done = false; }
        }
        if (!done) {
          try {
            const STORAGE_KEY_ACTIVE_PLAN = 'active_plan';
            const raw = wx.getStorageSync(STORAGE_KEY_ACTIVE_PLAN);
            if (raw && typeof raw === 'object') {
              raw.startDate = nextStart;
              wx.setStorageSync(STORAGE_KEY_ACTIVE_PLAN, raw);
            }
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
    return { ok: true, newDate: addDaysLocal(today, 1) };
  } catch (e: any) {
    return { ok: false, reason: e && e.message ? String(e.message) : '模拟失败' };
  }
}

/** 开发工具：重置养成系统（清除 ledger/companion/特别任务跳过/欢迎标记，但不删积分/饮食/体重） */
export function devResetCompanionSystem(): { ok: boolean; reason?: string; cleared: number } {
  if (!isDevelop()) return { ok: false, reason: '仅开发环境', cleared: 0 };
  let cleared = 0;
  const delKeys: string[] = [
    STORAGE_KEY_ENERGY_LEDGER,
    STORAGE_KEY_COMPANION_STATE,
    STORAGE_KEY_COMPANION_INTRO_SHOWN,
    STORAGE_KEY_COMPANION_WELCOME_GIVEN,
    STORAGE_KEY_JOURNEY_CARDS_UNLOCKED_V1,
    STORAGE_KEY_WORLD_UI_STATE,
    STORAGE_KEY_WORLD_DISCOVERIES,
  ];
  for (const k of delKeys) {
    try { wx.removeStorageSync(k); cleared++; } catch { /* ignore */ }
  }
  // 清除"今日特别任务跳过"前缀（只清今日和近期，不做过多扫盘）
  try {
    const today = getTodayString();
    for (let i = -7; i <= 7; i++) {
      const d = addDaysLocal(today, i);
      wx.removeStorageSync(STORAGE_KEY_SPECIAL_TASK_SKIPPED_PREFIX + d);
      cleared++;
    }
  } catch { /* ignore */ }
  return { ok: true, cleared };
}

/** 开发工具：强制解锁旅程卡到指定 day（如 day=28 即解锁全部 5 张） */
export function devUnlockJourneyCardsToDay(planDay: number): { ok: boolean; reason?: string; unlockedCount: number } {
  if (!isDevelop()) return { ok: false, reason: '仅开发环境', unlockedCount: 0 };
  const pdn = Math.max(1, Number(planDay) || 1);
  const unlocked = unlockJourneyCardsForPlanDay(pdn);
  return { ok: true, unlockedCount: unlocked ? unlocked.length : 0 };
}

/** 开发工具：清除旅程卡解锁状态（不影响养成其他部分） */
export function devClearJourneyCards(): { ok: boolean; reason?: string } {
  if (!isDevelop()) return { ok: false, reason: '仅开发环境' };
  try { wx.removeStorageSync(STORAGE_KEY_JOURNEY_CARDS_UNLOCKED_V1); } catch { /* ignore */ }
  return { ok: true };
}

/** 开发工具：当前旅程卡总数（静态），便于 UI 展示 */
export function devJourneyCardsTotal(): number {
  return Array.isArray(JOURNEY_CARDS) ? JOURNEY_CARDS.length : 0;
}
