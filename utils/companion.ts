/**
 * utils/companion.ts - V12 伙伴状态 + 成长计算
 *
 * 等级 = 动态根据 totalEnergy 计算（唯一权威来源 = energy ledger）。
 * CompanionState 只存"用户起名/称号解锁/最近升级时间"这类展示信息。
 */

import {
  STORAGE_KEY_COMPANION_STATE,
  COMPANION_DEFAULT_NAME,
  COMPANION_NAME_MAX_LEN,
  GROWTH_CONFIG,
  CompanionState,
  GrowthLevel,
  CompanionVisualStage,
  VISUAL_STAGE_NUMBER_TO_KEY,
  STORAGE_KEY_JOURNEY_CARDS_UNLOCKED_V1,
  JOURNEY_CARDS,
  JourneyCard,
  UnlockedJourneyCardState,
  CompanionMood,
} from '../types/index';
import { formatDateTimeNow, genLocalId } from './date';
import { calculateTotalEnergy } from './energy';

// ================================================================
// 基础 CRUD
// ================================================================

export function loadCompanionState(): CompanionState | null {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY_COMPANION_STATE);
    if (!raw || typeof raw !== 'object') return null;
    return normalizeCompanion(raw);
  } catch (e) {
    console.error('[companion] loadCompanionState failed', e);
    return null;
  }
}

export function saveCompanionState(state: CompanionState): void {
  try {
    wx.setStorageSync(STORAGE_KEY_COMPANION_STATE, state);
  } catch (e) {
    const err = new Error('伙伴状态保存失败');
    (err as any).cause = e;
    throw err;
  }
}

export function normalizeCompanion(raw: any): CompanionState | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.companionId === 'string' && raw.companionId.length > 0
    ? raw.companionId
    : 'c_001';
  let name = typeof raw.name === 'string' ? raw.name.trim() : COMPANION_DEFAULT_NAME;
  if (!name) name = COMPANION_DEFAULT_NAME;
  if (name.length > COMPANION_NAME_MAX_LEN) name = name.slice(0, COMPANION_NAME_MAX_LEN);
  const createdAt = (typeof raw.createdAt === 'string' && raw.createdAt.length > 0)
    ? raw.createdAt
    : formatDateTimeNow();
  const titles = Array.isArray(raw.unlockedTitles)
    ? raw.unlockedTitles.filter((x: any) => typeof x === 'string' && x.length > 0)
    : [];
  return {
    companionId: id,
    name,
    createdAt,
    unlockedTitles: titles,
    lastLevelUpAt: (raw.lastLevelUpAt && typeof raw.lastLevelUpAt === 'string') ? raw.lastLevelUpAt : undefined,
    lastKnownLevel: (typeof raw.lastKnownLevel === 'number' && isFinite(raw.lastKnownLevel)) ? raw.lastKnownLevel : undefined,
  };
}

/** 新建默认伙伴（仅在首次 welcome 流程中调用） */
export function createDefaultCompanion(): CompanionState {
  const state: CompanionState = {
    companionId: `c_${genLocalId().slice(2)}`,
    name: COMPANION_DEFAULT_NAME,
    createdAt: formatDateTimeNow(),
    unlockedTitles: [],
    lastLevelUpAt: undefined,
    lastKnownLevel: undefined,
  };
  saveCompanionState(state);
  return state;
}

/** 更新 lastKnownLevel + lastLevelUpAt（升级弹层后调用） */
export function updateCompanionAfterLevelUp(newLevel: number): CompanionState {
  const cur = loadCompanionState();
  if (!cur) {
    const created = createDefaultCompanion();
    created.lastKnownLevel = newLevel;
    created.lastLevelUpAt = formatDateTimeNow();
    saveCompanionState(created);
    return created;
  }
  const updated: CompanionState = {
    ...cur,
    lastKnownLevel: newLevel,
    lastLevelUpAt: formatDateTimeNow(),
  };
  saveCompanionState(updated);
  return updated;
}

/** 解锁称号（按等级） */
export function unlockTitleByLevel(level: number): string | null {
  const g = GROWTH_CONFIG.find((x) => x.level === level);
  if (!g || !g.title) return null;
  const cur = loadCompanionState();
  if (!cur) return null;
  if (cur.unlockedTitles.indexOf(g.title) >= 0) return null;
  const next = { ...cur, unlockedTitles: cur.unlockedTitles.concat([g.title]) };
  saveCompanionState(next);
  return g.title;
}

// ================================================================
// 等级、下一等级、视觉阶段（全部按 totalEnergy 动态计算）
// ================================================================

/**
 * 计算累计能量对应的当前等级（1~7）。
 *   规则：找到最大的 requiredEnergy <= totalEnergy 的等级。
 */
export function computeLevelByEnergy(totalEnergy: number): number {
  const safe = isFinite(totalEnergy) && totalEnergy >= 0 ? totalEnergy : 0;
  let level = 1;
  for (const g of GROWTH_CONFIG) {
    if (safe >= g.requiredEnergy) level = g.level;
  }
  return level;
}

export function computeGrowthLevel(totalEnergy: number): GrowthLevel {
  const lv = computeLevelByEnergy(totalEnergy);
  return GROWTH_CONFIG.find((g) => g.level === lv) || GROWTH_CONFIG[0];
}

/** 当前等级对应所需能量（下限） */
export function getCurrentLevelFloorEnergy(totalEnergy: number): number {
  return computeGrowthLevel(totalEnergy).requiredEnergy;
}

/** 下一级所需能量；已到顶返回 null */
export function getNextLevel(totalEnergy: number): GrowthLevel | null {
  const lv = computeLevelByEnergy(totalEnergy);
  const next = GROWTH_CONFIG.find((g) => g.level === lv + 1) || null;
  return next;
}

/**
 * 到下一等级还需要多少能量。
 *   - 已到顶返回 null
 *   - 否则返回 "下一等级 requiredEnergy - totalEnergy"
 */
export function getEnergyToNextLevel(totalEnergy: number): number | null {
  const next = getNextLevel(totalEnergy);
  if (!next) return null;
  const remain = next.requiredEnergy - (isFinite(totalEnergy) ? totalEnergy : 0);
  return remain > 0 ? remain : 0;
}

/** 当前等级 ~ 下一等级之间的完成度（0~100）；到顶 = 100 */
export function computeLevelProgressPercent(totalEnergy: number): number {
  const safe = isFinite(totalEnergy) ? totalEnergy : 0;
  const floor = getCurrentLevelFloorEnergy(safe);
  const next = getNextLevel(safe);
  if (!next) return 100;
  const span = next.requiredEnergy - floor;
  if (span <= 0) return 100;
  const p = ((safe - floor) / span) * 100;
  return Math.max(0, Math.min(100, Math.round(p)));
}

// ================================================================
// 视觉阶段（首页小轻形象）：1~4 对应 4 套素材
// ================================================================
export function computeVisualStage(totalEnergy: number): 1 | 2 | 3 | 4 {
  return computeGrowthLevel(totalEnergy).visualStage;
}

// ================================================================
// 旧用户/新用户统一"当前总能量"读取（供各处复用）
// ================================================================
export function getTotalEnergySafe(): number {
  return calculateTotalEnergy();
}

// ================================================================
// V12.1：视觉阶段（文字枚举 seed/baby/growing/grown）与情绪
// ================================================================

/**
 * 视觉阶段文字版（L1=seed, L2~3=baby, L4~5=growing, L6~7=grown）。
 *   - 兼容：旧版 visualStage（1|2|3|4）继续可通过 VISUAL_STAGE_NUMBER_TO_KEY 映射。
 *   - 调用方：UI 用文字枚举直接去 companionAssets 查素材。
 */
export function computeVisualStageKey(totalEnergy: number): CompanionVisualStage {
  const num = computeVisualStage(totalEnergy);
  return VISUAL_STAGE_NUMBER_TO_KEY[num] || 'seed';
}

/** 从旧的 numeric stage 直接转文字（兼容已存在的调用点） */
export function visualStageNumberToKey(num: 1 | 2 | 3 | 4): CompanionVisualStage {
  return VISUAL_STAGE_NUMBER_TO_KEY[num] || 'seed';
}

/**
 * 情绪判断逻辑（需求第五条）：
 *   0/3 → encouraging
 *   1/3 → neutral
 *   2/3 → neutral
 *   3/3 → happy
 *
 * 注意：
 *   - "刚刚升级"、"刚刚完成任务"的临时 happy 由页面层在 UI transient overlay 中覆盖（≈1.5~3s）
 *     不写进这个函数（否则第二天会继续显示旧 happy）。
 */
export function computeMoodByCompletedTasks(completedCount: 0 | 1 | 2 | 3): CompanionMood {
  if (completedCount === 3) return 'happy';
  if (completedCount === 0) return 'encouraging';
  return 'neutral';
}

// ================================================================
// V12.1：旅程收藏卡解锁
//
// 存储：journey_cards_unlocked_v1 = { [cardId]: UnlockedJourneyCardState }
//   不存静态文本，只存"已解锁 + unlockedAt"。
// ================================================================

export function loadUnlockedJourneyCards(): Record<string, UnlockedJourneyCardState> {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY_JOURNEY_CARDS_UNLOCKED_V1);
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, UnlockedJourneyCardState> = {};
    for (const k of Object.keys(raw)) {
      const v = raw[k];
      if (!v || typeof v !== 'object') continue;
      out[k] = {
        id: typeof v.id === 'string' ? v.id : k,
        unlockedAt: typeof v.unlockedAt === 'string' ? v.unlockedAt : formatDateTimeNow(),
        planDayWhenUnlocked: Number(v.planDayWhenUnlocked) || 0,
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function saveUnlockedJourneyCards(map: Record<string, UnlockedJourneyCardState>): void {
  try { wx.setStorageSync(STORAGE_KEY_JOURNEY_CARDS_UNLOCKED_V1, map || {}); } catch { /* ignore */ }
}

/**
 * 按当前 planDay 检查是否有新的里程碑卡应解锁。
 * 返回本次新解锁的卡片（用于升级弹层显示"还获得了一张新的旅程卡"）。
 *   - planDay <= 0 时什么都不解锁（安全兜底）。
 *   - 已解锁则不会重复 unlockedAt。
 */
export function unlockJourneyCardsForPlanDay(
  planDay: number,
): { card: JourneyCard; state: UnlockedJourneyCardState }[] {
  const safeDay = Number(planDay) && Number(planDay) > 0 ? Math.floor(Number(planDay)) : 0;
  if (safeDay <= 0) return [];
  const unlocked = loadUnlockedJourneyCards();
  const newlyUnlocked: { card: JourneyCard; state: UnlockedJourneyCardState }[] = [];
  let mutated = false;

  for (const card of JOURNEY_CARDS) {
    if (safeDay < card.dayRequired) continue;
    if (unlocked[card.id]) continue; // 已经解锁
    const state: UnlockedJourneyCardState = {
      id: card.id,
      unlockedAt: formatDateTimeNow(),
      planDayWhenUnlocked: safeDay,
    };
    unlocked[card.id] = state;
    newlyUnlocked.push({ card, state });
    mutated = true;
  }

  if (mutated) saveUnlockedJourneyCards(unlocked);
  return newlyUnlocked;
}

/** 开发工具专用：强制把某个卡解锁到今天 */
export function _devForceUnlockCard(cardId: string, planDay: number): boolean {
  const card = JOURNEY_CARDS.find((c) => c.id === cardId);
  if (!card) return false;
  const unlocked = loadUnlockedJourneyCards();
  if (unlocked[cardId]) return false;
  unlocked[cardId] = {
    id: cardId,
    unlockedAt: formatDateTimeNow(),
    planDayWhenUnlocked: Number(planDay) || card.dayRequired,
  };
  saveUnlockedJourneyCards(unlocked);
  return true;
}
