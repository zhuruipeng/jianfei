import { WEIGHT_TREND_DAYS, WEIGHT_RECENT_LIMIT, UI_MSG, type WeeklySummary } from '../../types/index';
import { addDaysLocal, calculatePlanDay, formatDateCN, getTodayString } from '../../utils/date';
import {
  loadWeightRecords, validateWeightInput, hasRecordOnDate, saveWeight, deleteWeightRecord,
  calcWeightStats, getRecentTrendPoints, getRecentRecords, type WeightStats, type TrendPoint,
} from '../../utils/weight';
import { computeWeeklySummary } from '../../utils/weeklySummary';
import { getEffectiveExerciseGoal, getEffectiveWaterGoal } from '../../utils/summary';
import { loadActivePlan } from '../../services/planService';
import { loadAllMealRecords } from '../../services/mealService';
import { peekRecordForDate } from '../../services/dailyService';
import { toUserFriendlyError, toastSafe } from '../../services/uiStrings';
import { trackWeightSaved } from '../../services/usageService';

interface RecentRowVM { id: string; dateCN: string; weight: number }
interface GrowthItemVM { id: string; icon: string; label: string; value: string; tone: string }
interface WeekReviewVM {
  hasPlan: boolean; hasData: boolean; weekNumber: number; periodText: string;
  meaningfulDays: number; summaryText: string; growthItems: GrowthItemVM[];
}
interface ProgressPageData {
  stats: WeightStats;
  changeClass: 'negative' | 'positive' | 'zero' | 'neutral';
  weekReview: WeekReviewVM;
  trendPoints: TrendPoint[];
  canvasWidth: number; canvasHeight: number;
  yTicks: { max: string; mid: string; min: string };
  xTicks: { first: string; last: string };
  trendMessage: string;
  recentRecords: RecentRowVM[];
  showWeightModal: boolean; weightModalValue: string;
  weightModalCurrent: number | null; weightModalIsUpdate: boolean;
}

const CHART_PADDING = { top: 16, right: 14, bottom: 12, left: 10 };

function growthItems(meals = 0, exercise = 0, water = 0, all = 0): GrowthItemVM[] {
  return [
    { id: 'meal', icon: '🥗', label: '饮食记录', value: `${meals} 次`, tone: 'leaf' },
    { id: 'exercise', icon: '👟', label: '动一动', value: `${exercise} 天`, tone: 'wood' },
    { id: 'water', icon: '💧', label: '喝水达标', value: `${water} 天`, tone: 'water' },
    { id: 'all', icon: '✨', label: '三件小事', value: `${all} 天`, tone: 'sun' },
  ];
}

function emptyWeekReview(): WeekReviewVM {
  return {
    hasPlan: false, hasData: false, weekNumber: 1, periodText: '', meaningfulDays: 0,
    summaryText: '这一周还刚刚开始。完成一些小记录以后，这里会出现属于你的轻旅回顾。',
    growthItems: growthItems(),
  };
}

function summaryText(summary: WeeklySummary, allDays: number): string {
  if (summary.meaningfulDays >= 5) return '这一周大部分时间都有认真记录，继续保持现在的节奏。';
  if (summary.mealCount > 0 && summary.mealCount >= summary.exerciseGoalDays && summary.mealCount >= summary.waterGoalDays) {
    return '饮食记录是这一周坚持得最稳定的一项。';
  }
  if (summary.exerciseGoalDays > 0 && summary.exerciseGoalDays >= summary.waterGoalDays) return '这一周动起来的次数很不错。';
  if (summary.waterGoalDays > 0) return '喝水是这一周最稳定的小习惯。';
  if (allDays > 0) return '这一周已经有完整的一天，慢慢保持现在的节奏就好。';
  return '已经开始了。下一周先把一件小事保持下来就好。';
}

function buildWeekReview(): WeekReviewVM {
  const plan = loadActivePlan();
  if (!plan) return emptyWeekReview();
  const today = getTodayString();
  const planDay = Math.max(1, calculatePlanDay(plan.startDate, today));
  const maxWeek = Math.max(1, Math.floor(plan.durationDays / 7));
  const weekNumber = Math.min(maxWeek, Math.floor((planDay - 1) / 7) + 1);
  const summary = computeWeeklySummary(plan, weekNumber);
  if (!summary) return { ...emptyWeekReview(), hasPlan: true, weekNumber };

  const mealDates = new Set(loadAllMealRecords()
    .filter(meal => meal.date >= summary.startDate && meal.date <= summary.endDate && meal.date <= today)
    .map(meal => meal.date));
  const meaningfulDates = new Set(mealDates);
  loadWeightRecords()
    .filter(record => record.date >= summary.startDate && record.date <= summary.endDate && record.date <= today)
    .forEach(record => meaningfulDates.add(record.date));
  let allDays = 0;
  for (let date = summary.startDate, guard = 0; date <= summary.endDate && date <= today && guard < 7; date = addDaysLocal(date, 1), guard++) {
    const record = peekRecordForDate(date);
    if (record && (record.exerciseMinutes > 0 || record.waterCups > 0)) meaningfulDates.add(date);
    if (record && mealDates.has(date) &&
      record.exerciseMinutes >= getEffectiveExerciseGoal(record) &&
      record.waterCups >= getEffectiveWaterGoal(record)) allDays++;
  }
  const meaningfulDays = Math.max(summary.meaningfulDays, meaningfulDates.size);
  const effectiveSummary = { ...summary, meaningfulDays };
  const hasData = meaningfulDays > 0 || summary.mealCount > 0 || summary.exerciseGoalDays > 0 || summary.waterGoalDays > 0 || allDays > 0;
  return {
    hasPlan: true,
    hasData,
    weekNumber,
    periodText: `${formatDateCN(summary.startDate)} — ${formatDateCN(summary.endDate)}`,
    meaningfulDays,
    summaryText: hasData ? summaryText(effectiveSummary, allDays) : emptyWeekReview().summaryText,
    growthItems: growthItems(summary.mealCount, summary.exerciseGoalDays, summary.waterGoalDays, allDays),
  };
}

function buildTrendMessage(points: TrendPoint[]): string {
  if (points.length < 2) return '最近记录正在慢慢形成趋势。';
  const values = points.slice(-7).map(item => item.weight);
  return Math.max(...values) - Math.min(...values) <= 1
    ? '最近 7 条记录整体比较稳定。'
    : '最近的记录已经开始连成一条趋势。';
}

Page({
  data: {
    stats: { totalRecords: 0, initialRecord: null, currentRecord: null, initialWeight: null, currentWeight: null, changeKg: null, changeText: '' } as WeightStats,
    changeClass: 'neutral', weekReview: emptyWeekReview(), trendPoints: [] as TrendPoint[],
    canvasWidth: 280, canvasHeight: 180, yTicks: { max: '', mid: '', min: '' },
    xTicks: { first: '', last: '' }, trendMessage: '最近记录正在慢慢形成趋势。',
    recentRecords: [] as RecentRowVM[], showWeightModal: false, weightModalValue: '',
    weightModalCurrent: null, weightModalIsUpdate: false,
  } as ProgressPageData,

  onLoad() {
    const sys = wx.getSystemInfoSync ? wx.getSystemInfoSync() : ({ windowWidth: 375 } as any);
    const width = sys.windowWidth || 375;
    const canvasWidth = Math.max(200, Math.round(width - width * ((56 + 92 + 56) / 750)));
    this.setData({ canvasWidth, canvasHeight: Math.round(canvasWidth * 0.62) });
  },
  onShow() { this.refreshAll(); },

  refreshAll() {
    const stats = calcWeightStats();
    const trend = getRecentTrendPoints(WEIGHT_TREND_DAYS);
    const recentRecords = getRecentRecords(WEIGHT_RECENT_LIMIT).map(record => ({ id: record.id, dateCN: formatDateCN(record.date), weight: record.weight }));
    let changeClass: ProgressPageData['changeClass'] = 'neutral';
    if (stats.changeKg !== null) changeClass = stats.changeKg < 0 ? 'negative' : stats.changeKg > 0 ? 'positive' : 'zero';
    const yTicks = this.computeYTicks(trend);
    const xTicks = trend.length ? { first: formatDateCN(trend[0].date), last: formatDateCN(trend[trend.length - 1].date) } : { first: '', last: '' };
    this.setData({ stats, changeClass, weekReview: buildWeekReview(), trendPoints: trend, recentRecords, yTicks, xTicks, trendMessage: buildTrendMessage(trend) },
      () => this.drawCanvas(trend, yTicks));
  },

  computeYTicks(trend: TrendPoint[]) {
    if (!trend.length) return { max: '', mid: '', min: '' };
    const values = trend.map(item => item.weight);
    const low = Math.min(...values); const high = Math.max(...values);
    const pad = Math.max(1.5, (high - low) * 0.15);
    const min = Math.floor((low - pad) * 2) / 2; const max = Math.ceil((high + pad) * 2) / 2;
    return { max: max.toFixed(1), mid: ((min + max) / 2).toFixed(1), min: min.toFixed(1) };
  },

  drawCanvas(points: TrendPoint[], ticks: { max: string; mid: string; min: string }) {
    const ctx = wx.createCanvasContext ? wx.createCanvasContext('weightTrend', this) : null;
    if (!ctx) return;
    const data = this.data as ProgressPageData; const width = data.canvasWidth; const height = data.canvasHeight;
    const pad = CHART_PADDING; const top = pad.top; const bottom = height - pad.bottom;
    ctx.clearRect(0, 0, width, height); ctx.setStrokeStyle('#DFE8DA'); ctx.setLineWidth(1);
    for (let i = 0; i < 3; i++) { const y = top + (bottom - top) * i / 2; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke(); }
    if (!points.length) { ctx.draw(); return; }
    const parsedMax = parseFloat(ticks.max); const parsedMin = parseFloat(ticks.min);
    const max = isFinite(parsedMax) && parsedMax > parsedMin ? parsedMax : points[0].weight + 1;
    const min = isFinite(parsedMin) && parsedMax > parsedMin ? parsedMin : points[0].weight - 1;
    const left = pad.left; const right = width - pad.right;
    const x = (i: number) => points.length === 1 ? (left + right) / 2 : left + (right - left) * i / (points.length - 1);
    const y = (w: number) => bottom - (bottom - top) * Math.max(0, Math.min(1, (w - min) / (max - min)));
    if (points.length > 1) {
      ctx.setStrokeStyle('#7FA36A'); ctx.setLineWidth(2.5); ctx.setLineJoin('round'); ctx.setLineCap('round'); ctx.beginPath();
      points.forEach((point, i) => i ? ctx.lineTo(x(i), y(point.weight)) : ctx.moveTo(x(i), y(point.weight))); ctx.stroke();
    }
    points.forEach((point, i) => {
      ctx.beginPath(); ctx.arc(x(i), y(point.weight), 5.2, 0, Math.PI * 2); ctx.setFillStyle('#FFFDF7'); ctx.fill();
      ctx.beginPath(); ctx.arc(x(i), y(point.weight), 3.2, 0, Math.PI * 2); ctx.setFillStyle('#86AB72'); ctx.fill();
    });
    ctx.draw();
  },

  onClickRecordToday() {
    const check = hasRecordOnDate(getTodayString());
    this.setData({ showWeightModal: true, weightModalValue: '', weightModalCurrent: check.record?.weight ?? null, weightModalIsUpdate: !!check.record });
  },
  onWeightModalInput(event: any) { this.setData({ weightModalValue: String(event?.detail?.value ?? '') }); },
  onWeightModalCancel() { this.setData({ showWeightModal: false, weightModalValue: '' }); },
  onWeightModalSave() {
    const data = this.data as ProgressPageData; const raw = data.weightModalValue.trim();
    if (!raw) { wx.showToast({ title: '请输入体重', icon: 'none' }); return; }
    const valid = validateWeightInput(raw);
    if (!valid.ok) { wx.showToast({ title: valid.msg, icon: 'none' }); return; }
    if (data.weightModalIsUpdate && data.weightModalCurrent === valid.weight) { wx.showToast({ title: '与当前相同', icon: 'none' }); return; }
    const save = () => {
      const totalBefore = loadWeightRecords().length; let result: any;
      try { result = saveWeight(valid.weight, getTodayString()); } catch (error) { toastSafe(toUserFriendlyError(error, UI_MSG.STORAGE_SAVE_FAIL)); return; }
      if (!result?.ok) { toastSafe(UI_MSG.STORAGE_SAVE_FAIL); return; }
      try { trackWeightSaved(totalBefore === 0 && result.action === 'created'); } catch { /* ignore */ }
      this.setData({ showWeightModal: false, weightModalValue: '' });
      wx.showToast({ title: result.action === 'created' ? '✓ 记录好了' : '已更新', icon: 'none', duration: 900 }); this.refreshAll();
    };
    if (data.weightModalIsUpdate && data.weightModalCurrent !== null) {
      wx.showModal({ title: '确认更新今天的体重？', content: `当前 ${data.weightModalCurrent} kg → 新值 ${valid.weight} kg`, confirmText: '确认更新', cancelText: '再想想', success: result => { if (result.confirm) save(); } });
    } else save();
  },
  stopPropagation() { /* 阻止弹窗内部点击冒泡 */ },
  onClickRecordRow(event: any) {
    const id = event?.currentTarget?.dataset?.id; if (!id || typeof id !== 'string') return;
    const dateCN = event.currentTarget.dataset.datecn || ''; const weight = event.currentTarget.dataset.weight;
    wx.showModal({
      title: '删除这条记录？', content: `确定删除 ${dateCN}${weight ? `的 ${weight} kg` : ''} 体重记录吗？`, confirmText: '删除', confirmColor: '#8B6E55', cancelText: '再想想',
      success: result => {
        if (!result.confirm) return;
        try { if (!deleteWeightRecord(id)) { toastSafe(UI_MSG.STORAGE_SAVE_FAIL); return; } }
        catch (error) { toastSafe(toUserFriendlyError(error, UI_MSG.STORAGE_SAVE_FAIL)); return; }
        wx.showToast({ title: '已删除', icon: 'none', duration: 800 }); this.refreshAll();
      },
    });
  },
  onClickOpenFeedback() {
    wx.navigateTo({ url: '/pages/feedback/feedback' });
  },
});
