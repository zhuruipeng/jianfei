/**
 * services/companionService.ts - V12 养成模块薄封装
 *
 * 负责：
 *   - 每日完成的 3 任务 -> 调用 awardEnergy 发能量（幂等防重）
 *   - 完成全部 3 任务 -> 额外 20 bonus
 *   - 特别任务完成 / 跳过
 *   - 伙伴初始化 + 旧用户欢迎卡 +50
 *   - 升级检测 + 称号解锁 + 埋点
 */

import {
  DAILY_TASK_CONFIG,
  STORAGE_KEY_COMPANION_INTRO_SHOWN,
  STORAGE_KEY_COMPANION_WELCOME_GIVEN,
  COMPANION_DAILY_MSGS,
  GROWTH_CONFIG,
  JourneyCard,
  UnlockedJourneyCardState,
  COMPANION_USAGE_EVENTS_EX,
} from '../types/index';

import { getTodayString, pickRandom, addDaysLocal } from '../utils/date';
import {
  awardEnergy,
  calculateTotalEnergy,
  loadEnergyLedger,
} from '../utils/energy';
import {
  computeLevelByEnergy,
  createDefaultCompanion,
  loadCompanionState,
  saveCompanionState,
  unlockTitleByLevel,
  updateCompanionAfterLevelUp,
  computeMoodByCompletedTasks,
  unlockJourneyCardsForPlanDay,
  loadUnlockedJourneyCards,
} from '../utils/companion';
import {
  computeDailyTasksForDate,
  isDailyAllCompleteBonusAwarded,
  isSpecialTaskEnergyAwarded,
  markSpecialTaskSkipped,
} from '../utils/dailyTasks';
import {
  pickOpening0Message,
  pickWelcomeBackMessage,
  pickStableMessage,
  moodByCompletedCount,
} from '../utils/companionMessages';
import * as usageService from './usageService';
import {
  CompanionEventName,
  COMPANION_USAGE_EVENTS,
  CompanionEventNameV2,
} from '../types/index';

// ---------------- 埋点小包装（事件名不在 USAGE_EVENT_NAMES 枚举里，但仍走 UsageEvent 结构保存） ----------------
function _trackCompanionEvent(name: CompanionEventNameV2, metadata?: any): void {
  try {
    // usageService.trackEvent 的类型签名限制 eventName，但运行时接受字符串，这里做 as any 放行
    (usageService as any).trackEvent(name, metadata);
  } catch { /* ignore */ }
}

// ================================================================
// 旧用户 / 新用户初始化
// ================================================================

/**
 * 首页打开时判断是否需要显示欢迎卡 + 创建伙伴。
 *   - 首次使用（无 any 历史记录 + 无 meal/weight 数据）-> 不强制显示欢迎，等用户创建 plan 再说（暂不）
 *   - 已有使用记录但无 companionState -> 旧用户升级：显示欢迎卡 + 一次性 +50 能量
 *
 * 返回：
 *   showIntro: 是否弹出欢迎卡（首页决定）
 *   state: 当前伙伴（可能已存在，也可能刚创建）
 *   welcomeGiven: 本次是否已发过 +50
 */
export function ensureCompanionAndMaybeWelcome(): {
  showIntro: boolean;
  welcomeBonusGivenNow: boolean;
} {
  let state = loadCompanionState();
  let showIntro = false;
  let welcomeGivenNow = false;

  if (!state) {
    // 旧用户：不存在 companion -> 认为是升级；新用户第一次打开也不存在 companion，但 welcome 给 +50 不影响体验
    state = createDefaultCompanion();
    showIntro = true;
    try { wx.setStorageSync(STORAGE_KEY_COMPANION_INTRO_SHOWN, true); } catch { /* ignore */ }
    _trackCompanionEvent(COMPANION_USAGE_EVENTS.COMPANION_CREATED as any, { hasAnyHistory: 'unknown' });
  }

  // 一次性 +50 欢迎能量（防止自动补发历史能量导致直接 Lv.7）
  try {
    const already = wx.getStorageSync(STORAGE_KEY_COMPANION_WELCOME_GIVEN) === true;
    if (!already) {
      const date = getTodayString();
      const r = awardEnergy({
        date,
        source: 'growth_bonus',
        sourceId: 'welcome_v1',
        amount: 50,
      });
      if (r.ok && r.created) {
        try { wx.setStorageSync(STORAGE_KEY_COMPANION_WELCOME_GIVEN, true); } catch { /* ignore */ }
        welcomeGivenNow = true;
        _trackCompanionEvent(COMPANION_USAGE_EVENTS.ENERGY_EARNED as any, {
          amount: 50,
          source: 'growth_bonus',
          sourceId: 'welcome_v1',
        });
      }
    }
  } catch (e) {
    console.warn('[companion] welcome bonus failed', e);
  }

  // 创建后同步：检测是否有新称号（Lv.1 称号也可能还没解锁）
  try {
    const totalE = calculateTotalEnergy();
    const lv = computeLevelByEnergy(totalE);
    for (let l = 1; l <= lv; l++) unlockTitleByLevel(l);
  } catch { /* ignore */ }

  return { showIntro, welcomeBonusGivenNow: welcomeGivenNow };
}

// ---------------- 用户点了欢迎卡的"我知道了"后标记 ----------------
export function markIntroDismissed(): void {
  try { wx.setStorageSync(STORAGE_KEY_COMPANION_INTRO_SHOWN, true); } catch { /* ignore */ }
}
export function isIntroShown(): boolean {
  try { return wx.getStorageSync(STORAGE_KEY_COMPANION_INTRO_SHOWN) === true; } catch { return false; }
}

// ================================================================
// 能量发放：3 任务完成 -> 发能量 + 检测升级
// ================================================================

export interface GrantDailyTasksResult {
  newlyAwarded: { key: string; amount: number }[];   // 本次新发放的任务奖励
  bonusAwarded: boolean;                              // 是否新发放了全完成 bonus (+20)
  levelUp: { from: number; to: number } | null;       // 升级信息（无则 null）
  newlyUnlockedTitles: string[];                      // 新解锁的称号
}

/**
 * 检查当日 3 任务是否有新完成并发放能量（幂等）。
 *
 * 调用时机：
 *   - 首页 refreshAll 每次刷新前调用一次
 *   - 用户保存了 MealRecord / 运动 / 喝水后调用一次
 *
 * 不做重复发放。
 */
export function grantEnergyForCompletedDailyTasks(date?: string): GrantDailyTasksResult {
  const d = date || getTodayString();
  const newlyAwarded: { key: string; amount: number }[] = [];

  const tasks = computeDailyTasksForDate(d);

  // 1) 单条奖励
  for (const t of tasks) {
    if (!t.completed) continue;
    if (t.energyAwarded) continue; // 已发放过
    const r = awardEnergy({
      date: d,
      source: 'daily_task',
      sourceId: t.key,
      amount: t.amount,
    });
    if (r.ok && r.created) {
      newlyAwarded.push({ key: t.key, amount: t.amount });
      _trackCompanionEvent(COMPANION_USAGE_EVENTS.ENERGY_EARNED as any, {
        amount: t.amount,
        source: 'daily_task',
        sourceId: t.key,
      });
    }
  }

  // 2) 3 条全完成 bonus（如果没发过）
  let bonusAwarded = false;
  const allDone = tasks.every((t) => t.completed);
  if (allDone && !isDailyAllCompleteBonusAwarded(d)) {
    const bonus = (DAILY_TASK_CONFIG[0] && DAILY_TASK_CONFIG[0].allCompleteBonus) || 20;
    const r = awardEnergy({
      date: d,
      source: 'daily_all_complete',
      sourceId: d,
      amount: bonus,
    });
    if (r.ok && r.created) {
      bonusAwarded = true;
      _trackCompanionEvent(COMPANION_USAGE_EVENTS.ENERGY_EARNED as any, {
        amount: bonus,
        source: 'daily_all_complete',
        sourceId: d,
      });
    }
  }

  // 3) 检测总能量变化 -> 升级
  const { from, to } = _detectLevelUp();
  const newlyUnlockedTitles: string[] = [];
  if (to && from !== to) {
    for (let l = (from || 0) + 1; l <= to; l++) {
      const unlocked = unlockTitleByLevel(l);
      if (unlocked) newlyUnlockedTitles.push(unlocked);
    }
    updateCompanionAfterLevelUp(to);
    _trackCompanionEvent(COMPANION_USAGE_EVENTS.COMPANION_LEVEL_UP as any, {
      newLevel: to,
      energyTotal: calculateTotalEnergy(),
    });
  }

  return {
    newlyAwarded,
    bonusAwarded,
    levelUp: (from && to && from !== to) ? { from, to } : null,
    newlyUnlockedTitles,
  };
}

/**
 * 计算升级：
 *   当前 totalEnergy -> 目标等级；对比 CompanionState.lastKnownLevel（或 1）。
 */
function _detectLevelUp(): { from: number; to: number } {
  const state = loadCompanionState();
  const from = state && typeof state.lastKnownLevel === 'number' ? state.lastKnownLevel : 1;
  const totalE = calculateTotalEnergy(loadEnergyLedger());
  const to = Math.max(1, computeLevelByEnergy(totalE));
  return { from, to };
}

// ================================================================
// 特别任务完成 / 跳过
// ================================================================

export interface CompleteSpecialTaskResult {
  awarded: boolean;
  existed: boolean;
  amount: number;
  levelUp: { from: number; to: number } | null;
  newlyUnlockedTitles: string[];
}

/** 用户点"我完成了"特别任务 -> 发能量（同一天同一 date 只一次） */
export function completeSpecialTask(date?: string, amount?: number): CompleteSpecialTaskResult {
  const d = date || getTodayString();
  if (isSpecialTaskEnergyAwarded(d)) {
    return {
      awarded: false, existed: true,
      amount: 0,
      levelUp: null, newlyUnlockedTitles: [],
    };
  }
  const amt = Number(amount) && Number(amount) > 0 ? Math.round(Number(amount)) : 30;
  const r = awardEnergy({ date: d, source: 'special_task', sourceId: d, amount: amt });
  if (!r.ok || !r.created) {
    return {
      awarded: false, existed: !!r.existed,
      amount: 0,
      levelUp: null, newlyUnlockedTitles: [],
    };
  }
  _trackCompanionEvent(COMPANION_USAGE_EVENTS.SPECIAL_TASK_COMPLETED as any, { amount: amt });
  _trackCompanionEvent(COMPANION_USAGE_EVENTS.ENERGY_EARNED as any, {
    amount: amt,
    source: 'special_task',
    sourceId: d,
  });
  // 升级检测
  const { from, to } = _detectLevelUp();
  const newlyUnlockedTitles: string[] = [];
  if (from !== to) {
    for (let l = from + 1; l <= to; l++) {
      const unlocked = unlockTitleByLevel(l);
      if (unlocked) newlyUnlockedTitles.push(unlocked);
    }
    updateCompanionAfterLevelUp(to);
    _trackCompanionEvent(COMPANION_USAGE_EVENTS.COMPANION_LEVEL_UP as any, {
      newLevel: to,
      energyTotal: calculateTotalEnergy(),
    });
  }
  return {
    awarded: true, existed: false,
    amount: amt,
    levelUp: (from !== to) ? { from, to } : null,
    newlyUnlockedTitles,
  };
}

/** 用户点"今天不做这个"特别任务 -> 标记跳过（不扣能量不扣积分） */
export function skipSpecialTask(date?: string): void {
  const d = date || getTodayString();
  markSpecialTaskSkipped(d);
}

// ================================================================
// 其它轻量 API
// ================================================================

/** 今日完成的任务数（0~3），决定小轻文案 */
export function countCompletedDailyTasks(date?: string): 0 | 1 | 2 | 3 {
  const tasks = computeDailyTasksForDate(date || getTodayString());
  let n = 0;
  for (const t of tasks) if (t.completed) n++;
  return (n > 3 ? 3 : n) as 0 | 1 | 2 | 3;
}

/** 按完成数随机选一条温和文案 */
export function pickCompanionDailyMessage(count: 0 | 1 | 2 | 3): string {
  const bucket = COMPANION_DAILY_MSGS[String(count) as '0' | '1' | '2' | '3'];
  return pickRandom(bucket);
}

/** journey_viewed 埋点 */
export function trackJourneyViewed(planDay: number, hasPlan: boolean): void {
  _trackCompanionEvent(COMPANION_USAGE_EVENTS.JOURNEY_VIEWED as any, {
    planDay: Number(planDay) || 0,
    hasPlan: !!hasPlan,
  });
}

// ================================================================
// V12.1：今日问候文案（含"欢迎回归昨天没完成"，不指责）
// ================================================================

/**
 * 计算昨天完成了几个 3 任务（≥1 返回 false 表示昨天有行动；=0 或无法确定但真的没任何记录=return true 表示昨天空闲）。
 * 注意：
 *   - 只用于选择 welcome back 文案，不做任何"惩罚"。
 *   - 即使昨天没完成，也不扣能量/等级/掉卡，文案只体现"昨天已经过去啦"。
 */
export function hadNoCompletedActionsYesterday(): boolean {
  try {
    const yesterday = addDaysLocal(getTodayString(), -1);
    if (!yesterday) return false;
    const tasks = computeDailyTasksForDate(yesterday);
    return tasks.every((t) => !t.completed);
  } catch {
    return false;
  }
}

export interface CompanionOpeningMessage {
  message: string;
  /** 是否使用"欢迎回归昨天没完成"文案（用于首页温和提示） */
  isWelcomeBack: boolean;
  /** 文案稳定标识（便于调试） */
  bucket: 'welcome_back' | 'opening_0' | 'completed_123';
}

/**
 * 首页展示的第一条角色文案。
 *
 * 规则：
 *   - completedCount = 0 且"昨天没任何 3 任务完成" → 欢迎回归文案（温和）
 *   - 其他 completedCount = 0 → opening 0 文案
 *   - completedCount 1/2/3 → 使用 DAILY_MSGS 桶，但用日期稳定取一条（而不是真正随机跳）
 */
export function pickCompanionOpeningMessage(
  date: string,
  completedCount: 0 | 1 | 2 | 3,
): CompanionOpeningMessage {
  if (completedCount === 0) {
    const y = hadNoCompletedActionsYesterday();
    if (y) {
      return {
        message: pickWelcomeBackMessage(date),
        isWelcomeBack: true,
        bucket: 'welcome_back',
      };
    }
    return {
      message: pickOpening0Message(date),
      isWelcomeBack: false,
      bucket: 'opening_0',
    };
  }
  // 1 / 2 / 3：用日期稳定挑 DAILY_MSGS 里的一条
  const bucket = COMPANION_DAILY_MSGS[String(completedCount) as '0' | '1' | '2' | '3'];
  const arr = Array.isArray(bucket) ? bucket : [];
  return {
    message: pickStableMessage(date, `daily_${completedCount}`, arr, ''),
    isWelcomeBack: false,
    bucket: 'completed_123',
  };
}

// ================================================================
// V12.1：旅程收藏卡解锁 + 埋点
// ================================================================

/** 给 planDay 解锁当前应解锁的旅程卡（幂等）。返回本次新解锁的卡（用于升级弹层展示）。 */
export function ensureJourneyCardsUnlocked(planDay: number): {
  newlyUnlocked: { card: JourneyCard; state: UnlockedJourneyCardState }[];
  allUnlockedMap: Record<string, UnlockedJourneyCardState>;
} {
  const newly = unlockJourneyCardsForPlanDay(planDay);
  if (newly && newly.length > 0) {
    for (const n of newly) {
      _trackCompanionEvent(COMPANION_USAGE_EVENTS_EX.JOURNEY_CARD_UNLOCKED as any, {
        cardId: n.card.id,
        planDay: Number(planDay) || 0,
      });
    }
  }
  return { newlyUnlocked: newly, allUnlockedMap: loadUnlockedJourneyCards() };
}

export function trackJourneyCardViewed(cardId: string): void {
  _trackCompanionEvent(COMPANION_USAGE_EVENTS_EX.JOURNEY_CARD_VIEWED as any, { cardId: String(cardId || '') });
}

// ================================================================
// V12.1：点击角色冷却控制（2s 内只响应 1 次；只有有效响应才记埋点）
// ================================================================

let _lastTapAtMs = 0;
const COMPANION_TAP_COOLDOWN_MS = 2000;

/**
 * 点击角色冷却。
 *   - 冷却通过 -> return { ok:true, cooldownMs } 记埋点
 *   - 冷却期内 -> return { ok:false, remainMs } 不响应
 * 不做复杂抚摸/喂食/状态值。
 */
export function tryFireCompanionTap(): { ok: boolean; cooldownMs: number; remainMs: number } {
  const now = Date.now();
  const remain = _lastTapAtMs ? Math.max(0, COMPANION_TAP_COOLDOWN_MS - (now - _lastTapAtMs)) : 0;
  if (remain > 0) return { ok: false, cooldownMs: COMPANION_TAP_COOLDOWN_MS, remainMs: remain };
  _lastTapAtMs = now;
  _trackCompanionEvent(COMPANION_USAGE_EVENTS_EX.COMPANION_TAPPED as any, {});
  return { ok: true, cooldownMs: COMPANION_TAP_COOLDOWN_MS, remainMs: 0 };
}

// 同时导出 mood 计算（utils 层也有，service 做一层转发，便于页面少 import）
export const _forwardMoodByCompletedCount = moodByCompletedCount;
export const _forwardComputeMoodByCompletedTasks = computeMoodByCompletedTasks;

/**
 * 给页面旅程卡网格用：返回 { id → {unlocked, unlockedAt, planDayWhenUnlocked} }。
 * 把底层 Record<string, UnlockedJourneyCardState> 做一层字段语义化，便于页面不关心 state.shape。
 */
export function readJourneyCardsUnlockedStateById(): Record<
  string,
  { unlocked: boolean; unlockedAt?: string; planDayWhenUnlocked?: number }
> {
  const raw = loadUnlockedJourneyCards();
  const out: Record<string, { unlocked: boolean; unlockedAt?: string; planDayWhenUnlocked?: number }> = {};
  if (!raw) return out;
  const keys = Object.keys(raw);
  for (const k of keys) {
    const v = (raw as any)[k] as UnlockedJourneyCardState | undefined;
    if (!v) continue;
    out[k] = {
      unlocked: true,
      unlockedAt: v.unlockedAt ? String(v.unlockedAt) : undefined,
      planDayWhenUnlocked: typeof v.planDayWhenUnlocked === 'number' ? v.planDayWhenUnlocked : undefined,
    };
  }
  return out;
}
