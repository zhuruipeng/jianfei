/**
 * pointsService.ts
 * 积分 / 完成度 单一计算入口
 *
 * 【V8 规则 6】积分只能有一个统一计算来源。
 *  - 页面**禁止**直接 +10 / +30，也**禁止**读自己本地状态推积分。
 *  - 所有展示/Toast/进度条，都从这里三函数派生。
 *  - 内部实现复用 utils/summary.ts + utils/reward.ts，不重写规则。
 *
 * 【V10 计划快照】所有 ensure* 走 snapshot-aware 入口，保证当日 record 在 plan 存在时
 *  写入目标快照，isTaskCompleted 用 snapshot→plan→常量 的 effective goal 判定。
 */

import { DailyRecord } from '../types/index';
import {
  calculatePoints as _calcPoints,
  calculateCompletionPercent as _calcCompletion,
  calculateTaskListForRecord,
} from '../utils/summary';
import { calculateTotalPoints as _calcTotalPoints } from '../utils/reward';
import {
  ensureTodayRecordWithSnapshot,
  ensureRecordForDateWithSnapshot,
} from './dailyService';

/** 今日获得积分（基于 MealRecord 算，不写死） */
export function calculateDailyPoints(date?: string): number {
  const d = date ? ensureRecordForDateWithSnapshot(date) : ensureTodayRecordWithSnapshot();
  return _calcPoints(d);
}

/** 累计努力积分（遍历 daily_record_* 每日重算，不存累计字段，不扣积分） */
export function calculateTotalPoints(): number {
  return _calcTotalPoints();
}

/** 今日完成度 0~100（整数百分比） */
export function calculateCompletionRate(date?: string): number {
  const d = date ? ensureRecordForDateWithSnapshot(date) : ensureTodayRecordWithSnapshot();
  return _calcCompletion(d);
}

/**
 * 一次性拿"今日完整派生数据"（首页/刷新场景用，减少重复遍历）
 * - 直接返回 DailyRecord（权威状态）避免后续多次 ensureTodayRecord
 *  - 返回字段名 `completed` 与 index 页使用一致
 */
export function calculateTodaySnapshot(date?: string): {
  record: DailyRecord;
  dailyPoints: number;
  completionPercent: number;
  completed: ReturnType<typeof calculateTaskListForRecord>['completed'];
  totalPoints: number;
} {
  const record: DailyRecord = date ? ensureRecordForDateWithSnapshot(date) : ensureTodayRecordWithSnapshot();
  const dailyPoints = _calcPoints(record);
  const completionPercent = _calcCompletion(record);
  const { completed } = calculateTaskListForRecord(record);
  const totalPoints = _calcTotalPoints();
  return { record, dailyPoints, completionPercent, completed, totalPoints };
}
