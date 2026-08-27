// pages/index/index.ts - 今日首页（V13 小轻世界版）
//  - 顶部：由真实健康行动驱动的“小轻花园”分层场景
//  - 中部：每日 3 任务（读真实 MealRecord / DailyRecord，不建第二套状态）
//  - 特别任务：按日期稳定生成，支持完成/跳过（无惩罚）
//  - 旧记录功能：三餐 / 运动 / 喝水 / 体重 继续保留在"今日记录"区
//  - 积分 / 现实奖励：继续保留，与轻能量完全解耦

import {
  type MealRecord,
  type MealType,
  SATIETY_LABEL,
  MEAL_TAG_LIST,
  EXERCISE_TARGET_MINUTES,
  WATER_TARGET_CUPS,
  ENCOURAGE_MESSAGES,
  STORAGE_KEY_HOME_WELCOME_SHOWN,
  UI_MSG,
  DEFAULT_GOAL_DAYS,
  STORAGE_KEY_GOAL_DAYS,
  GROWTH_CONFIG,
  type WorldState,
  type WorldTransition,
  type WorldDiscoveryId,
} from '../../types/index';
import {
  getTodayString,
  formatDateCN,
  calculatePlanDay,
  pickRandom,
} from '../../utils/date';
import { migrateAllLegacyDailyRecords, findMealRecord } from '../../utils/meal';
import {
  calculateTodaySnapshot,
  calculateDailyPoints,
} from '../../services/pointsService';
import { updateDailyRecord, getTodayRecord } from '../../services/dailyService';
import { loadAllMealRecords } from '../../services/mealService';
import * as rewardService from '../../services/rewardService';
import * as weightService from '../../services/weightService';
import * as uiStrings from '../../services/uiStrings';
import { isDevEnv, seedDemoDataFor7Days,
  devAdd20Energy, devAdd100Energy,
  devSimulateNextDay, devResetCompanionSystem,
  devUnlockJourneyCardsToDay, devClearJourneyCards,
} from '../../services/devService';
import { clearAllTestData } from '../../services/devDataService';
import { SATIETY_ORDER } from '../../types/index';
import type { MealTagKey, SatietyLevel } from '../../types/index';
import {
  trackExerciseSaved,
  trackWaterGoalReachedOnce,
} from '../../services/usageService';
// V10：计划闭环
import * as planService from '../../services/planService';
import * as weeklySummaryService from '../../services/weeklySummaryService';
import { getEffectiveExerciseGoal, getEffectiveWaterGoal } from '../../utils/summary';
import type { UserPlan } from '../../types/index';

// V12：养成
import {
  calculateTotalEnergy,
  loadEnergyLedger,
} from '../../utils/energy';
import {
  computeLevelByEnergy,
  computeGrowthLevel,
  getEnergyToNextLevel,
  computeLevelProgressPercent,
  computeVisualStage,
  loadCompanionState,
  computeMoodByCompletedTasks,
  computeVisualStageKey,
  loadUnlockedJourneyCards,
} from '../../utils/companion';
import {
  computeDailyTasksForDate,
  getSpecialTaskForDate,
  isSpecialTaskSkipped,
  isSpecialTaskEnergyAwarded,
} from '../../utils/dailyTasks';
import type { DailyTaskVM } from '../../utils/dailyTasks';
import * as companionService from '../../services/companionService';
// V12.1：情绪/素材/文案 + 旅程卡
import {
  CompanionMood,
  CompanionVisualStage,
  JourneyCard,
  UnlockedJourneyCardState,
} from '../../types/index';
import {
  getCompanionRenderAsset,
  getJourneyCardRenderAsset,
  ResolvedCompanionAsset,
  ResolvedJourneyCardAsset,
} from '../../utils/companionAssets';
import {
  pickFirstTaskFeedback,
  pickSecondTaskFeedback,
  pickAllThreeDoneMessage,
  pickTapMessage,
  pickLevelUpBannerMessage,
  pickSpecialTaskDoneMessage,
} from '../../utils/companionMessages';
import {
  buildWorldState,
  buildWorldFeedbackQueue,
  markWorldFeedbackShown,
  syncWorldUiState,
} from '../../services/worldService';
import {
  getWorldAssetSet,
  type WorldAssetSet,
} from '../../config/worldGrowthConfig';
import {
  markWorldDiscoverySeen,
  syncWorldDiscoveries,
  trackWorldDiscoveryViewed,
  type WorldDiscoveryView,
} from '../../services/discoveryService';
import { trackEvent } from '../../services/usageService';
import { USAGE_EVENT_NAMES } from '../../types/index';

// ----------------------------- 辅助类型 -----------------------------
interface NextRewardCard {
  hasNext: boolean;
  unlocked: boolean;
  redeemed: boolean;
  emoji: string;
  title: string;
  current: number;
  required: number;
  percent: number;      // 0~100
  remainText: string;   // "还差70积分" / "奖励解锁" / "已领取"
}

/** 今日体重：小入口（弱化，不做最大数字） */
interface TodayWeightEntry {
  hasTodayRecord: boolean;
  todayKgText: string;  // "72.6 kg" / "今天还没有记录体重"
  diffText: string;     // 有趋势用，无则空串
}

interface MealCardItem {
  mealType: MealType;
  mealCn: string;
  icon: string;
  recorded: boolean;
  summaryText: string;   // 鸡蛋 · 牛奶 / "还没有记录"
  satietyText: string;   // "七分饱" 或 ""
  photoPath: string;
}

/** 周总结入口（首页 hero 下方温和提示，非弹窗） */
interface WeeklySummaryEntry {
  visible: boolean;
  planId: string;
  weekNumber: number;
  text: string;          // "🎉 第一周完成了，看看这一周发生了什么"
}

/** 计划完成入口 */
interface PlanCompletedEntry {
  visible: boolean;
  planId: string;
  text: string;          // "🎉 28天计划完成"
}

/** 旧用户"加入计划"提示卡 */
interface JoinPlanPrompt {
  visible: boolean;
}

// ----------------------------- V12 养成 -----------------------------
interface CompanionCardVM {
  name: string;
  level: number;
  levelName: string;      // 发芽
  title: string;          // 🌱 开始行动（当前解锁的最新称号）
  visualStage: 1 | 2 | 3 | 4; // 兼容保留
  visualStageKey: CompanionVisualStage;  // seed / baby / growing / grown
  mood: CompanionMood;    // 基础情绪（由 0/3、1/3、2/3、3/3 决定）

  /** 按视觉阶段 + 情绪决定的角色素材（useImage=false 则用 emoji 占位） */
  asset: ResolvedCompanionAsset;

  // 以下为"瞬时覆盖层"（约 1.5-3 秒；未到期时 UI 显示覆盖 mood/message）
  transientActive: boolean;
  transientUntilMs: number;  // 到期时间戳
  transientMood: CompanionMood;    // 通常是 happy
  transientMessage: string;        // "第一件小事完成。我们出发啦。"
  transientKind: '' | 'task1' | 'task2' | 'all3' | 'levelup' | 'specialDone' | 'tap';
  /** 3/3 完成时短暂"星点 + 小跳" */
  sparkleAllDone: boolean;
  /** 点击角色时的 scale pulse（短暂 true 1s 自动落） */
  tapPulse: boolean;

  totalEnergy: number;
  nextRequiredEnergy: number;   // 到下一等级门槛；到顶=当前
  toNextText: string;           // "再获得90能量升级" / "已到顶"
  progressPercent: number;      // 当前等级内的进度 0~100
  energyBandText: string;       // "160 / 250"
  message: string;              // 小轻今日问候（基础）
  completedCount: 0 | 1 | 2 | 3;
}

interface DailyTaskCardVM {
  key: string;
  title: string;
  emoji: string;
  completed: boolean;
  progressText: string;   // "0 / 1"、"12 / 20 分钟"、"6 / 8 杯"
  amount: number;         // 20
  energyAwarded: boolean; // 是否已领过能量
}

interface SpecialTaskCardVM {
  visible: boolean;       // 今日是否出现
  text: string;
  amount: number;         // 30
  skipped: boolean;       // 用户是否点了"今天不做这个"
  completed: boolean;     // 是否已领取能量（同一天一次）
}

interface LevelUpJourneyCardHintVM {
  id: string;
  shortTitle: string;  // "森林入口"
  emoji: string;
}

interface LevelUpModalVM {
  visible: boolean;
  from: number;
  to: number;
  levelName: string;      // "发芽"
  titles: string[];       // 新解锁的称号（通常 1 个）
  actionsCount: number;   // 完成的"小行动"数 = ledger 记录条数（估算）
  /** 升级后"长大一点的小轻"渲染图（to 等级对应的 stage + happy） */
  assetAfter: ResolvedCompanionAsset;
  /** 本次升级是否同时解锁了旅程卡 */
  journeyCardsUnlocked: LevelUpJourneyCardHintVM[];
  banner: string;         // "我们一起完成了 18 个小行动"
}

interface IntroCardVM {
  visible: boolean;
  welcomeBonusGivenNow: boolean;   // 本次是否同时给了 +50 欢迎能量
}

interface IndexPageData {
  // 顶部：品牌 + 日期 + 第N天 + 标语
  dateCN: string;
  planDay: number;
  encourageMessage: string;

  // V10：计划信息（hero 内）
  hasPlan: boolean;
  planTitle: string;             // "28天轻步计划"
  planDurationDays: number;      // 7 / 28 / 90
  planProgressPercent: number;   // 时间进度 0~100
  planProgressText: string;      // "6 / 28天"
  showPlanSettingsEntry: boolean; // hero 右上角 ··· 入口
  worldHeaderText: string;
  worldSubtitleText: string;

  // V10：周总结入口 / 计划完成入口 / 加入计划提示
  weeklySummaryEntry: WeeklySummaryEntry;
  planCompletedEntry: PlanCompletedEntry;
  joinPlanPrompt: JoinPlanPrompt;

  // 完成度
  completionPercent: number;

  // 今天列表
  mealCards: MealCardItem[];
  exerciseMinutes: number;
  waterCups: number;
  exerciseCompleted: boolean;
  waterCompleted: boolean;

  // V10：当日 effective 目标（snapshot→plan→常量 回退）
  effectiveExerciseGoal: number;
  effectiveWaterGoal: number;

  // 今日获得 / 累计努力
  todayPoints: number;
  totalPoints: number;

  // 下一奖励
  nextReward: NextRewardCard;

  // 今日体重入口（弱化）
  todayWeight: TodayWeightEntry;

  // 目标天数提示（温和显示：28天）
  goalDays: number;

  // 首次欢迎卡（显示一次）
  showWelcomeCard: boolean;
  welcomeRecommendMeal: MealType;

  // 开发环境：显示"一键注入 7 天数据"按钮
  showDevSeedButton: boolean;

  EXERCISE_TARGET_MINUTES: number;
  WATER_TARGET_CUPS: number;

  // V11：自定义运动输入弹窗
  showExerciseModal: boolean;
  exerciseModalValue: string;   // 用户正在输入的值（空串=未输入）
  exerciseModalCurrent: number; // 当前已记录的分钟数
  exerciseModalGoal: number;    // 当前目标

  // ---------- V12 养成 ----------
  companion: CompanionCardVM;
  dailyTasks: DailyTaskCardVM[];
  allDailyCompleteBonusAwarded: boolean;   // 3个全部完成的 +20 是否已发
  specialTask: SpecialTaskCardVM;
  levelUpModal: LevelUpModalVM;
  introCard: IntroCardVM;

  // ---------- V13 小轻世界（WorldState 每次从真实数据派生） ----------
  worldState: WorldState;
  worldTransition: WorldTransition;
  worldAssets: WorldAssetSet;
  showMoreHomeDetails: boolean;
  worldDiscoveries: WorldDiscoveryView[];
  discoveryCount: number;
  discoveryNotice: DiscoveryNoticeVM;
  discoveryDetail: DiscoveryNoticeVM;
}

interface DiscoveryNoticeVM {
  visible: boolean;
  discoveryId: WorldDiscoveryId | '';
  emoji: string;
  name: string;
  description: string;
  companionMessage: string;
  unlockedAtText: string;
}

const EMPTY_NEXT_REWARD: NextRewardCard = {
  hasNext: false, unlocked: false, redeemed: false,
  emoji: '', title: '', current: 0, required: 0, percent: 0, remainText: ''
};
const EMPTY_WEIGHT: TodayWeightEntry = {
  hasTodayRecord: false, todayKgText: '今天还没有记录体重', diffText: ''
};
// ---------- V12 养成：默认值 ----------
const VISUAL_STAGE_EMOJI: Record<1 | 2 | 3 | 4, string> = {
  1: '🌱',   // 种子/小蛋
  2: '🌿',   // 刚刚出现的小轻
  3: '🍀',   // 成长中的小轻
  4: '🌳',   // 完整成长的小轻
};

function emptyCompanion(): CompanionCardVM {
  const _stageNum: 1 | 2 | 3 | 4 = 1;
  const _stageKey: CompanionVisualStage = 'seed';
  const _mood: CompanionMood = 'encouraging';
  return {
    name: '小轻',
    level: 1,
    levelName: '初遇',
    title: GROWTH_CONFIG[0].title,
    visualStage: _stageNum,
    visualStageKey: _stageKey,
    mood: _mood,
    asset: getCompanionRenderAsset(_stageKey, _mood),
    transientActive: false,
    transientUntilMs: 0,
    transientMood: 'neutral',
    transientMessage: '',
    transientKind: '',
    sparkleAllDone: false,
    tapPulse: false,
    totalEnergy: 0,
    nextRequiredEnergy: GROWTH_CONFIG[1] ? GROWTH_CONFIG[1].requiredEnergy : 0,
    toNextText: '',
    progressPercent: 0,
    energyBandText: '0 / 0',
    message: '你回来啦。\n今天先完成一件小事就好。',
    completedCount: 0,
  };
}
function emptyDailyTasks(): DailyTaskCardVM[] {
  return [
    { key: 'meal_any',     title: '记录一餐',       emoji: '🥗', completed: false, progressText: '0 / 1',     amount: 20, energyAwarded: false },
    { key: 'exercise_min', title: '动一动',         emoji: '🚶', completed: false, progressText: '0 / 30 分钟', amount: 20, energyAwarded: false },
    { key: 'water_goal',   title: '完成今天的喝水目标', emoji: '💧', completed: false, progressText: '0 / 8 杯', amount: 20, energyAwarded: false },
  ];
}
const EMPTY_SPECIAL: SpecialTaskCardVM = {
  visible: false, text: '', amount: 30, skipped: false, completed: false,
};
function _emptyAssetAfter(): ResolvedCompanionAsset {
  return getCompanionRenderAsset('baby', 'happy');
}
const EMPTY_LEVELUP: LevelUpModalVM = {
  visible: false, from: 1, to: 1, levelName: '', titles: [], actionsCount: 0,
  assetAfter: _emptyAssetAfter(), journeyCardsUnlocked: [], banner: '',
};
const EMPTY_INTRO: IntroCardVM = { visible: false, welcomeBonusGivenNow: false };
const EMPTY_DISCOVERY_NOTICE: DiscoveryNoticeVM = {
  visible: false, discoveryId: '', emoji: '', name: '', description: '', companionMessage: '', unlockedAtText: '',
};

function emptyWorldState(): WorldState {
  return {
    plantLevel: 0,
    pathLevel: 0,
    waterLevel: 0,
    mealActiveDays: 0,
    exerciseGoalDays: 0,
    waterGoalDays: 0,
    meaningfulDays: 0,
    allCompleteDays: 0,
    todayMealCompleted: false,
    todayExerciseCompleted: false,
    todayWaterCompleted: false,
    todayAllCompleted: false,
    todayCompletedCount: 0,
    journeyLandmark: { visible: false, dayRequired: 7, title: '', emoji: '', hint: '' },
    message: '今天做一件小事，\n这里就会发生一点变化。',
  };
}

function emptyWorldTransition(): WorldTransition {
  return { kind: '', sequence: 0, message: '', durationMs: 0 };
}

function emptyMealCards(): MealCardItem[] {
  return [
    { mealType: 'breakfast', mealCn: '早餐', icon: '🟟', recorded: false, summaryText: '还没有记录', satietyText: '', photoPath: '' },
    { mealType: 'lunch',     mealCn: '午餐', icon: '🟟', recorded: false, summaryText: '还没有记录', satietyText: '', photoPath: '' },
    { mealType: 'dinner',    mealCn: '晚餐', icon: '🟟', recorded: false, summaryText: '还没有记录', satietyText: '', photoPath: '' },
  ];
}

function buildMealCard(type: MealType, mealCn: string, rec: MealRecord | undefined): MealCardItem {
  if (!rec) {
    return {
      mealType: type, mealCn, icon: '🟟', recorded: false,
      summaryText: '还没有记录', satietyText: '', photoPath: ''
    };
  }
  let summaryText = '';
  if (rec.foodText) summaryText = rec.foodText.trim();
  if (!summaryText && rec.tags && rec.tags.length > 0) {
    const labels: string[] = [];
    for (const tdef of MEAL_TAG_LIST) {
      if ((rec.tags as MealTagKey[]).indexOf(tdef.key as MealTagKey) !== -1) labels.push(tdef.label);
    }
    if (labels.length > 0) summaryText = labels.join(' · ');
  }
  if (!summaryText) summaryText = '已记录';
  let satietyText = '';
  if (rec.satietyLevel) {
    const s = rec.satietyLevel as SatietyLevel;
    if (SATIETY_ORDER.indexOf(s) !== -1) satietyText = SATIETY_LABEL[s];
  }
  const photoPath = typeof rec.photoPath === 'string' ? rec.photoPath : '';
  return { mealType: type, mealCn, icon: '🟟', recorded: true, summaryText, satietyText, photoPath };
}

/** 按当前时间猜第一餐：0~10 早餐、10~15 午餐、15~24 晚餐 */
function guessNextMealByTime(): MealType {
  try {
    const h = new Date().getHours();
    if (h < 10) return 'breakfast';
    if (h < 15) return 'lunch';
    return 'dinner';
  } catch { return 'lunch'; }
}

function readGoalDaysOrDefault(): number {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY_GOAL_DAYS);
    const n = Number(raw);
    if (n === 7 || n === 28 || n === 90) return n;
  } catch { /* ignore */ }
  return DEFAULT_GOAL_DAYS;
}

function welcomeAlreadyShown(): boolean {
  try {
    const v = wx.getStorageSync(STORAGE_KEY_HOME_WELCOME_SHOWN);
    return v === 1 || v === true;
  } catch { return false; }
}

function markWelcomeShown(): void {
  try { wx.setStorageSync(STORAGE_KEY_HOME_WELCOME_SHOWN, 1); } catch { /* ignore */ }
}

Page({
  data: {
    dateCN: '',
    planDay: 1,
    encourageMessage: '',

    hasPlan: false,
    planTitle: '',
    planDurationDays: 0,
    planProgressPercent: 0,
    planProgressText: '',
    showPlanSettingsEntry: false,
    worldHeaderText: '我的小轻花园 · 第1天',
    worldSubtitleText: '',

    weeklySummaryEntry: { visible: false, planId: '', weekNumber: 0, text: '' },
    planCompletedEntry: { visible: false, planId: '', text: '' },
    joinPlanPrompt: { visible: false },

    completionPercent: 0,

    mealCards: emptyMealCards(),
    exerciseMinutes: 0,
    waterCups: 0,
    exerciseCompleted: false,
    waterCompleted: false,

    effectiveExerciseGoal: EXERCISE_TARGET_MINUTES,
    effectiveWaterGoal: WATER_TARGET_CUPS,

    todayPoints: 0,
    totalPoints: 0,

    nextReward: EMPTY_NEXT_REWARD,
    todayWeight: EMPTY_WEIGHT,

    goalDays: DEFAULT_GOAL_DAYS,
    showWelcomeCard: false,
    welcomeRecommendMeal: 'lunch' as MealType,
    showDevSeedButton: false,

    EXERCISE_TARGET_MINUTES,
    WATER_TARGET_CUPS,

    showExerciseModal: false,
    exerciseModalValue: '',
    exerciseModalCurrent: 0,
    exerciseModalGoal: EXERCISE_TARGET_MINUTES,

    // ---------- V12 养成 ----------
    companion: emptyCompanion(),
    dailyTasks: emptyDailyTasks(),
    allDailyCompleteBonusAwarded: false,
    specialTask: EMPTY_SPECIAL,
    levelUpModal: EMPTY_LEVELUP,
    introCard: EMPTY_INTRO,

    // ---------- V13 小轻世界 ----------
    worldState: emptyWorldState(),
    worldTransition: emptyWorldTransition(),
    worldAssets: getWorldAssetSet(0, 0, 0),
    showMoreHomeDetails: false,
    worldDiscoveries: [],
    discoveryCount: 0,
    discoveryNotice: EMPTY_DISCOVERY_NOTICE,
    discoveryDetail: EMPTY_DISCOVERY_NOTICE,
  } as IndexPageData,

  today: '' as string,

  onLoad() {
    // 首次进入：迁移旧 DailyRecord.xxxCompleted 到 MealRecord（防止积分丢失）
    try { migrateAllLegacyDailyRecords(); } catch { /* ignore */ }

    const today = getTodayString();
    this.today = today;
    // 确保今天 DailyRecord 存在（空的也行，避免后续 calculateTodaySnapshot 抛错）
    getTodayRecord();

    const goalDays = readGoalDaysOrDefault();

    // ---------- V12：先执行养成初始化（欢迎卡 / +50 欢迎能量），再刷新 ----------
    let introCard: IntroCardVM = { ...EMPTY_INTRO };
    try {
      const r = companionService.ensureCompanionAndMaybeWelcome();
      introCard = {
        visible: !!r.showIntro,
        welcomeBonusGivenNow: !!r.welcomeBonusGivenNow,
      };
    } catch (e) {
      console.warn('[index] ensureCompanionAndMaybeWelcome failed', e);
    }

    this.setData({
      goalDays,
      showDevSeedButton: isDevEnv(),
      introCard,
    });
    this.refreshAll();
  },

  onShow() {
    // 从 meal 记录页 / 体重记录 / 进展 tab 返回：重新拉 Storage 最新状态
    const today = getTodayString();
    if (this.today !== today) {
      this.today = today;
      getTodayRecord();
    }
    this.refreshAll();
  },

  onUnload() {
    try {
      const timer = (this as any).__worldTransitionTimer;
      if (timer) clearTimeout(timer);
      const discoveryTimer = (this as any).__discoveryNoticeTimer;
      if (discoveryTimer) clearTimeout(discoveryTimer);
    } catch { /* ignore */ }
  },

  onToggleMoreHomeDetails() {
    const current = !!(this.data as IndexPageData).showMoreHomeDetails;
    this.setData({ showMoreHomeDetails: !current });
  },

  // ---------------- 刷新（唯一真实入口） ----------------
  refreshAll() {
    const today = this.today || getTodayString();

    // V10：计划闭环 - 读取 active plan + 同步周总结快照
    const plan = planService.loadActivePlan();
    let planDay = 1;
    let planTitle = '';
    let planDurationDays = 0;
    let planProgressPercent = 0;
    let planProgressText = '';
    let hasPlan = false;
    let showPlanSettingsEntry = false;
    let worldHeaderText = '我的小轻花园 · 第1天';
    let worldSubtitleText = formatDateCN(today);
    const weeklySummaryEntry: WeeklySummaryEntry = { visible: false, planId: '', weekNumber: 0, text: '' };
    const planCompletedEntry: PlanCompletedEntry = { visible: false, planId: '', text: '' };
    const joinPlanPrompt: JoinPlanPrompt = { visible: false };

    // planDay 计算：优先用 plan.startDate；无 plan 兜底用 firstLaunchDate（保留旧行为）
    const app = getApp<IAppOption>();
    const firstDate = (() => {
      const g = app?.globalData;
      if (g?.firstLaunchDate) return g.firstLaunchDate;
      try {
        const v = wx.getStorageSync('app_first_launch_date');
        if (v && typeof v === 'string') return v;
      } catch { /* ignore */ }
      try { wx.setStorageSync('app_first_launch_date', today); } catch { /* ignore */ }
      if (app?.globalData) app.globalData.firstLaunchDate = today;
      return today;
    })();

    if (plan) {
      hasPlan = true;
      planDurationDays = plan.durationDays;
      planTitle = `${plan.durationDays}天轻步计划`;
      planDay = Math.max(1, calculatePlanDay(plan.startDate, today));
      // 时间进度（不是减重成功率）：截至今天完成的天数 / 总天数
      const elapsed = Math.min(planDurationDays, planDay);
      planProgressPercent = Math.round((elapsed / planDurationDays) * 100);
      planProgressText = `${elapsed} / ${planDurationDays}天`;
      showPlanSettingsEntry = true;

      // 计划完成：planDay > durationDays → 显示完成入口（不自动标记 completed；
      //   由用户在 plan-summary 页选择"先保持记录"时再标记，避免完成入口一闪而过）
      if (planDay > planDurationDays) {
        planCompletedEntry.visible = true;
        planCompletedEntry.planId = plan.id;
        planCompletedEntry.text = '🎉 第一段轻旅完成';
        worldHeaderText = `${plan.durationDays}天轻旅完成 🎉`;
        worldSubtitleText = '今天也可以继续一起成长';
        showPlanSettingsEntry = false;
      } else {
        worldHeaderText = `${plan.durationDays}天轻旅 · 第${planDay}天`;
        // 进入首页时幂等生成已结束的完整周总结（completedWeeks = floor((planDay-1)/7)）
        try {
          weeklySummaryService.ensureWeeklySummariesUpTo(plan, planDay);
        } catch (e) {
          console.warn('[index] ensureWeeklySummariesUpTo failed', e);
        }
        // 找到"已生成但未查看"的最大周号
        try {
          const totalWeeks = weeklySummaryService.getPlanWeekCount(plan);
          const maxCompletedWeek = Math.min(totalWeeks, Math.floor((planDay - 1) / 7));
          if (maxCompletedWeek >= 1) {
            const next = weeklySummaryService.findNextUnviewedWeek(plan.id, maxCompletedWeek);
            if (next) {
              const weekCn = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'][next.weekNumber - 1] || next.weekNumber;
              weeklySummaryEntry.visible = true;
              weeklySummaryEntry.planId = plan.id;
              weeklySummaryEntry.weekNumber = next.weekNumber;
              weeklySummaryEntry.text = `🎉 第${weekCn}周完成了，看看这一周发生了什么`;
            }
          }
        } catch (e) {
          console.warn('[index] findNextUnviewedWeek failed', e);
        }
      }
    } else {
      // 旧用户：没有 plan，且未 dismiss 提示 → 显示"加入计划"卡片
      if (!planService.isPlanSetupDismissed()) {
        joinPlanPrompt.visible = true;
      }
      // planDay 兜底用 firstLaunchDate（保留旧 hero 文案"第N天"）
      planDay = calculatePlanDay(firstDate, today);
      worldHeaderText = `我的小轻花园 · 第${planDay}天`;
    }

    const msg = pickRandom(ENCOURAGE_MESSAGES);

    // 积分 / 完成度（统一来源，不读派生布尔）
    const snap = calculateTodaySnapshot(today);
    const totalPoints = rewardService.calculateTotalPoints();
    const rewardsInStorage = rewardService.loadRewards(false);   // 真实用户创建的
    const nextRewardRaw = rewardService.pickNextReward();

    // V10：当日 effective 目标（snapshot→plan→常量 回退）
    const effectiveExerciseGoal = getEffectiveExerciseGoal(snap.record);
    const effectiveWaterGoal = getEffectiveWaterGoal(snap.record);

    // 奖励卡片：用户没创建任何真实奖励 → 不显示奖励进度卡（由 reward tab 引导设置第一个奖励）
    let nextCard: NextRewardCard = { ...EMPTY_NEXT_REWARD };
    if (nextRewardRaw) {
      const prog = rewardService.calcRewardProgress(nextRewardRaw.requiredPoints, totalPoints);
      let remainText = '';
      if (nextRewardRaw.redeemed) remainText = '✓ 已领取';
      else if (prog.remain <= 0) remainText = '🟟 奖励解锁';
      else remainText = `还差${prog.remain}积分`;
      nextCard = {
        hasNext: true,
        unlocked: prog.remain <= 0,
        redeemed: !!nextRewardRaw.redeemed,
        emoji: nextRewardRaw.emoji || '🟟',
        title: nextRewardRaw.title,
        current: prog.current,
        required: prog.required,
        percent: prog.percent,
        remainText,
      };
    } else if (rewardsInStorage.length === 0) {
      // 没任何奖励 → 仍显示一个"设置第一个奖励"占位（让用户知道奖励体系在哪里）
      nextCard = {
        ...EMPTY_NEXT_REWARD,
        hasNext: true,
        unlocked: false, redeemed: false,
        emoji: '🎁',
        title: '给自己设置第一个奖励',
        current: totalPoints,
        required: 0,
        percent: 0,
        remainText: '给坚持这件事一点期待。',
      };
    }

    // 体重入口（弱化）
    const todayWeightCard: TodayWeightEntry = (() => {
      const rec = weightService.findTodayRecord();
      if (!rec) return { hasTodayRecord: false, todayKgText: '今天还没有记录体重', diffText: '' };
      const diff = weightService.calcTodayDiff(today);
      return {
        hasTodayRecord: true,
        todayKgText: `${rec.weight.toFixed(1)} kg`,
        diffText: diff?.diffText || '',
      };
    })();

    // 三餐摘要：MealRecord 为唯一真实来源
    const meals = loadAllMealRecords();
    const mealCards: MealCardItem[] = [
      buildMealCard('breakfast', '早餐', findMealRecord(meals, today, 'breakfast')),
      buildMealCard('lunch',     '午餐', findMealRecord(meals, today, 'lunch')),
      buildMealCard('dinner',    '晚餐', findMealRecord(meals, today, 'dinner')),
    ];

    // 首次欢迎卡：未标记显示过 + 今日还没记任何一餐 → 展示
    const anyMealDone = mealCards.some(c => c.recorded);
    const showWelcomeCard = !welcomeAlreadyShown() && !anyMealDone;

    // ================================================================
    // V12：养成核心
    // 1) 先计算 grant 前的"已完成任务数"用于 FIRST/SECOND/ALL 瞬时反馈
    // 2) 给已完成任务发能量（幂等，不重复发放）
    //    如果有升级 → this._pendingLevelUp 稍后弹层
    // 3) 旅程卡解锁 ensureJourneyCardsUnlocked(planDay)
    // 4) 再计算 UI 展示的 companion / dailyTasks / specialTask
    // ================================================================
    let levelUpFromGrant: any = null;
    const _tasksBeforeRaw = computeDailyTasksForDate(today);
    const _countBeforeGrant: 0 | 1 | 2 | 3 = (() => {
      let n = 0; for (const t of _tasksBeforeRaw) if (t.completed) n++;
      return (n > 3 ? 3 : n) as 0 | 1 | 2 | 3;
    })();

    let gr: any = null;
    try {
      gr = companionService.grantEnergyForCompletedDailyTasks(today);
      if (gr && gr.levelUp) levelUpFromGrant = gr.levelUp;
    } catch (e) {
      console.warn('[index] grantEnergyForCompletedDailyTasks failed', e);
    }

    // 旅程卡解锁（按 planDay；升级不一定同站，同一天先到 Day7 就解锁 Day7）
    let journeyCardsResult: any = null;
    try { journeyCardsResult = companionService.ensureJourneyCardsUnlocked(planDay); }
    catch (e) { console.warn('[index] ensureJourneyCardsUnlocked failed', e); }

    // --- V12.1：任务完成 → 决定瞬时覆盖层（task1 / task2 / all3）---
    const _tasksAfterRaw = computeDailyTasksForDate(today);
    const _countAfterGrant: 0 | 1 | 2 | 3 = (() => {
      let n = 0; for (const t of _tasksAfterRaw) if (t.completed) n++;
      return (n > 3 ? 3 : n) as 0 | 1 | 2 | 3;
    })();

    // V13：世界状态只从 MealRecord / DailyRecord / UserPlan 派生。
    // previous 只用于判断“刚刚发生”的视觉反馈，不参与业务完成判定。
    const previousWorldState: WorldState | null = (this as any).__worldStateReady
      ? ((this.data as IndexPageData).worldState || null)
      : null;
    const worldState = buildWorldState({ date: today, planDay });
    const worldPresentation = syncWorldUiState(worldState, today);
    const worldFeedbackQueue = buildWorldFeedbackQueue(previousWorldState, worldState, worldPresentation, today);
    const worldTransition = emptyWorldTransition();
    (this as any).__worldStateReady = true;
    const worldAssets = getWorldAssetSet(worldState.plantLevel, worldState.pathLevel, worldState.waterLevel);
    const discoveryResult = syncWorldDiscoveries({
      mealDays: worldState.mealActiveDays,
      exerciseDays: worldState.exerciseGoalDays,
      meaningfulDays: worldState.meaningfulDays,
      allCompleteDays: worldState.allCompleteDays,
      planDay,
    });
    if (discoveryResult.toAnnounce) (this as any).__pendingDiscovery = discoveryResult.toAnnounce;

    const _newlyAwardedKeys: string[] = gr && Array.isArray(gr.newlyAwarded) ? gr.newlyAwarded.map((x: any) => String(x.key || '')) : [];
    const _bonusAwarded: boolean = !!(gr && gr.bonusAwarded);
    // transient 候选：
    //   - 如果 3/3 刚全完成（bonusAwarded 或 countBefore=2 && countAfter=3 且存在 _newlyAwardedKeys 最后一条）→ all3 + sparkles + 2.2s
    //   - 否则若 countAfter=1 && countBefore < 1 → task1（第一条完成）
    //   - 否则若 countAfter=2 && countBefore < 2 → task2（第二条完成）
    //   - special task completed 不在 refreshAll 里（由 onClickCompleteSpecialTask 主动 trigger transient）
    let _transientKind: CompanionCardVM['transientKind'] = '';
    let _transientMessage = '';
    let _transientMs = 0;
    const _allJustDone = !!_bonusAwarded ||
      (_countAfterGrant === 3 && _countBeforeGrant < 3);
    if (_allJustDone && worldFeedbackQueue.length === 0) {
      _transientKind = 'all3';
      _transientMessage = pickAllThreeDoneMessage();
      _transientMs = 2800;
    } else if (_countAfterGrant === 1 && _countBeforeGrant < 1 && _newlyAwardedKeys.length > 0) {
      _transientKind = 'task1';
      _transientMessage = pickFirstTaskFeedback(today);
      _transientMs = 1800;
    } else if (_countAfterGrant === 2 && _countBeforeGrant < 2 && _newlyAwardedKeys.length > 0) {
      _transientKind = 'task2';
      _transientMessage = pickSecondTaskFeedback(today);
      _transientMs = 1800;
    }

    // --- V12: 小轻角色卡片 VM ---
    const totalEnergy = calculateTotalEnergy();
    const level = computeLevelByEnergy(totalEnergy);
    const growth = computeGrowthLevel(totalEnergy);
    const nextG = (GROWTH_CONFIG as any[]).find((g: any) => g.level === level + 1) || null;
    const energyToNext = getEnergyToNextLevel(totalEnergy);
    const progressPercent = computeLevelProgressPercent(totalEnergy);
    const visualStage = computeVisualStage(totalEnergy);
    const visualStageKey = computeVisualStageKey(totalEnergy);
    const completedCount = _countAfterGrant;
    const moodBase = computeMoodByCompletedTasks(completedCount);
    const asset = getCompanionRenderAsset(visualStageKey, _transientKind ? 'happy' : moodBase);

    // 当前解锁的"最新称号"
    const compState = loadCompanionState();
    let latestTitle = growth.title;
    if (compState && compState.unlockedTitles && compState.unlockedTitles.length > 0) {
      latestTitle = compState.unlockedTitles[compState.unlockedTitles.length - 1];
    }

    const openingMsg = companionService.pickCompanionOpeningMessage(today, completedCount);
    const baseMessage = openingMsg.message;

    let energyBandText: string;
    if (!nextG) {
      energyBandText = `${totalEnergy} / ${growth.requiredEnergy}`;
    } else {
      energyBandText = `${totalEnergy} / ${nextG.requiredEnergy}`;
    }
    let toNextText: string;
    if (!nextG) toNextText = '已到顶，继续加油 ✨';
    else if (energyToNext === null || energyToNext <= 0) toNextText = '即将升级';
    else toNextText = `再获得${energyToNext}能量升级`;

    const nowMs = Date.now();
    const companionVM: CompanionCardVM = {
      name: compState ? (compState.name || '小轻') : '小轻',
      level,
      levelName: growth.name,
      title: latestTitle,
      visualStage: visualStage as 1 | 2 | 3 | 4,
      visualStageKey,
      mood: moodBase,
      asset,
      transientActive: !!_transientKind,
      transientUntilMs: _transientKind ? (nowMs + _transientMs) : 0,
      transientMood: _allJustDone ? 'happy' : 'happy',
      transientMessage: _transientMessage,
      transientKind: _transientKind as any,
      sparkleAllDone: _allJustDone,
      tapPulse: false,
      totalEnergy,
      nextRequiredEnergy: nextG ? nextG.requiredEnergy : growth.requiredEnergy,
      toNextText,
      progressPercent,
      energyBandText,
      message: baseMessage,
      completedCount,
    };

    // --- V12: 每日3任务 VM ---
    const taskRaw = computeDailyTasksForDate(today);
    const dailyTasks: DailyTaskCardVM[] = taskRaw.map((t: DailyTaskVM) => {
      let prog = '';
      if (t.unitText) prog = `${t.current} / ${t.target} ${t.unitText}`;
      else prog = `${t.current} / ${t.target}`;
      return {
        key: t.key,
        title: t.def.title,
        emoji: t.def.emoji,
        completed: !!t.completed,
        progressText: prog,
        amount: t.amount,
        energyAwarded: !!t.energyAwarded,
      };
    });
    // 3 任务全部完成 bonus 是否已发
    const allDone = dailyTasks.every((t) => t.completed);
    const allDailyCompleteBonusAwarded = (() => {
      try {
        // 直接读 ledger（与 utils/dailyTasks.isDailyAllCompleteBonusAwarded 语义一致）
        const ledger = loadEnergyLedger();
        return Array.isArray(ledger) && ledger.some((l: any) =>
          l.date === today && l.source === 'daily_all_complete' && l.sourceId === today);
      } catch { return false; }
    })();

    // --- V12: 特别任务 VM ---
    const st = getSpecialTaskForDate(today);
    const specialTask: SpecialTaskCardVM = {
      visible: !!st.shown,
      text: st.text,
      amount: st.amount,
      skipped: isSpecialTaskSkipped(today),
      completed: isSpecialTaskEnergyAwarded(today),
    };

    // --- V12: 升级弹层（grantEnergyForCompletedDailyTasks 时检测到升级，或"旅程卡本次新解锁"也会被合并提示）---
    if (levelUpFromGrant || (journeyCardsResult && journeyCardsResult.newlyUnlocked && journeyCardsResult.newlyUnlocked.length > 0)) {
      const lu = (levelUpFromGrant as { from: number; to: number }) || { from: level, to: level };
      const titles: string[] = [];
      for (let l = lu.from + 1; l <= lu.to; l++) {
        const g = GROWTH_CONFIG.find((x) => x.level === l);
        if (g && g.title) titles.push(g.title);
      }
      const actionsCount = (() => {
        try {
          const ledger = loadEnergyLedger();
          return Array.isArray(ledger) ? ledger.length : 0;
        } catch { return 0; }
      })();
      const toGrowth = GROWTH_CONFIG.find((g) => g.level === lu.to) || GROWTH_CONFIG[0];
      const toStageNum: 1 | 2 | 3 | 4 = (toGrowth && typeof toGrowth.visualStage === 'number')
        ? (toGrowth.visualStage as any) : 1;
      const toStageKey = (function () {
        try {
          // 动态按 toLevel 的能量门槛计算视觉阶段
          const fakeTotal = toGrowth && typeof toGrowth.requiredEnergy === 'number'
            ? toGrowth.requiredEnergy
            : totalEnergy;
          return computeVisualStageKey(fakeTotal);
        } catch { return 'baby' as CompanionVisualStage; }
      })();
      const assetAfter = getCompanionRenderAsset(toStageKey, 'happy');
      const journeyCardsUnlocked: LevelUpJourneyCardHintVM[] = (() => {
        const newly = journeyCardsResult && Array.isArray(journeyCardsResult.newlyUnlocked) ? journeyCardsResult.newlyUnlocked : [];
        return newly.map((x: any) => ({
          id: String((x.card && x.card.id) || ''),
          shortTitle: (x.card && String(x.card.shortTitle || '')) || '',
          emoji: (x.card && String(x.card.emoji || '')) || '🟟',
        })).filter((x: LevelUpJourneyCardHintVM) => x.id && x.shortTitle);
      })();
      // 同时"升级 + 旅程卡"时升级弹层会展示；没有升级但只有旅程卡时也弹一个轻量提示（不弹 modal，避免打扰；改在角色卡 transient 里显示"解锁旅程卡"文案 3s）
      if (levelUpFromGrant) {
        (this as any).__pendingLevelUp = {
          visible: true,
          from: lu.from,
          to: lu.to,
          levelName: toGrowth.name,
          titles,
          actionsCount,
          assetAfter,
          journeyCardsUnlocked,
          banner: `我们已经一起完成了${actionsCount}个小行动。`,
        };
      } else {
        // 只有旅程卡解锁：用 transient 'levelup' 类型 banner 1.8s（不弹 modal，避免打扰）
        const newCard = journeyCardsUnlocked[0];
        if (newCard) {
          companionVM.transientActive = true;
          companionVM.transientKind = 'levelup';
          companionVM.transientMood = 'happy';
          companionVM.transientMessage = `获得新的旅程卡 · ${newCard.shortTitle} ✨`;
          companionVM.transientUntilMs = Date.now() + 3000;
        }
      }
    }

    this.setData({
      dateCN: formatDateCN(today),
      planDay,
      encourageMessage: msg,

      hasPlan,
      planTitle,
      planDurationDays,
      planProgressPercent,
      planProgressText,
      showPlanSettingsEntry,
      worldHeaderText,
      worldSubtitleText,

      weeklySummaryEntry,
      planCompletedEntry,
      joinPlanPrompt,

      completionPercent: snap.completionPercent,

      mealCards,
      exerciseMinutes: snap.record.exerciseMinutes,
      waterCups: snap.record.waterCups,
      exerciseCompleted: snap.completed.indexOf('exercise') !== -1,
      waterCompleted: snap.completed.indexOf('water') !== -1,

      effectiveExerciseGoal,
      effectiveWaterGoal,

      todayPoints: snap.dailyPoints,
      totalPoints,

      nextReward: nextCard,
      todayWeight: todayWeightCard,

      showWelcomeCard,
      welcomeRecommendMeal: showWelcomeCard ? guessNextMealByTime() : 'lunch',

      // ---------- V12 养成 ----------
      companion: companionVM,
      dailyTasks,
      allDailyCompleteBonusAwarded: !!allDone && !!allDailyCompleteBonusAwarded,
      specialTask,

      // ---------- V13 小轻世界 ----------
      worldState,
      worldTransition,
      worldAssets,
      worldDiscoveries: discoveryResult.all,
      discoveryCount: discoveryResult.all.length,
    });

    // 严格顺序：单项世界反馈 → 3/3 → 小轻升级 → 新发现。
    this._startWorldFeedbackQueue(worldFeedbackQueue);
  },

  _startWorldFeedbackQueue(queue: WorldTransition[]) {
    try {
      const timer = (this as any).__worldTransitionTimer;
      if (timer) clearTimeout(timer);
    } catch { /* ignore */ }
    (this as any).__worldFeedbackQueue = Array.isArray(queue) ? queue.slice() : [];
    this._playNextWorldFeedback();
  },

  _playNextWorldFeedback() {
    const queue = ((this as any).__worldFeedbackQueue || []) as WorldTransition[];
    const next = queue.shift();
    (this as any).__worldFeedbackQueue = queue;
    if (!next) {
      this.setData({
        worldTransition: emptyWorldTransition(),
        'companion.transientActive': false,
        'companion.transientKind': '',
        'companion.transientMessage': '',
        'companion.sparkleAllDone': false,
      });
      this._showDeferredWorldOverlay();
      return;
    }

    const today = this.today || getTodayString();
    markWorldFeedbackShown(next.kind, today);
    trackEvent(USAGE_EVENT_NAMES.WORLD_FEEDBACK_SHOWN, { feedbackType: next.kind }, { date: today });
    this.setData({
      worldTransition: next,
      'companion.transientActive': true,
      'companion.transientUntilMs': Date.now() + next.durationMs,
      'companion.transientMood': 'happy',
      'companion.transientKind': next.kind === 'all' ? 'all3' : 'task1',
      'companion.transientMessage': next.message,
      'companion.sparkleAllDone': next.kind === 'all',
    });
    (this as any).__worldTransitionTimer = setTimeout(() => {
      try { this._playNextWorldFeedback(); } catch { /* ignore */ }
    }, next.durationMs + 140);
  },

  _showDeferredWorldOverlay() {
    const data = this.data as IndexPageData;
    if (data.introCard.visible || data.showWelcomeCard) return;
    if ((this as any).__pendingLevelUp) {
      const pending = (this as any).__pendingLevelUp as LevelUpModalVM;
      delete (this as any).__pendingLevelUp;
      this.setData({ levelUpModal: pending });
      return;
    }
    this._showPendingDiscovery();
  },

  _showPendingDiscovery() {
    const pending = (this as any).__pendingDiscovery as WorldDiscoveryView | undefined;
    if (!pending) return;
    delete (this as any).__pendingDiscovery;
    markWorldDiscoverySeen(pending.state.discoveryId);
    const unlockedDate = String(pending.state.unlockedAt || '').slice(0, 10);
    this.setData({
      discoveryNotice: {
        visible: true,
        discoveryId: pending.state.discoveryId,
        emoji: pending.config.emoji,
        name: pending.config.name,
        description: pending.config.description,
        companionMessage: pending.config.companionMessage,
        unlockedAtText: unlockedDate ? `${unlockedDate} 发现` : '今天发现',
      } as DiscoveryNoticeVM,
      'companion.transientActive': true,
      'companion.transientMood': 'happy',
      'companion.transientKind': 'levelup',
      'companion.transientMessage': pending.config.companionMessage,
    });
    try {
      const oldTimer = (this as any).__discoveryNoticeTimer;
      if (oldTimer) clearTimeout(oldTimer);
      (this as any).__discoveryNoticeTimer = setTimeout(() => this.onCloseDiscoveryNotice(), 2600);
    } catch { /* ignore */ }
  },

  onCloseDiscoveryNotice() {
    try {
      const timer = (this as any).__discoveryNoticeTimer;
      if (timer) clearTimeout(timer);
    } catch { /* ignore */ }
    this.setData({
      discoveryNotice: EMPTY_DISCOVERY_NOTICE,
      'companion.transientActive': false,
      'companion.transientKind': '',
      'companion.transientMessage': '',
    });
  },

  onWorldDiscoveryTap(e: any) {
    const id = e?.detail?.discoveryId as WorldDiscoveryId;
    const view = (this.data as IndexPageData).worldDiscoveries.find((item) => item.state.discoveryId === id);
    if (!view) return;
    trackWorldDiscoveryViewed(id);
    this.setData({
      discoveryDetail: {
        visible: true,
        discoveryId: id,
        emoji: view.config.emoji,
        name: view.config.name,
        description: view.config.description,
        companionMessage: view.config.companionMessage,
        unlockedAtText: `${String(view.state.unlockedAt).slice(0, 10)} 发现`,
      } as DiscoveryNoticeVM,
    });
  },

  onCloseDiscoveryDetail() {
    this.setData({ discoveryDetail: EMPTY_DISCOVERY_NOTICE });
  },

  onOpenDiscoveries() {
    try { wx.navigateTo({ url: '/pages/discoveries/discoveries' }); } catch { /* ignore */ }
  },

  onNextUnlockTap() {
    const next = (this.data as IndexPageData).worldState.nextUnlock;
    if (!next) return;
    trackEvent(USAGE_EVENT_NAMES.NEXT_UNLOCK_VIEWED, { unlockType: next.type, remaining: next.remaining });
  },

  // ---------------- 点击：三餐 → 进入 meal 页 ----------------
  onClickMealCard(e: any) {
    const type: MealType | undefined = e?.currentTarget?.dataset?.type;
    if (type !== 'breakfast' && type !== 'lunch' && type !== 'dinner') return;
    try {
      wx.navigateTo({ url: `/pages/meal/meal?meal=${type}&date=${this.today}` });
    } catch (err) {
      console.error('[index] navigateTo meal failed', err);
    }
  },

  // ---------------- 点击：欢迎卡 → 记录第一餐 ----------------
  onClickWelcomeRecordFirst() {
    markWelcomeShown();
    const mt = this.data.welcomeRecommendMeal || 'lunch';
    try {
      wx.navigateTo({ url: `/pages/meal/meal?meal=${mt}&date=${this.today}` });
    } catch (err) {
      console.error('[index] welcome navigateTo meal failed', err);
    }
  },

  onClickWelcomeClose() {
    markWelcomeShown();
    this.setData({ showWelcomeCard: false });
    this._showDeferredWorldOverlay();
  },

  stopPropagation() { /* 阻止弹窗内部点击冒泡到遮罩层 */ },

  // ---------------- 点击：体重入口（跳进展 tab，让体重有个归属页面；也可直接记录） ----------------
  onClickWeightEntry() {
    try {
      wx.switchTab({ url: '/pages/progress/progress' });
    } catch (e) {
      console.error('[index] switchTab progress failed', e);
    }
  },

  // ---------------- 点击：运动 ----------------
  openExerciseInput() {
    const current = this.data?.exerciseMinutes ?? 0;
    const goal = (this.data as IndexPageData).effectiveExerciseGoal || EXERCISE_TARGET_MINUTES;
    this.setData({
      showExerciseModal: true,
      exerciseModalValue: '',
      exerciseModalCurrent: current,
      exerciseModalGoal: goal,
    });
  },

  onExerciseModalInput(e: any) {
    const v = String(e?.detail?.value ?? '');
    this.setData({ exerciseModalValue: v });
  },

  onExerciseModalCancel() {
    this.setData({ showExerciseModal: false, exerciseModalValue: '' });
  },

  onExerciseModalSave() {
    const that = this;
    const raw = (this.data as IndexPageData).exerciseModalValue.trim();
    const current = (this.data as IndexPageData).exerciseModalCurrent;
    const goal = (this.data as IndexPageData).exerciseModalGoal;

    if (!raw) {
      wx.showToast({ title: '请输入运动分钟数', icon: 'none' });
      return;
    }
    let num = parseInt(raw, 10);
    if (isNaN(num) || num < 0) {
      wx.showToast({ title: '请输入不小于 0 的数字', icon: 'none' });
      return;
    }
    if (num > 1440) num = 1440;

    const beforePoints = calculateDailyPoints(this.today);
    try {
      updateDailyRecord(that.today, (old) => {
        old.exerciseMinutes = num;
        return old;
      });
    } catch (e) {
      wx.showToast({ title: uiStrings.toUserFriendlyError(e, UI_MSG.STORAGE_SAVE_FAIL), icon: 'none' });
      return;
    }
    try { trackExerciseSaved(num); } catch { /* ignore */ }

    this.setData({ showExerciseModal: false, exerciseModalValue: '' });
    that.refreshAll();
    const afterPoints = calculateDailyPoints(that.today);
    const delta = afterPoints - beforePoints;
    if (delta > 0) {
      wx.showToast({ title: `达标啦，获得 ${delta} 积分`, icon: 'success' });
    } else if (num >= goal) {
      wx.showToast({ title: `已记录 ${num} 分钟，继续加油`, icon: 'success' });
    } else {
      wx.showToast({ title: `已记录 ${num} 分钟，继续加油`, icon: 'none' });
    }
  },

  // ---------------- 点击：喝水 + / - ----------------
  increaseWater() {
    const beforePoints = calculateDailyPoints(this.today);
    const goal = (this.data as IndexPageData).effectiveWaterGoal || WATER_TARGET_CUPS;
    let updated: any = null;
    try {
      updated = updateDailyRecord(this.today, (old) => {
        old.waterCups += 1;
        return old;
      });
    } catch (e) {
      wx.showToast({ title: uiStrings.toUserFriendlyError(e, UI_MSG.STORAGE_SAVE_FAIL), icon: 'none' });
      return;
    }
    // V9：每日首次喝水达成 → 写 water_goal_reached（每日只 1 次，内部已去重）
    try {
      if (updated && typeof updated.waterCups === 'number' && updated.waterCups >= goal) {
        trackWaterGoalReachedOnce(this.today);
      }
    } catch { /* ignore */ }
    this.refreshAll();
    const afterPoints = calculateDailyPoints(this.today);
    const delta = afterPoints - beforePoints;
    if (delta > 0) {
      wx.showToast({ title: `喝水达标，获得 ${delta} 积分`, icon: 'success' });
    }
  },

  decreaseWater() {
    try {
      updateDailyRecord(this.today, (old) => {
        if (old.waterCups <= 0) return old;
        old.waterCups -= 1;
        return old;
      });
    } catch (e) {
      wx.showToast({ title: uiStrings.toUserFriendlyError(e, UI_MSG.STORAGE_SAVE_FAIL), icon: 'none' });
      return;
    }
    this.refreshAll();
  },

  // ---------------- 点击：下一奖励卡片 → 奖励 Tab ----------------
  jumpToRewardTab() {
    try {
      wx.switchTab({ url: '/pages/reward/reward' });
    } catch (e) {
      console.error('[index] switchTab reward failed', e);
    }
  },

  // ---------------- V10：点击 hero ··· → 计划设置页 ----------------
  onOpenPlanSettings() {
    try {
      wx.navigateTo({ url: '/pages/plan-settings/plan-settings' });
    } catch (e) {
      console.error('[index] navigateTo plan-settings failed', e);
      try { wx.showToast({ title: '暂时打不开，请稍后再试。', icon: 'none' }); } catch { /* ignore */ }
    }
  },

  // ---------------- V10：点击周总结入口 → 周总结页 ----------------
  onOpenWeeklySummary() {
    const entry = (this.data as IndexPageData).weeklySummaryEntry;
    if (!entry || !entry.visible) return;
    try {
      wx.navigateTo({
        url: `/pages/weekly-summary/weekly-summary?planId=${encodeURIComponent(entry.planId)}&weekNumber=${entry.weekNumber}`,
      });
    } catch (e) {
      console.error('[index] navigateTo weekly-summary failed', e);
    }
  },

  // ---------------- V10：点击计划完成入口 → 28/90 天计划总结页 ----------------
  onOpenPlanSummary() {
    const entry = (this.data as IndexPageData).planCompletedEntry;
    if (!entry || !entry.visible) return;
    try {
      wx.navigateTo({
        url: `/pages/plan-summary/plan-summary?planId=${encodeURIComponent(entry.planId)}`,
      });
    } catch (e) {
      console.error('[index] navigateTo plan-summary failed', e);
    }
  },

  onStartNewJourney() {
    try {
      wx.navigateTo({ url: '/pages/plan-setup/plan-setup' });
    } catch (e) {
      console.error('[index] navigateTo new journey failed', e);
      try { wx.showToast({ title: '暂时打不开，请稍后再试。', icon: 'none' }); } catch { /* ignore */ }
    }
  },

  // ---------------- V10：旧用户"加入计划"提示卡 → 开始计划 ----------------
  onStartJoinPlan() {
    try {
      wx.navigateTo({ url: '/pages/plan-setup/plan-setup' });
    } catch (e) {
      console.error('[index] navigateTo plan-setup failed', e);
      try { wx.showToast({ title: '暂时打不开，请稍后再试。', icon: 'none' }); } catch { /* ignore */ }
    }
  },

  // ---------------- V10：旧用户"加入计划"提示卡 → 暂时不要 ----------------
  onDismissJoinPlan() {
    try { planService.markPlanSetupDismissed(); } catch { /* ignore */ }
    this.setData({ joinPlanPrompt: { visible: false } });
  },

  // ---------------- 开发环境：一键注入 7 天假数据 ----------------
  onClickDevSeed() {
    if (!isDevEnv()) return;
    const that = this;
    wx.showModal({
      title: '开发工具 · 注入 7 天测试数据',
      content: '会写入：7天饮食/运动/喝水/体重、3个奖励、若干AI分析结果。\n仅开发环境可用。',
      success(r) {
        if (!r.confirm) return;
        const out = seedDemoDataFor7Days({ days: 7, resetFirstLaunchDate: true });
        if (!out.ok) {
          wx.showToast({ title: out.reason || '当前环境不可用', icon: 'none' });
          return;
        }
        wx.showToast({
          title: `已写入 ${out.mealCount} 餐 / ${out.weightCount} 天体重`,
          icon: 'none'
        });
        that.refreshAll();
      }
    });
  },

  // ---------------- 开发环境：打开使用统计页 ----------------
  onClickDevOpenUsage() {
    if (!isDevEnv()) return;
    try {
      wx.navigateTo({ url: '/pages/dev-usage/dev-usage' });
    } catch (e) {
      try { wx.showToast({ title: '无法打开测试页', icon: 'none' }); } catch { /* ignore */ }
    }
  },

  // ---------------- 开发环境：清除全部测试数据（二次确认） ----------------
  onClickDevClearAllData() {
    if (!isDevEnv()) return;
    const that = this;
    wx.showModal({
      title: '清除全部测试数据',
      content: '确定清除本机所有轻一点测试数据吗？\n该操作无法恢复。',
      confirmText: '确认清除',
      cancelText: '取消',
      confirmColor: '#D04343',
      success(r) {
        if (!r.confirm) return;
        const out = clearAllTestData();
        if (!out.ok) {
          wx.showToast({ title: '清除失败', icon: 'none' });
          return;
        }
        wx.showToast({
          title: `已清除 ${out.clearedStorageKeys} 项 / ${out.deletedImageFiles} 张图片`,
          icon: 'none',
          duration: 1400,
        });
        setTimeout(() => {
          that.refreshAll();
        }, 700);
      }
    });
  },

  // ---------------- V12 养成：点击查看旅程 ----------------
  onOpenJourney() {
    try {
      wx.navigateTo({ url: '/pages/journey/journey' });
    } catch (e) {
      console.error('[index] navigateTo journey failed', e);
      try { wx.showToast({ title: '暂时打不开，请稍后再试。', icon: 'none' }); } catch { /* ignore */ }
    }
  },

  // ---------------- V12 养成：点击每日任务（跳转对应真实记录入口） ----------------
  onClickDailyTask(e: any) {
    const key: string | undefined = e?.currentTarget?.dataset?.key;
    if (!key) return;
    if (key === 'meal_any') {
      // 记录一餐：跳到"当下建议的餐"（早餐前早餐、中午午餐、晚餐时段晚餐）
      const mt = guessNextMealByTime();
      try { wx.navigateTo({ url: `/pages/meal/meal?meal=${mt}&date=${this.today}` }); }
      catch { /* ignore */ }
    } else if (key === 'exercise_min') {
      this.openExerciseInput();
    } else if (key === 'water_goal') {
      this.increaseWater();
    }
  },

  // ---------------- V12.1：点击首页小轻互动（scale pulse + cooldown 2s + tap 文案 transient） ----------------
  onClickCompanion() {
    const that = this;
    const tapRes = companionService.tryFireCompanionTap();
    if (!tapRes.ok) return;  // 冷却期内，不响应（不做任何提示）
    const today = this.today || getTodayString();
    const tapMsg = pickTapMessage(today);
    const pulseMs = 900;  // scale 1→1.05→1 的短暂效果
    const bannerMs = 1800; // 文案显示时长
    const now = Date.now();
    try {
      const cur = (that.data as IndexPageData).companion || emptyCompanion();
      that.setData({
        companion: {
          ...cur,
          tapPulse: true,
          transientActive: true,
          transientKind: 'tap',
          transientMood: 'happy',
          transientMessage: tapMsg,
          transientUntilMs: now + bannerMs,
        },
      });
    } catch { /* ignore */ }
    // pulse 自动收
    setTimeout(() => {
      try {
        const c = (that.data as IndexPageData).companion;
        if (c) that.setData({ 'companion.tapPulse': false });
      } catch { /* ignore */ }
    }, pulseMs);
    // banner 自动收
    setTimeout(() => {
      try {
        const c = (that.data as IndexPageData).companion;
        if (c && c.transientUntilMs <= Date.now()) {
          that.setData({
            'companion.transientActive': false,
            'companion.transientKind': '',
            'companion.transientMessage': '',
            'companion.sparkleAllDone': false,
          });
        }
      } catch { /* ignore */ }
    }, bannerMs + 120);
  },

  // ---------------- V12 养成：点击"我完成了"特别任务 ----------------
  onClickCompleteSpecialTask() {
    const that = this;
    try {
      const r = companionService.completeSpecialTask(this.today);
      if (!r.awarded && r.existed) {
        wx.showToast({ title: '今天的小挑战能量已领取', icon: 'none' });
      } else if (!r.awarded) {
        wx.showToast({ title: '暂时无法领取，稍后再试', icon: 'none' });
      } else {
        wx.showToast({ title: `+${r.amount} 轻能量 ✨`, icon: 'none' });
        // 特别任务完成：角色短暂 happy + 文案 "小挑战也完成啦 ✨"
        const today = this.today || getTodayString();
        const doneMsg = pickSpecialTaskDoneMessage(today);
        const bannerMs = 2400;
        const now = Date.now();
        try {
          const cur = (that.data as IndexPageData).companion;
          if (cur) that.setData({
            companion: {
              ...cur,
              transientActive: true,
              transientKind: 'specialDone',
              transientMood: 'happy',
              transientMessage: doneMsg,
              transientUntilMs: now + bannerMs,
              sparkleAllDone: true,
            },
          });
          setTimeout(() => {
            try {
              const c = (that.data as IndexPageData).companion;
              if (c && c.transientUntilMs <= Date.now()) {
                that.setData({
                  'companion.transientActive': false,
                  'companion.transientKind': '',
                  'companion.transientMessage': '',
                  'companion.sparkleAllDone': false,
                });
              }
            } catch { /* ignore */ }
          }, bannerMs + 150);
        } catch { /* ignore */ }
      }
      that.refreshAll();
      // 升级弹层（如果 completeSpecialTask 触发了升级）—— V12.1 同步 assetAfter + journeyCardsUnlocked
      if (r.levelUp) {
        const lu = r.levelUp as { from: number; to: number };
        const titles: string[] = [];
        for (let l = lu.from + 1; l <= lu.to; l++) {
          const g = GROWTH_CONFIG.find((x) => x.level === l);
          if (g && g.title) titles.push(g.title);
        }
        let actionsCount = 0;
        try {
          const ledger = loadEnergyLedger();
          actionsCount = Array.isArray(ledger) ? ledger.length : 0;
        } catch { /* ignore */ }
        const toGrowth = GROWTH_CONFIG.find((g) => g.level === lu.to) || GROWTH_CONFIG[0];
        const toStageKey = (() => {
          try {
            const fakeTotal = toGrowth && typeof toGrowth.requiredEnergy === 'number'
              ? toGrowth.requiredEnergy : 0;
            return computeVisualStageKey(fakeTotal);
          } catch { return 'baby' as CompanionVisualStage; }
        })();
        const assetAfter = getCompanionRenderAsset(toStageKey, 'happy');
        setTimeout(() => {
          try {
            // 顺便解锁旅程卡（若完成特别任务当天正好 planDay 跨站）
            let plan = null;
            let planDay = 1;
            try { plan = planService.loadActivePlan(); } catch { plan = null; }
            try {
              planDay = plan
                ? Math.max(1, calculatePlanDay(plan.startDate, that.today || getTodayString()))
                : 1;
            } catch { planDay = 1; }
            let newlyCards: LevelUpJourneyCardHintVM[] = [];
            try {
              const jcRes = companionService.ensureJourneyCardsUnlocked(planDay);
              newlyCards = (jcRes.newlyUnlocked || []).map((x: any) => ({
                id: String((x.card && x.card.id) || ''),
                shortTitle: String((x.card && x.card.shortTitle) || ''),
                emoji: String((x.card && x.card.emoji) || '🟟'),
              })).filter((x: any) => x.id && x.shortTitle);
            } catch { newlyCards = []; }
            that.setData({
              levelUpModal: {
                visible: true,
                from: lu.from,
                to: lu.to,
                levelName: toGrowth.name,
                titles,
                actionsCount,
                assetAfter,
                journeyCardsUnlocked: newlyCards,
                banner: `我们已经一起完成了${actionsCount}个小行动。`,
              } as LevelUpModalVM,
            });
          } catch { /* ignore */ }
        }, 180);
      }
    } catch (e) {
      console.warn('[index] completeSpecialTask failed', e);
      try { wx.showToast({ title: uiStrings.toUserFriendlyError(e, UI_MSG.STORAGE_SAVE_FAIL), icon: 'none' }); }
      catch { /* ignore */ }
      that.refreshAll();
    }
  },

  // ---------------- V12 养成：点击"今天不做这个"跳过特别任务 ----------------
  onClickSkipSpecialTask() {
    try {
      companionService.skipSpecialTask(this.today);
    } catch (e) {
      console.warn('[index] skipSpecialTask failed', e);
    }
    this.refreshAll();
  },

  // ---------------- V12 养成：关闭升级弹层 ----------------
  onCloseLevelUpModal() {
    try {
      this.setData({ levelUpModal: EMPTY_LEVELUP });
    } catch { /* ignore */ }
    this._showPendingDiscovery();
  },

  // ---------------- V12 养成：关闭"认识一下小轻"欢迎卡 ----------------
  onCloseIntroCard() {
    try { companionService.markIntroDismissed(); } catch { /* ignore */ }
    try { this.setData({ introCard: EMPTY_INTRO }); } catch { /* ignore */ }
    this._showDeferredWorldOverlay();
  },

  // ---------------- V12 开发环境：+20 能量 / +100 能量 / 模拟下一天 / 重置养成 ----------------
  onClickDevAdd20Energy() {
    if (!isDevEnv()) return;
    const that = this;
    const r = devAdd20Energy(this.today);
    wx.showToast({ title: r.ok ? `+${r.awardedAmount} 能量` : (r.reason || '失败'), icon: 'none' });
    this._afterDevEnergyAction(r.levelUp);
  },
  onClickDevAdd100Energy() {
    if (!isDevEnv()) return;
    const r = devAdd100Energy(this.today);
    wx.showToast({ title: r.ok ? `+${r.awardedAmount} 能量` : (r.reason || '失败'), icon: 'none' });
    this._afterDevEnergyAction(r.levelUp);
  },
  onClickDevSimulateNextDay() {
    if (!isDevEnv()) return;
    const r = devSimulateNextDay();
    if (!r.ok) {
      wx.showToast({ title: r.reason || '失败', icon: 'none' });
      return;
    }
    this.today = r.newDate || getTodayString();
    wx.showToast({ title: `模拟进入 ${this.today}`, icon: 'none' });
    this.refreshAll();
  },
  onClickDevResetCompanion() {
    if (!isDevEnv()) return;
    const that = this;
    wx.showModal({
      title: '开发 · 重置养成系统',
      content: '会清除 energy_ledger / companion_state / 特别任务跳过 / 欢迎标记。\n仅开发环境。',
      confirmColor: '#D04343',
      success(res) {
        if (!res.confirm) return;
        const r = devResetCompanionSystem();
        if (!r.ok) {
          wx.showToast({ title: r.reason || '失败', icon: 'none' });
          return;
        }
        // 重置后重新初始化（会重新显示欢迎卡 + +50 欢迎能量）
        try {
          const ri = companionService.ensureCompanionAndMaybeWelcome();
          that.setData({
            introCard: {
              visible: !!ri.showIntro,
              welcomeBonusGivenNow: !!ri.welcomeBonusGivenNow,
            },
          });
        } catch { /* ignore */ }
        wx.showToast({ title: '养成系统已重置', icon: 'none' });
        that.refreshAll();
      },
    });
  },

  onClickDevUnlockJourneyDay28() {
    if (!isDevEnv()) return;
    const r = devUnlockJourneyCardsToDay(28);
    if (!r.ok) { wx.showToast({ title: r.reason || '失败', icon: 'none' }); return; }
    wx.showToast({ title: `本次新解锁 ${r.unlockedCount} 张`, icon: 'none' });
    this.refreshAll();
  },
  onClickDevClearJourneyCards() {
    if (!isDevEnv()) return;
    const r = devClearJourneyCards();
    if (!r.ok) { wx.showToast({ title: r.reason || '失败', icon: 'none' }); return; }
    wx.showToast({ title: '旅程卡解锁已重置', icon: 'none' });
    this.refreshAll();
  },

  _afterDevEnergyAction(levelUp: { from: number; to: number } | null) {
    const that = this;
    this.refreshAll();
    if (levelUp) {
      const titles: string[] = [];
      for (let l = levelUp.from + 1; l <= levelUp.to; l++) {
        const g = GROWTH_CONFIG.find((x) => x.level === l);
        if (g && g.title) titles.push(g.title);
      }
      let actionsCount = 0;
      try {
        const ledger = loadEnergyLedger();
        actionsCount = Array.isArray(ledger) ? ledger.length : 0;
      } catch { /* ignore */ }
      const toGrowth = GROWTH_CONFIG.find((g) => g.level === levelUp.to) || GROWTH_CONFIG[0];
      const toStageKey = (() => {
        try {
          const fakeTotal = toGrowth && typeof toGrowth.requiredEnergy === 'number'
            ? toGrowth.requiredEnergy : 0;
          return computeVisualStageKey(fakeTotal);
        } catch { return 'baby' as CompanionVisualStage; }
      })();
      const assetAfter = getCompanionRenderAsset(toStageKey, 'happy');
      setTimeout(() => {
        try {
          // 旅程卡解锁（开发按钮当天正好 planDay 跨站）
          let plan = null;
          let planDay = 1;
          try { plan = planService.loadActivePlan(); } catch { plan = null; }
          try {
            const today = that.today || getTodayString();
            planDay = plan
              ? Math.max(1, calculatePlanDay(plan.startDate, today))
              : 1;
          } catch { planDay = 1; }
          let newlyCards: LevelUpJourneyCardHintVM[] = [];
          try {
            const jcRes = companionService.ensureJourneyCardsUnlocked(planDay);
            newlyCards = (jcRes.newlyUnlocked || []).map((x: any) => ({
              id: String((x.card && x.card.id) || ''),
              shortTitle: String((x.card && x.card.shortTitle) || ''),
              emoji: String((x.card && x.card.emoji) || '🟟'),
            })).filter((x: any) => x.id && x.shortTitle);
          } catch { newlyCards = []; }
          that.setData({
            levelUpModal: {
              visible: true,
              from: levelUp.from,
              to: levelUp.to,
              levelName: toGrowth.name,
              titles,
              actionsCount,
              assetAfter,
              journeyCardsUnlocked: newlyCards,
              banner: `我们已经一起完成了${actionsCount}个小行动。`,
            } as LevelUpModalVM,
          });
        } catch { /* ignore */ }
      }, 180);
    }
  },
});
