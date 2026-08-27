// pages/dev-usage/dev-usage.ts - V9 开发环境测试统计页（仅 develop 版本可用）
import {
  calculateUsageAggregate,
  loadAllUsageEvents,
  UsageAggregate,
} from '../../services/usageService';
import * as feedbackService from '../../services/feedbackService';
import { isDevEnv } from '../../services/devService';
import {
  getLocalStorageStats,
  getLocalImageStats,
  clearAllTestData,
  LocalStorageStats,
  LocalImageStats,
} from '../../services/devDataService';
import {
  UserFeedback,
  FEEDBACK_RATING_LABEL,
  FeedbackRating,
} from '../../types/index';
import { formatDateCN } from '../../utils/date';

interface CoreMetricsRow {
  label: string;
  value: string;
  sub?: string;
  accent?: 'hero' | 'good' | 'warn' | 'muted';
}

interface DailyMatrixRowVM {
  day: number;
  dateCN: string;
  activeIcon: string;     // ✅ ❌ —
  meaningfulIcon: string;
  breakfast: number;
  lunch: number;
  dinner: number;
  exercise: string;       // '目标' or ''
  weight: string;         // '已记' or ''
  water: string;          // '达标' or ''
}

interface FeedbackCounts {
  good: number; okay: number; difficult: number;
  total: number;
}

interface RecentFeedbackRow {
  id: string;
  ratingLabel: string;
  ratingClass: string;
  contentPreview: string;  // 最多 100 字
  createdAt: string;
}

interface DevUsagePageData {
  devAccessOk: boolean;     // 非 develop 直接锁页面，不显示任何内容
  firstLaunchDate: string;
  testStartDate: string;
  testStartDateCN: string;

  // 6 大核心指标（V9-19 固定顶部）
  coreActiveDays: string;      // "5 / 7"
  coreMeaningfulDays: string;  // "4 / 7"
  coreTotalMeals: string;      // "11"
  coreExerciseDays: string;    // "3"
  coreRedeemedRewards: string; // "1"
  coreAiStarted: string;       // "6"

  // 顶部主卡片 18 项详情
  coreMetricsRows: CoreMetricsRow[];

  // 7 天 active & meaningful 两行
  dailyActiveMark: DailyMatrixRowVM[];
  dailyMeaningfulMark: DailyMatrixRowVM[];

  // 三餐次数
  breakfastTotal: number;
  lunchTotal: number;
  dinnerTotal: number;
  mealPhotoAdded: number;

  // 运动 / 体重 / 奖励 / AI
  exerciseSavedDays: number;
  weightSavedDays: number;
  rewardsCreated: number;
  rewardsUnlocked: number;
  rewardsRedeemed: number;
  aiStarted: number;
  aiSucceeded: number;
  aiFailed: number;
  aiSuccessRateText: string;

  // 反馈统计
  feedbackCounts: FeedbackCounts;
  recentFeedback: RecentFeedbackRow[];

  // 本地 Storage / 图片
  storageStats: LocalStorageStats;
  imageStats: LocalImageStats;
  storageKbText: string;
  imageUsageText: string;

  // 最近性能（展示 median + P95，合并在一个 text 里）
  medianAppLaunchMsText: string;
  medianMealSaveMsText: string;
}

function formatKbOrMb(kb: number, bytes = kb * 1024): string {
  if (bytes < 1024) return `${bytes} B`;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

function medianNumber(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

/** V9-fix4：P95 百分位（取第 95% 位置，向上取整） */
function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx];
}

Page<DevUsagePageData, WechatMiniprogram.Page.CustomOption>({
  data: {
    devAccessOk: false,
    firstLaunchDate: '',
    testStartDate: '',
    testStartDateCN: '',
    coreActiveDays: '- / 7',
    coreMeaningfulDays: '- / 7',
    coreTotalMeals: '0',
    coreExerciseDays: '0',
    coreRedeemedRewards: '0',
    coreAiStarted: '0',
    coreMetricsRows: [],
    dailyActiveMark: [],
    dailyMeaningfulMark: [],
    breakfastTotal: 0,
    lunchTotal: 0,
    dinnerTotal: 0,
    mealPhotoAdded: 0,
    exerciseSavedDays: 0,
    weightSavedDays: 0,
    rewardsCreated: 0,
    rewardsUnlocked: 0,
    rewardsRedeemed: 0,
    aiStarted: 0,
    aiSucceeded: 0,
    aiFailed: 0,
    aiSuccessRateText: '--',
    feedbackCounts: { good: 0, okay: 0, difficult: 0, total: 0 },
    recentFeedback: [],
    storageStats: { ok: false, keysCount: 0, currentSizeKb: 0, currentSizeBytes: 0, limitSizeKb: 0 },
    imageStats: { ok: false, imageFilesCount: 0, totalSizeBytes: 0, totalSizeKb: 0, imageDirPath: '' },
    storageKbText: '--',
    imageUsageText: '--',
    medianAppLaunchMsText: '--',
    medianMealSaveMsText: '--',
  } as DevUsagePageData,

  _computeFromFirstLaunch(): string {
    try {
      const v = wx.getStorageSync('app_first_launch_date');
      return typeof v === 'string' ? v : '';
    } catch { return ''; }
  },

  onLoad() {
    const devOk = isDevEnv();
    this.setData({ devAccessOk: devOk }, () => this.refreshAll());
  },

  onPullDownRefresh() {
    this.refreshAll();
    try { wx.stopPullDownRefresh(); } catch { /* ignore */ }
  },

  _buildDailyMatrix(agg: UsageAggregate): { active: DailyMatrixRowVM[]; meaningful: DailyMatrixRowVM[] } {
    const active: DailyMatrixRowVM[] = [];
    const meaningful: DailyMatrixRowVM[] = [];
    for (const r of agg.dailyMatrix) {
      const activeIcon: string = r.isFuture ? '—' : (r.active ? '✅' : '❌');
      const meaningIcon: string = r.isFuture ? '—' : (r.meaningful ? '✅' : '❌');
      const common: DailyMatrixRowVM = {
        day: r.day,
        dateCN: formatDateCN(r.date),
        activeIcon,
        meaningfulIcon: meaningIcon,
        breakfast: r.meals.breakfast,
        lunch: r.meals.lunch,
        dinner: r.meals.dinner,
        exercise: r.hasExerciseGoal ? '目标' : '',
        weight: r.hasWeight ? '已记' : '',
        water: r.waterReached ? '达标' : '',
      };
      active.push(Object.assign({}, common));
      meaningful.push(Object.assign({}, common));
    }
    return { active, meaningful };
  },

  _buildRecentFeedback(list: UserFeedback[]): RecentFeedbackRow[] {
    return list.slice(0, 10).map((f) => {
      const raw = f.content || '';
      const preview = raw.length > 100 ? `${raw.slice(0, 100)}…` : raw;
      let ratingClass = 'fb-good';
      if (f.rating === 'okay') ratingClass = 'fb-okay';
      else if (f.rating === 'difficult') ratingClass = 'fb-diff';
      return {
        id: f.id,
        ratingLabel: FEEDBACK_RATING_LABEL[f.rating],
        ratingClass,
        contentPreview: preview,
        createdAt: f.createdAt,
      };
    });
  },

  refreshAll() {
    if (!this.data.devAccessOk) return;
    const firstLaunch = this._computeFromFirstLaunch();
    const agg = calculateUsageAggregate(firstLaunch || null);
    const fbList = feedbackService.loadAllFeedback();

    // 1. 6 核心指标
    const coreActiveDays = `${agg.activeDays7} / 7`;
    const coreMeaningfulDays = `${agg.meaningfulDays7} / 7`;
    const coreTotalMeals = String(agg.totalMeals7);
    const coreExerciseDays = String(agg.exerciseDays7);
    const coreRedeemed = String(agg.redeemedRewards);
    const coreAi = String(agg.aiStarted);

    // 18 项详情
    const rows: CoreMetricsRow[] = [];
    rows.push({ label: '测试开始', value: agg.testStartDate ? formatDateCN(agg.testStartDate) : '--', accent: 'hero' });
    rows.push({ label: '使用天数（已过）', value: `${agg.testDaysPassed} / 7` });
    rows.push({ label: '打开小程序（总次数）', value: `${agg.totalCounts.appOpenCount}次` });
    rows.push({ label: '打开天数（日期去重）', value: `${agg.totalCounts.appActiveDays} 天` });
    rows.push({ label: '真正记录天数', value: `${agg.totalCounts.meaningfulTotalDays} 天`, accent: 'good' });

    const fb: FeedbackCounts = {
      good: fbList.filter((x) => x.rating === 'good').length,
      okay: fbList.filter((x) => x.rating === 'okay').length,
      difficult: fbList.filter((x) => x.rating === 'difficult').length,
      total: fbList.length,
    };

    const { active, meaningful } = this._buildDailyMatrix(agg);

    const aiSR = agg.aiSuccessRate;
    const aiSRText: string =
      agg.totalCounts.aiStarted === 0 ? '还没有点过AI分析' :
      typeof aiSR === 'number' ? `${aiSR}% (${agg.totalCounts.aiSucceeded}成功 / ${agg.totalCounts.aiFailed}失败)` :
      '--';

    const ss = getLocalStorageStats();
    const im = getLocalImageStats();
    const storageText = ss.ok
      ? `${formatKbOrMb(ss.currentSizeKb, ss.currentSizeBytes)}（${ss.keysCount} keys，上限 ${ss.limitSizeKb ? formatKbOrMb(ss.limitSizeKb, ss.limitSizeKb * 1024) : '--'}）`
      : '读取失败';
    const imageText = im.ok
      ? `${im.imageFilesCount} 张 / ${formatKbOrMb(im.totalSizeKb, im.totalSizeBytes)}`
      : '读取失败';

    // 性能中位数 + P95
    const events = loadAllUsageEvents();
    const perfL: number[] = [];
    const perfM: number[] = [];
    for (const ev of events) {
      if (ev.eventName === 'perf_app_launch_ms') {
        const m = (ev.metadata as any)?.ms;
        if (typeof m === 'number' && m >= 0) perfL.push(m);
      } else if (ev.eventName === 'perf_meal_save_ms') {
        const m = (ev.metadata as any)?.ms;
        if (typeof m === 'number' && m >= 0) perfM.push(m);
      }
    }
    const medL = medianNumber(perfL);
    const medM = medianNumber(perfM);
    const p95L = percentile95(perfL);
    const p95M = percentile95(perfM);
    const medLText = perfL.length > 0 ? `${medL}ms（P95 ${p95L}ms · ${perfL.length}次）` : '暂无';
    const medMText = perfM.length > 0 ? `${medM}ms（P95 ${p95M}ms · ${perfM.length}次）` : '暂无';

    this.setData({
      firstLaunchDate: firstLaunch,
      testStartDate: agg.testStartDate || firstLaunch || '',
      testStartDateCN: agg.testStartDate ? formatDateCN(agg.testStartDate) : (firstLaunch ? formatDateCN(firstLaunch) : '--'),
      coreActiveDays,
      coreMeaningfulDays,
      coreTotalMeals,
      coreExerciseDays,
      coreRedeemedRewards: coreRedeemed,
      coreAiStarted: coreAi,
      coreMetricsRows: rows,
      dailyActiveMark: active,
      dailyMeaningfulMark: meaningful,
      breakfastTotal: agg.totalCounts.breakfastCreated,
      lunchTotal: agg.totalCounts.lunchCreated,
      dinnerTotal: agg.totalCounts.dinnerCreated,
      mealPhotoAdded: agg.totalCounts.mealPhotoAdded,
      exerciseSavedDays: agg.totalCounts.exerciseSavedDays,
      weightSavedDays: agg.totalCounts.weightSavedDays,
      rewardsCreated: agg.totalCounts.rewardsCreated,
      rewardsUnlocked: agg.totalCounts.rewardsUnlocked,
      rewardsRedeemed: agg.totalCounts.rewardsRedeemed,
      aiStarted: agg.totalCounts.aiStarted,
      aiSucceeded: agg.totalCounts.aiSucceeded,
      aiFailed: agg.totalCounts.aiFailed,
      aiSuccessRateText: aiSRText,
      feedbackCounts: fb,
      recentFeedback: this._buildRecentFeedback(fbList),
      storageStats: ss,
      imageStats: im,
      storageKbText: storageText,
      imageUsageText: imageText,
      medianAppLaunchMsText: medLText,
      medianMealSaveMsText: medMText,
    });
  },

  // ================================================================
  // 按钮：清除全部测试数据（二次确认，仅开发环境）
  // ================================================================
  onClickClearAllData() {
    if (!isDevEnv()) return;
    const page = this;
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
          title: `已清除 ${out.clearedStorageKeys} 项存储 / ${out.deletedImageFiles} 张图片`,
          icon: 'none',
          duration: 1500,
        });
        setTimeout(() => {
          page.refreshAll();
          try {
            // 清完回到首页（因为 onboarding 进度也被清了，不建议在 dev 页继续停留）
            wx.switchTab({ url: '/pages/index/index' });
          } catch { /* ignore */ }
        }, 800);
      }
    });
  },

  onShareAppMessage() { return { title: '轻一点 · 测试统计' }; },
});
