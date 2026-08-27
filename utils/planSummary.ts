// utils/planSummary.ts - 28/90 天计划总结聚合
//
// 【V10 规则】
//  - 汇总某 plan 的所有 weekly summaries + 尾段（如 90 天 plan 多出 6 天）实时计算
//  - 禁止评分 / 羞辱文案：只用"认真记录 N/M 天""累计饮食记录 X 餐"等温和描述
//  - 体重变化：从 plan.startDate 当天/之前最近一条 → plan 末日内最近一条

import {
  UserPlan,
  WeeklySummary,
  PLAN_SUMMARY_MESSAGES,
} from '../types/index';
import { loadAllWeeklySummaries, getPlanWeekCount, buildWeekRange, computeWeeklySummary } from './weeklySummary';
import { loadWeightRecords, sortWeightRecordsByDateAsc } from './weight';
import { pickRandom } from './date';

export interface PlanTailAggregate {
  days: number;
  meaningfulDays: number;
  mealCount: number;
  pointsEarned: number;
}

export interface PlanSummaryAggregate {
  plan: UserPlan;
  weeks: WeeklySummary[];                 // 按 weekNumber 升序
  totalMeaningfulDays: number;            // sum weeks.meaningfulDays + tail.meaningfulDays
  totalMealCount: number;
  totalBreakfastCount: number;
  totalLunchCount: number;
  totalDinnerCount: number;
  totalExerciseGoalDays: number;
  totalWaterGoalDays: number;
  totalPointsEarned: number;
  totalRewardsUnlocked: number;
  totalRewardsRedeemed: number;
  totalAiAnalysisCount: number;
  weightStart?: number;                   // plan.startDate 当天/之前最近一条
  weightEnd?: number;                     // plan 末日内最近一条
  weightChange?: number;                  // 都有才有
  message: string;                         // 从 PLAN_SUMMARY_MESSAGES 随机
  isCompleted: boolean;
  /** 尾段（90 天 plan 多出 6 天）；7/28 天 plan 为 undefined */
  tail?: PlanTailAggregate;
}

/** 计算某 plan 的尾段（90 天 plan 多出 6 天：Day85-Day90） */
function computePlanTail(plan: UserPlan): PlanTailAggregate | undefined {
  if (!plan) return undefined;
  const totalWeeks = getPlanWeekCount(plan);
  const tailDays = plan.durationDays - totalWeeks * 7;
  if (tailDays <= 0) return undefined;

  // 尾段区间：startDate + totalWeeks*7 ~ startDate + durationDays - 1
  const tailStart = addDays(plan.startDate, totalWeeks * 7);
  const tailEnd = addDays(plan.startDate, plan.durationDays - 1);

  // 复用 computeWeeklySummary 思路，但它要求 weekNumber；这里直接 inline 计算
  //  - 简化：直接计算 days / meaningfulDays / mealCount / pointsEarned
  //  - 为避免重复逻辑，我们临时构造一个"虚拟 weekNumber=totalWeeks+1"调用 computeWeeklySummary
  //    但 computeWeeklySummary 会校验 weekNumber ≤ getPlanWeekCount 返回 null，所以不能这么用
  //  → 改为直接调 computeRangeAggregate
  const agg = computeRangeAggregate(plan, tailStart, tailEnd);
  return {
    days: tailDays,
    meaningfulDays: agg.meaningfulDays,
    mealCount: agg.mealCount,
    pointsEarned: agg.pointsEarned,
  };
}

/** 内部：计算任意区间 [start, end] 的 meaningfulDays / mealCount / pointsEarned（用于尾段） */
function computeRangeAggregate(plan: UserPlan, startDate: string, endDate: string): {
  meaningfulDays: number;
  mealCount: number;
  pointsEarned: number;
} {
  // 90 天 plan 有 6 天尾段（Day85-Day90），不足一周。
  // 临时构造一个"放大版"plan，让尾段成为一个完整周区间，复用 computeWeeklySummary 的区间聚合逻辑。
  // fakePlan 仅用于 buildWeekRange 计算区间，不会写入 storage。
  const totalWeeks = getPlanWeekCount(plan);
  const fakeWeekNumber = totalWeeks + 1;
  const fakePlan: UserPlan = {
    ...plan,
    // 放大 durationDays 使 getPlanWeekCount(fakePlan) = totalWeeks + 1，让 buildWeekRange 接受 fakeWeekNumber
    durationDays: (totalWeeks * 7 + 7) as 7 | 28 | 90,
  };
  const ws = computeWeeklySummary(fakePlan, fakeWeekNumber);
  if (!ws) {
    return { meaningfulDays: 0, mealCount: 0, pointsEarned: 0 };
  }
  return {
    meaningfulDays: ws.meaningfulDays,
    mealCount: ws.mealCount,
    pointsEarned: ws.pointsEarned,
  };
}

function addDays(dateStr: string, days: number): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0, 0);
  if (isNaN(d.getTime())) return dateStr;
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 汇总某 plan 的所有 weekly summaries + 尾段（如 90 天 plan 的最后 6 天）
 *  - weekly summaries 从 storage 读已生成快照（不重算，保证不漂移）
 *  - 尾段实时计算（不存快照，因为尾段不足 7 天）
 *  - 体重变化从 WeightRecord 全量记录按 plan 区间首末取
 */
export function computePlanSummary(plan: UserPlan): PlanSummaryAggregate {
  const totalWeeks = getPlanWeekCount(plan);
  const allSummaries = loadAllWeeklySummaries().filter(s => s.planId === plan.id);
  const weeks = allSummaries
    .filter(s => s.weekNumber >= 1 && s.weekNumber <= totalWeeks)
    .sort((a, b) => a.weekNumber - b.weekNumber);

  // 汇总各字段
  let totalMeaningfulDays = 0;
  let totalMealCount = 0;
  let totalBreakfastCount = 0;
  let totalLunchCount = 0;
  let totalDinnerCount = 0;
  let totalExerciseGoalDays = 0;
  let totalWaterGoalDays = 0;
  let totalPointsEarned = 0;
  let totalRewardsUnlocked = 0;
  let totalRewardsRedeemed = 0;
  let totalAiAnalysisCount = 0;
  for (const w of weeks) {
    totalMeaningfulDays += w.meaningfulDays;
    totalMealCount += w.mealCount;
    totalBreakfastCount += w.breakfastCount;
    totalLunchCount += w.lunchCount;
    totalDinnerCount += w.dinnerCount;
    totalExerciseGoalDays += w.exerciseGoalDays;
    totalWaterGoalDays += w.waterGoalDays;
    totalPointsEarned += w.pointsEarned;
    totalRewardsUnlocked += w.rewardsUnlocked;
    totalRewardsRedeemed += w.rewardsRedeemed;
    totalAiAnalysisCount += w.aiAnalysisCount;
  }

  // 尾段（90 天 plan 多出 6 天）
  const tail = computePlanTail(plan);
  if (tail) {
    totalMeaningfulDays += tail.meaningfulDays;
    totalMealCount += tail.mealCount;
    totalPointsEarned += tail.pointsEarned;
  }

  // 体重变化：plan.startDate 当天/之前最近一条 → plan 末日内最近一条
  const planEnd = addDays(plan.startDate, plan.durationDays - 1);
  const allWeights = sortWeightRecordsByDateAsc(loadWeightRecords());
  const beforeOrAtStart = allWeights.filter(w => w.date <= plan.startDate);
  const inPlanRange = allWeights.filter(w => w.date >= plan.startDate && w.date <= planEnd);
  let weightStart: number | undefined;
  let weightEnd: number | undefined;
  let weightChange: number | undefined;
  if (beforeOrAtStart.length > 0) {
    weightStart = beforeOrAtStart[beforeOrAtStart.length - 1].weight;
  } else if (inPlanRange.length > 0) {
    weightStart = inPlanRange[0].weight;
  }
  if (inPlanRange.length > 0) {
    weightEnd = inPlanRange[inPlanRange.length - 1].weight;
  }
  if (weightStart !== undefined && weightEnd !== undefined) {
    weightChange = Number((weightEnd - weightStart).toFixed(1));
  }

  return {
    plan,
    weeks,
    totalMeaningfulDays,
    totalMealCount,
    totalBreakfastCount,
    totalLunchCount,
    totalDinnerCount,
    totalExerciseGoalDays,
    totalWaterGoalDays,
    totalPointsEarned,
    totalRewardsUnlocked,
    totalRewardsRedeemed,
    totalAiAnalysisCount,
    weightStart,
    weightEnd,
    weightChange,
    message: pickRandom(PLAN_SUMMARY_MESSAGES),
    isCompleted: plan.status === 'completed',
    tail,
  };
}
