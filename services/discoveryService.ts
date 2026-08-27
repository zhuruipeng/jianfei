import {
  STORAGE_KEY_WORLD_DISCOVERIES,
  USAGE_EVENT_NAMES,
  type WorldDiscoveryConditionType,
  type WorldDiscoveryId,
  type WorldDiscoveryState,
} from '../types/index';
import { WORLD_DISCOVERY_BY_ID, WORLD_DISCOVERY_CONFIG } from '../config/worldDiscoveryConfig';
import { trackEvent } from './usageService';

export interface WorldDiscoveryMetrics {
  mealDays: number;
  exerciseDays: number;
  meaningfulDays: number;
  allCompleteDays: number;
  planDay: number;
}

export interface WorldDiscoveryView {
  id: WorldDiscoveryId;
  state: WorldDiscoveryState;
  config: (typeof WORLD_DISCOVERY_CONFIG)[number];
}

export interface SyncDiscoveriesResult {
  all: WorldDiscoveryView[];
  newlyUnlocked: WorldDiscoveryView[];
  toAnnounce?: WorldDiscoveryView;
}

function nowIso(): string {
  try { return new Date().toISOString(); }
  catch { return String(Date.now()); }
}

function isDiscoveryId(value: unknown): value is WorldDiscoveryId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(WORLD_DISCOVERY_BY_ID, value);
}

export function loadWorldDiscoveries(): WorldDiscoveryState[] {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY_WORLD_DISCOVERIES);
    if (!Array.isArray(raw)) return [];
    const seen = new Set<WorldDiscoveryId>();
    const states: WorldDiscoveryState[] = [];
    for (const item of raw) {
      if (!item || !isDiscoveryId(item.discoveryId) || seen.has(item.discoveryId)) continue;
      seen.add(item.discoveryId);
      states.push({
        discoveryId: item.discoveryId,
        unlockedAt: typeof item.unlockedAt === 'string' && item.unlockedAt ? item.unlockedAt : nowIso(),
        hasSeenUnlockAnimation: item.hasSeenUnlockAnimation === true,
      });
    }
    return states;
  } catch {
    return [];
  }
}

function saveWorldDiscoveries(states: WorldDiscoveryState[]): void {
  try { wx.setStorageSync(STORAGE_KEY_WORLD_DISCOVERIES, states); }
  catch { /* 发现展示状态写入失败不阻断真实记录 */ }
}

function metricFor(type: WorldDiscoveryConditionType, metrics: WorldDiscoveryMetrics): number {
  if (type === 'meal_days') return metrics.mealDays;
  if (type === 'exercise_days') return metrics.exerciseDays;
  if (type === 'meaningful_days') return metrics.meaningfulDays;
  if (type === 'all_complete_days') return metrics.allCompleteDays;
  return metrics.planDay;
}

function asView(state: WorldDiscoveryState): WorldDiscoveryView {
  return { id: state.discoveryId, state, config: WORLD_DISCOVERY_BY_ID[state.discoveryId] };
}

/**
 * 从真实历史同步永久发现。一次进入最多保留一个未看提示，其余合格项静默进列表。
 */
export function syncWorldDiscoveries(metrics: WorldDiscoveryMetrics): SyncDiscoveriesResult {
  const states = loadWorldDiscoveries();
  const byId = new Map(states.map((item) => [item.discoveryId, item]));
  const newlyUnlocked: WorldDiscoveryState[] = [];

  for (const config of WORLD_DISCOVERY_CONFIG) {
    if (byId.has(config.id) || metricFor(config.conditionType, metrics) < config.threshold) continue;
    const state: WorldDiscoveryState = {
      discoveryId: config.id,
      unlockedAt: nowIso(),
      hasSeenUnlockAnimation: false,
    };
    states.push(state);
    byId.set(config.id, state);
    newlyUnlocked.push(state);
    trackEvent(USAGE_EVENT_NAMES.WORLD_DISCOVERY_UNLOCKED, { discoveryId: config.id });
  }

  const announcement = states.find((item) => !item.hasSeenUnlockAnimation);
  // 旧用户/同次多项达标：只让一个进入提示队列，其余直接成为已看列表项。
  for (const state of states) {
    if (!state.hasSeenUnlockAnimation && state !== announcement) state.hasSeenUnlockAnimation = true;
  }
  saveWorldDiscoveries(states);

  return {
    all: states.map(asView),
    newlyUnlocked: newlyUnlocked.map(asView),
    toAnnounce: announcement ? asView(announcement) : undefined,
  };
}

export function markWorldDiscoverySeen(discoveryId: WorldDiscoveryId): void {
  const states = loadWorldDiscoveries();
  const state = states.find((item) => item.discoveryId === discoveryId);
  if (!state || state.hasSeenUnlockAnimation) return;
  state.hasSeenUnlockAnimation = true;
  saveWorldDiscoveries(states);
}

export function trackWorldDiscoveryViewed(discoveryId: WorldDiscoveryId): void {
  trackEvent(USAGE_EVENT_NAMES.WORLD_DISCOVERY_VIEWED, { discoveryId });
}
