/**
 * services/worldService.ts
 *
 * 小轻世界只读取既有业务数据：
 *   MealRecord -> 植物
 *   DailyRecord.exerciseMinutes + 当日目标 -> 道路
 *   DailyRecord.waterCups + 当日目标 -> 水池
 *
 * WorldState 永不持久化。Storage 里只保存“哪些动画已经看过”。
 */
import {
  STORAGE_KEY_WORLD_UI_STATE,
  STORAGE_PREFIX_DAILY,
  type DailyRecord,
  type WorldElementType,
  type WorldJourneyLandmark,
  type WorldLevel,
  type WorldState,
  type WorldTransition,
  type WorldUiState,
  type WorldUnlock,
} from '../types/index';
import {
  WORLD_ELEMENT_CHANGE_LABELS,
  WORLD_ELEMENT_LABELS,
  WORLD_GROWTH_STAGES,
  WORLD_JOURNEY_LANDMARKS,
} from '../config/worldGrowthConfig';
import { loadAllMealRecords } from './mealService';
import { computeDailyTasksForDate } from '../utils/dailyTasks';
import {
  getEffectiveExerciseGoal,
  getEffectiveWaterGoal,
  loadAnyDailyRecordForDate,
} from '../utils/summary';
import { getTodayString, isSameDayYYYYMMDD } from '../utils/date';
import { WORLD_FEEDBACK_MESSAGES } from '../config/companionWorldMessages';

interface BuildWorldStateInput {
  date?: string;
  planDay?: number;
}

export interface WorldPresentationDelta {
  plantLevelUp: boolean;
  pathLevelUp: boolean;
  waterLevelUp: boolean;
  allCompleteFirstSeen: boolean;
}

const EMPTY_LANDMARK: WorldJourneyLandmark = {
  visible: false,
  dayRequired: 7,
  title: '',
  emoji: '',
  hint: '',
};

function clampWorldLevel(value: unknown): WorldLevel {
  const n = Math.floor(Number(value));
  if (n <= 0) return 0;
  if (n >= 4) return 4;
  return n as WorldLevel;
}

export function getWorldLevelByDays(days: number): WorldLevel {
  const safeDays = Math.max(0, Math.floor(Number(days) || 0));
  let level: WorldLevel = 0;
  for (const stage of WORLD_GROWTH_STAGES) {
    if (safeDays >= stage.requiredDays) level = stage.level;
  }
  return level;
}

export function getPlantLevel(activeDays: number): WorldLevel {
  return getWorldLevelByDays(activeDays);
}

export function getPathLevel(goalDays: number): WorldLevel {
  return getWorldLevelByDays(goalDays);
}

export function getWaterLevel(goalDays: number): WorldLevel {
  return getWorldLevelByDays(goalDays);
}

function loadDailyRecordsThrough(date: string): DailyRecord[] {
  try {
    const info = wx.getStorageInfoSync();
    const keys = Array.isArray(info?.keys) ? info.keys : [];
    const seen = new Set<string>();
    const records: DailyRecord[] = [];
    for (const key of keys) {
      if (typeof key !== 'string' || !key.startsWith(STORAGE_PREFIX_DAILY)) continue;
      const recordDate = key.slice(STORAGE_PREFIX_DAILY.length);
      if (!isSameDayYYYYMMDD(recordDate) || recordDate > date || seen.has(recordDate)) continue;
      const record = loadAnyDailyRecordForDate(recordDate);
      if (!record) continue;
      seen.add(recordDate);
      records.push(record);
    }
    return records;
  } catch {
    return [];
  }
}

function getMealActiveDatesThrough(date: string): Set<string> {
  const days = new Set<string>();
  for (const meal of loadAllMealRecords()) {
    if (!meal || !isSameDayYYYYMMDD(meal.date) || meal.date > date) continue;
    days.add(meal.date);
  }
  return days;
}

function countExerciseGoalDays(records: DailyRecord[]): number {
  let total = 0;
  for (const record of records) {
    const minutes = typeof record.exerciseMinutes === 'number' ? record.exerciseMinutes : 0;
    if (minutes >= getEffectiveExerciseGoal(record)) total += 1;
  }
  return total;
}

function countWaterGoalDays(records: DailyRecord[]): number {
  let total = 0;
  for (const record of records) {
    const cups = typeof record.waterCups === 'number' ? record.waterCups : 0;
    if (cups >= getEffectiveWaterGoal(record)) total += 1;
  }
  return total;
}

function buildUnlockCandidate(type: WorldElementType, days: number, level: WorldLevel): WorldUnlock | null {
  if (level >= 4) return null;
  const nextStage = WORLD_GROWTH_STAGES.find((stage) => stage.level === level + 1);
  if (!nextStage) return null;
  const remainingDays = Math.max(1, nextStage.requiredDays - Math.max(0, days));
  return {
    type,
    remaining: remainingDays,
    title: `下一次${WORLD_ELEMENT_CHANGE_LABELS[type]}`,
    description: `再完成${remainingDays}天${WORLD_ELEMENT_LABELS[type]}`,
    imageKey: type,
    nextLevel: nextStage.level,
    targetDays: nextStage.requiredDays,
    remainingDays,
    text: `再完成${remainingDays}天${WORLD_ELEMENT_LABELS[type]}，${WORLD_ELEMENT_CHANGE_LABELS[type]}`,
  };
}

export function getNextWorldUnlock(input: {
  mealActiveDays: number;
  exerciseGoalDays: number;
  waterGoalDays: number;
  plantLevel: WorldLevel;
  pathLevel: WorldLevel;
  waterLevel: WorldLevel;
  planDay?: number;
}): WorldUnlock | undefined {
  const candidates = [
    buildUnlockCandidate('plant', input.mealActiveDays, input.plantLevel),
    buildUnlockCandidate('path', input.exerciseGoalDays, input.pathLevel),
    buildUnlockCandidate('water', input.waterGoalDays, input.waterLevel),
  ].filter((item): item is WorldUnlock => item !== null);
  const safePlanDay = Math.max(1, Math.floor(Number(input.planDay) || 1));
  const nextJourney = WORLD_JOURNEY_LANDMARKS.find((item) => item.dayRequired > safePlanDay);
  if (nextJourney) {
    const remaining = nextJourney.dayRequired - safePlanDay;
    candidates.push({
      type: 'journey',
      remaining,
      remainingDays: remaining,
      targetDays: nextJourney.dayRequired,
      title: `${nextJourney.emoji} ${remaining === 1 ? '明天' : `再走${remaining}天`}将到达${nextJourney.title}`,
      description: '旅程地标会出现在花园远处',
      imageKey: `day${nextJourney.dayRequired}`,
      text: `${nextJourney.emoji} ${remaining === 1 ? '明天' : `再走${remaining}天`}将到达${nextJourney.title}`,
    });
  }
  const priority: Record<WorldUnlock['type'], number> = { journey: 0, plant: 1, path: 2, water: 3 };
  candidates.sort((a, b) => a.remainingDays - b.remainingDays || priority[a.type] - priority[b.type]);
  return candidates[0];
}

export function getJourneyLandmark(planDay: number): WorldJourneyLandmark {
  const safeDay = Math.max(1, Math.floor(Number(planDay) || 1));
  let current: WorldJourneyLandmark | null = null;
  for (const landmark of WORLD_JOURNEY_LANDMARKS) {
    if (safeDay >= landmark.dayRequired) current = landmark;
  }
  return current ? { ...current } : { ...EMPTY_LANDMARK };
}

function getWorldMessage(completedCount: 0 | 1 | 2 | 3): string {
  if (completedCount === 3) return '今天的花园完整啦。\n我们一起让这里又变好了一点。';
  if (completedCount === 2) return '花园已经有两处变化了。\n再完成一件小事就好。';
  if (completedCount === 1) return '这里正在一点点长大。';
  return '今天做一件小事，\n这里就会发生一点变化。';
}

export function buildWorldState(input: BuildWorldStateInput = {}): WorldState {
  const date = input.date || getTodayString();
  const planDay = Math.max(1, Math.floor(Number(input.planDay) || 1));
  const dailyRecords = loadDailyRecordsThrough(date);
  const mealDates = getMealActiveDatesThrough(date);
  const mealActiveDays = mealDates.size;
  const exerciseGoalDays = countExerciseGoalDays(dailyRecords);
  const waterGoalDays = countWaterGoalDays(dailyRecords);
  const meaningfulDates = new Set<string>(mealDates);
  let allCompleteDays = 0;
  for (const record of dailyRecords) {
    const exercise = typeof record.exerciseMinutes === 'number' ? record.exerciseMinutes : 0;
    const water = typeof record.waterCups === 'number' ? record.waterCups : 0;
    if (exercise > 0 || water > 0) meaningfulDates.add(record.date);
    if (
      mealDates.has(record.date) &&
      exercise >= getEffectiveExerciseGoal(record) &&
      water >= getEffectiveWaterGoal(record)
    ) allCompleteDays += 1;
  }

  const plantLevel = getPlantLevel(mealActiveDays);
  const pathLevel = getPathLevel(exerciseGoalDays);
  const waterLevel = getWaterLevel(waterGoalDays);

  const tasks = computeDailyTasksForDate(date);
  const todayMealCompleted = !!tasks.find((task) => task.key === 'meal_any')?.completed;
  const todayExerciseCompleted = !!tasks.find((task) => task.key === 'exercise_min')?.completed;
  const todayWaterCompleted = !!tasks.find((task) => task.key === 'water_goal')?.completed;
  const count = [todayMealCompleted, todayExerciseCompleted, todayWaterCompleted].filter(Boolean).length;
  const todayCompletedCount = Math.min(3, count) as 0 | 1 | 2 | 3;
  const todayAllCompleted = todayCompletedCount === 3;

  return {
    plantLevel,
    pathLevel,
    waterLevel,
    mealActiveDays,
    exerciseGoalDays,
    waterGoalDays,
    meaningfulDays: meaningfulDates.size,
    allCompleteDays,
    todayMealCompleted,
    todayExerciseCompleted,
    todayWaterCompleted,
    todayAllCompleted,
    todayCompletedCount,
    nextUnlock: getNextWorldUnlock({
      mealActiveDays,
      exerciseGoalDays,
      waterGoalDays,
      plantLevel,
      pathLevel,
      waterLevel,
      planDay,
    }),
    journeyLandmark: getJourneyLandmark(planDay),
    message: getWorldMessage(todayCompletedCount),
  };
}

function normalizeWorldUiState(raw: any): WorldUiState | null {
  if (!raw || typeof raw !== 'object') return null;
  return {
    schemaVersion: Number(raw.schemaVersion) === 2 ? 2 : (1 as any),
    lastSeenPlantLevel: clampWorldLevel(raw.lastSeenPlantLevel),
    lastSeenPathLevel: clampWorldLevel(raw.lastSeenPathLevel),
    lastSeenWaterLevel: clampWorldLevel(raw.lastSeenWaterLevel),
    lastMealFeedbackDate: typeof raw.lastMealFeedbackDate === 'string' ? raw.lastMealFeedbackDate : undefined,
    lastExerciseFeedbackDate: typeof raw.lastExerciseFeedbackDate === 'string' ? raw.lastExerciseFeedbackDate : undefined,
    lastWaterFeedbackDate: typeof raw.lastWaterFeedbackDate === 'string' ? raw.lastWaterFeedbackDate : undefined,
    lastAllCompleteAnimationDate: typeof raw.lastAllCompleteAnimationDate === 'string'
      ? raw.lastAllCompleteAnimationDate
      : undefined,
  };
}

function saveWorldUiState(state: WorldUiState): void {
  try { wx.setStorageSync(STORAGE_KEY_WORLD_UI_STATE, state); } catch { /* UI 状态写失败不影响业务 */ }
}

/**
 * 比较并更新“已看过动画”缓存。第一次升级到 V13 的旧用户只建立基线，不补播所有历史动画。
 */
export function syncWorldUiState(state: WorldState, date: string): WorldPresentationDelta {
  let previous: WorldUiState | null = null;
  try { previous = normalizeWorldUiState(wx.getStorageSync(STORAGE_KEY_WORLD_UI_STATE)); } catch { previous = null; }

  if (!previous || previous.schemaVersion !== 2) {
    saveWorldUiState({
      schemaVersion: 2,
      lastSeenPlantLevel: state.plantLevel,
      lastSeenPathLevel: state.pathLevel,
      lastSeenWaterLevel: state.waterLevel,
      lastMealFeedbackDate: state.todayMealCompleted ? date : undefined,
      lastExerciseFeedbackDate: state.todayExerciseCompleted ? date : undefined,
      lastWaterFeedbackDate: state.todayWaterCompleted ? date : undefined,
      lastAllCompleteAnimationDate: state.todayAllCompleted ? date : undefined,
    });
    return { plantLevelUp: false, pathLevelUp: false, waterLevelUp: false, allCompleteFirstSeen: false };
  }

  const delta: WorldPresentationDelta = {
    plantLevelUp: state.plantLevel > previous.lastSeenPlantLevel,
    pathLevelUp: state.pathLevel > previous.lastSeenPathLevel,
    waterLevelUp: state.waterLevel > previous.lastSeenWaterLevel,
    allCompleteFirstSeen: state.todayAllCompleted && previous.lastAllCompleteAnimationDate !== date,
  };

  saveWorldUiState({
    ...previous,
    schemaVersion: 2,
    lastSeenPlantLevel: state.plantLevel,
    lastSeenPathLevel: state.pathLevel,
    lastSeenWaterLevel: state.waterLevel,
  });
  return delta;
}

let transitionSequence = 0;

function transition(kind: WorldTransition['kind']): WorldTransition {
  const durations: Partial<Record<WorldTransition['kind'], number>> = {
    plant: 2100, path: 2100, water: 2100, all: 2800,
    'plant-level': 2100, 'path-level': 2100, 'water-level': 2100,
  };
  return {
    kind,
    sequence: ++transitionSequence,
    message: WORLD_FEEDBACK_MESSAGES[kind] || '',
    durationMs: durations[kind] || 0,
  };
}

/** 单项在前、3/3 在后；页面逐个播放，离开页面不会影响业务状态。 */
export function buildWorldFeedbackQueue(
  previous: WorldState | null | undefined,
  current: WorldState,
  presentation: WorldPresentationDelta,
  date: string,
): WorldTransition[] {
  let ui: WorldUiState | null = null;
  try { ui = normalizeWorldUiState(wx.getStorageSync(STORAGE_KEY_WORLD_UI_STATE)); } catch { ui = null; }
  if (!ui || ui.schemaVersion !== 2) return [];
  const queue: WorldTransition[] = [];
  const mealJustDone = !!previous && !previous.todayMealCompleted && current.todayMealCompleted;
  const exerciseJustDone = !!previous && !previous.todayExerciseCompleted && current.todayExerciseCompleted;
  const waterJustDone = !!previous && !previous.todayWaterCompleted && current.todayWaterCompleted;

  if (current.todayMealCompleted && ui.lastMealFeedbackDate !== date) queue.push(transition('plant'));
  if (current.todayExerciseCompleted && ui.lastExerciseFeedbackDate !== date) queue.push(transition('path'));
  if (current.todayWaterCompleted && ui.lastWaterFeedbackDate !== date) queue.push(transition('water'));
  if (presentation.plantLevelUp && !mealJustDone) queue.push(transition('plant-level'));
  if (presentation.pathLevelUp && !exerciseJustDone) queue.push(transition('path-level'));
  if (presentation.waterLevelUp && !waterJustDone) queue.push(transition('water-level'));
  if (current.todayAllCompleted && ui.lastAllCompleteAnimationDate !== date) queue.push(transition('all'));
  return queue;
}

export function markWorldFeedbackShown(kind: WorldTransition['kind'], date: string): void {
  let ui: WorldUiState | null = null;
  try { ui = normalizeWorldUiState(wx.getStorageSync(STORAGE_KEY_WORLD_UI_STATE)); } catch { ui = null; }
  if (!ui || ui.schemaVersion !== 2) return;
  if (kind === 'plant') ui.lastMealFeedbackDate = date;
  if (kind === 'path') ui.lastExerciseFeedbackDate = date;
  if (kind === 'water') ui.lastWaterFeedbackDate = date;
  if (kind === 'all') ui.lastAllCompleteAnimationDate = date;
  saveWorldUiState(ui);
}

export function buildWorldTransition(
  previous: WorldState | null | undefined,
  current: WorldState,
  presentation: WorldPresentationDelta,
): WorldTransition {
  const none = (): WorldTransition => transition('');

  if (presentation.allCompleteFirstSeen || (!!previous && !previous.todayAllCompleted && current.todayAllCompleted)) {
    return transition('all');
  }
  if (previous && !previous.todayMealCompleted && current.todayMealCompleted) {
    return transition('plant');
  }
  if (previous && !previous.todayExerciseCompleted && current.todayExerciseCompleted) {
    return transition('path');
  }
  if (previous && !previous.todayWaterCompleted && current.todayWaterCompleted) {
    return transition('water');
  }
  if (presentation.plantLevelUp) {
    return transition('plant-level');
  }
  if (presentation.pathLevelUp) {
    return transition('path-level');
  }
  if (presentation.waterLevelUp) {
    return transition('water-level');
  }
  return none();
}
