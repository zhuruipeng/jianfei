// utils/plan.ts - UserPlan 低级 CRUD
//
// 【V10 规则】
//  - 同时只允许一个 active plan：STORAGE_KEY_USER_PLAN 存单个对象（或 null）
//  - 已结束的 plan（completed / stopped）存 STORAGE_KEY_USER_PLAN_HISTORY 数组
//  - 创建新 plan 时：旧 active（若有）移入 history；再写入新 active
//  - 重新开始计划不删旧数据：旧 MealRecord/WeightRecord/Reward/WeeklySummary 全保留（需求二十九）
//  - 同步更新 STORAGE_KEY_FIRST_DATE 为 plan.startDate，保证首页 planDay 计算
//
// 分层约束：本文件只 import types/ 与 utils/date；不 import services/

import {
  UserPlan,
  PlanStatus,
  STORAGE_KEY_USER_PLAN,
  STORAGE_KEY_USER_PLAN_HISTORY,
  STORAGE_KEY_FIRST_DATE,
  EXERCISE_GOAL_OPTIONS,
  WATER_GOAL_OPTIONS,
  GOAL_DAY_OPTIONS,
} from '../types/index';
import { formatDateTimeNow, genLocalId, getTodayString } from './date';

// =========================================================================
// 一、读取
// =========================================================================

function normalizePlan(raw: any): UserPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const durationDays = Number(raw.durationDays);
  if (durationDays !== 7 && durationDays !== 28 && durationDays !== 90) return null;
  const exerciseGoalMinutes = Number(raw.exerciseGoalMinutes);
  const waterGoalCups = Number(raw.waterGoalCups);
  if (!isFinite(exerciseGoalMinutes) || exerciseGoalMinutes <= 0) return null;
  if (!isFinite(waterGoalCups) || waterGoalCups <= 0) return null;
  const status: PlanStatus = (raw.status === 'active' || raw.status === 'completed' || raw.status === 'stopped')
    ? raw.status
    : 'active';
  const startDate = (typeof raw.startDate === 'string' && raw.startDate.length > 0) ? raw.startDate : getTodayString();
  return {
    id: (typeof raw.id === 'string' && raw.id.length > 0) ? raw.id : genLocalId(),
    startDate,
    durationDays,
    exerciseGoalMinutes,
    waterGoalCups,
    startWeight: (typeof raw.startWeight === 'number' && isFinite(raw.startWeight) && raw.startWeight > 0) ? raw.startWeight : undefined,
    targetWeight: (typeof raw.targetWeight === 'number' && isFinite(raw.targetWeight) && raw.targetWeight > 0) ? raw.targetWeight : undefined,
    status,
    createdAt: (typeof raw.createdAt === 'string' && raw.createdAt.length > 0) ? raw.createdAt : formatDateTimeNow(),
    completedAt: (typeof raw.completedAt === 'string' && raw.completedAt.length > 0) ? raw.completedAt : undefined,
    stoppedAt: (typeof raw.stoppedAt === 'string' && raw.stoppedAt.length > 0) ? raw.stoppedAt : undefined,
  };
}

/** 读取当前 active plan（不存在 / status 不是 active 视为 null 兜底） */
export function loadActivePlan(): UserPlan | null {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY_USER_PLAN);
    const plan = normalizePlan(raw);
    if (!plan) return null;
    // 兜底：若 storage 中存的是已结束状态（异常路径），视为无 active
    if (plan.status !== 'active') return null;
    return plan;
  } catch (e) {
    console.error('[Plan] loadActivePlan failed', e);
    return null;
  }
}

/** 读取所有已结束 plan（按 createdAt 升序） */
export function loadPlanHistory(): UserPlan[] {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY_USER_PLAN_HISTORY);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((r: any) => normalizePlan(r))
      .filter((p: UserPlan | null): p is UserPlan => p !== null && p.status !== 'active')
      .sort((a: UserPlan, b: UserPlan) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  } catch (e) {
    console.error('[Plan] loadPlanHistory failed', e);
    return [];
  }
}

/** 读取所有 plan（active + history） */
export function loadAllPlans(): UserPlan[] {
  const active = loadActivePlan();
  const history = loadPlanHistory();
  return active ? [active, ...history] : history;
}

// =========================================================================
// 二、写入
// =========================================================================

export function saveActivePlan(plan: UserPlan | null): boolean {
  try {
    if (plan === null) {
      wx.removeStorageSync(STORAGE_KEY_USER_PLAN);
    } else {
      wx.setStorageSync(STORAGE_KEY_USER_PLAN, plan);
    }
    return true;
  } catch (e) {
    console.error('[Plan] saveActivePlan failed', e);
    return false;
  }
}

export function savePlanHistory(arr: UserPlan[]): boolean {
  try {
    wx.setStorageSync(STORAGE_KEY_USER_PLAN_HISTORY, arr);
    return true;
  } catch (e) {
    console.error('[Plan] savePlanHistory failed', e);
    return false;
  }
}

// =========================================================================
// 三、校验
// =========================================================================

export interface PlanCreateInput {
  durationDays: 7 | 28 | 90;
  exerciseGoalMinutes: number;
  waterGoalCups: number;
  startWeight?: number;
  targetWeight?: number;
  startDate?: string;  // 缺省=今天
}

export function validatePlanInput(input: PlanCreateInput): { ok: boolean; msg: string; plan?: UserPlan } {
  if (!input) return { ok: false, msg: '请填写完整' };
  // durationDays
  const dur = Number(input.durationDays);
  if (!(GOAL_DAY_OPTIONS as readonly number[]).includes(dur)) {
    return { ok: false, msg: '计划周期请选择 7 / 28 / 90 天' };
  }
  // exerciseGoalMinutes
  const ex = Number(input.exerciseGoalMinutes);
  if (!(EXERCISE_GOAL_OPTIONS as readonly number[]).includes(ex)) {
    return { ok: false, msg: '运动目标请选择 15 / 30 / 45 / 60 分钟' };
  }
  // waterGoalCups
  const w = Number(input.waterGoalCups);
  if (!(WATER_GOAL_OPTIONS as readonly number[]).includes(w)) {
    return { ok: false, msg: '喝水目标请选择 6 / 8 / 10 杯' };
  }
  // startWeight / targetWeight 可选；填了要合法
  let startWeight: number | undefined;
  if (input.startWeight !== undefined && input.startWeight !== null && input.startWeight !== ('' as any)) {
    const sw = Number(input.startWeight);
    if (!isFinite(sw) || sw <= 0 || sw > 500) {
      return { ok: false, msg: '当前体重数值不合法' };
    }
    startWeight = Number(sw.toFixed(1));
  }
  let targetWeight: number | undefined;
  if (input.targetWeight !== undefined && input.targetWeight !== null && input.targetWeight !== ('' as any)) {
    const tw = Number(input.targetWeight);
    if (!isFinite(tw) || tw <= 0 || tw > 500) {
      return { ok: false, msg: '目标体重数值不合法' };
    }
    targetWeight = Number(tw.toFixed(1));
  }
  // startDate 缺省今天
  const startDate = (typeof input.startDate === 'string' && input.startDate.length > 0)
    ? input.startDate
    : getTodayString();

  const plan: UserPlan = {
    id: genLocalId(),
    startDate,
    durationDays: dur as 7 | 28 | 90,
    exerciseGoalMinutes: ex,
    waterGoalCups: w,
    startWeight,
    targetWeight,
    status: 'active',
    createdAt: formatDateTimeNow(),
  };
  return { ok: true, msg: '', plan };
}

// =========================================================================
// 四、生命周期操作
// =========================================================================

/**
 * 创建新 plan：
 *  - 若已有 active plan：移到 history（保持原 status；不强行改 stopped）
 *  - 写入新 plan（status='active'）
 *  - 同步更新 STORAGE_KEY_FIRST_DATE 为 plan.startDate（首页 planDay 计算用）
 */
export function createPlan(input: PlanCreateInput): UserPlan {
  const v = validatePlanInput(input);
  if (!v.ok || !v.plan) {
    throw new Error(v.msg || '计划参数不合法');
  }
  const newPlan = v.plan;

  // 1. 旧 active 移入 history（若有）
  const oldActive = loadActivePlan();
  const history = loadPlanHistory();
  if (oldActive) {
    history.push(oldActive);
  }
  savePlanHistory(history);

  // 2. 写入新 active
  saveActivePlan(newPlan);

  // 3. 同步 STORAGE_KEY_FIRST_DATE（首页 planDay / calculatePlanDay 用）
  try {
    wx.setStorageSync(STORAGE_KEY_FIRST_DATE, newPlan.startDate);
  } catch (e) {
    console.warn('[Plan] sync STORAGE_KEY_FIRST_DATE failed', e);
  }

  return newPlan;
}

/** 标记当前 active plan 为 completed（仅当 status==='active' 时；幂等） */
export function markActivePlanCompleted(): UserPlan | null {
  const plan = loadActivePlan();
  if (!plan) return null;
  if (plan.status === 'completed') return plan;
  const updated: UserPlan = {
    ...plan,
    status: 'completed',
    completedAt: formatDateTimeNow(),
  };
  saveActivePlan(updated);
  return updated;
}

/** 标记当前 active plan 为 stopped（幂等） */
export function stopActivePlan(): UserPlan | null {
  const plan = loadActivePlan();
  if (!plan) return null;
  if (plan.status === 'stopped') return plan;
  const updated: UserPlan = {
    ...plan,
    status: 'stopped',
    stoppedAt: formatDateTimeNow(),
  };
  // 停止后：从 active 移到 history（保留旧数据，新计划可创建）
  saveActivePlan(null);
  const history = loadPlanHistory();
  history.push(updated);
  savePlanHistory(history);
  return updated;
}

/** 按 planId 查找（active + history 任一处） */
export function findPlanById(planId: string): UserPlan | null {
  if (!planId || typeof planId !== 'string') return null;
  const all = loadAllPlans();
  return all.find(p => p.id === planId) || null;
}
