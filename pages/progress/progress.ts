// pages/progress/progress.ts - 进展页：统计 + 折线图 + 最近记录

import {
  WEIGHT_GENTLE_MESSAGES,
  WEIGHT_TREND_DAYS,
  WEIGHT_RECENT_LIMIT,
  UI_MSG,
  WeightRecord
} from '../../types/index';

import {
  pickRandom,
  getTodayString,
  formatDateCN
} from '../../utils/date';

import {
  loadWeightRecords,
  validateWeightInput,
  hasRecordOnDate,
  saveWeight,
  deleteWeightRecord,
  calcWeightStats,
  getRecentTrendPoints,
  getRecentRecords,
  WeightStats,
  TrendPoint
} from '../../utils/weight';

import { toUserFriendlyError, toastSafe } from '../../services/uiStrings';
import { trackWeightSaved } from '../../services/usageService';
import { isDevEnv } from '../../services/devService';
void isDevEnv;  // 保留，后续可能会用到 develop 区分

interface RecentRowVM {
  id: string;
  date: string;
  dateCN: string;
  weight: number;
}

interface ProgressPageData {
  gentleMessage: string;
  stats: WeightStats;
  changeClass: 'negative' | 'positive' | 'zero' | 'neutral';

  // 趋势
  trendPoints: TrendPoint[];
  canvasWidth: number;  // 逻辑 px（传给 style 和 Canvas 绘制尺寸）
  canvasHeight: number;
  yTicks: { max: string; mid: string; min: string };
  xTicks: { first: string; last: string };

  // 最近记录
  recentRecords: RecentRowVM[];

  // V11：自定义体重输入弹窗
  showWeightModal: boolean;
  weightModalValue: string;
  weightModalCurrent: number | null;
  weightModalIsUpdate: boolean;  // true=今天已有记录要更新
}

// 画布内部可用区域（左右/上下 padding，逻辑 px）
const CHART_PADDING = { top: 12, right: 14, bottom: 10, left: 10 };

Page({
  data: {
    gentleMessage: pickRandom(WEIGHT_GENTLE_MESSAGES),
    stats: {
      totalRecords: 0,
      initialRecord: null,
      currentRecord: null,
      initialWeight: null,
      currentWeight: null,
      changeKg: null,
      changeText: ''
    } as WeightStats,
    changeClass: 'neutral' as 'negative' | 'positive' | 'zero' | 'neutral',

    trendPoints: [] as TrendPoint[],
    canvasWidth: 280,
    canvasHeight: 180,
    yTicks: { max: '', mid: '', min: '' },
    xTicks: { first: '', last: '' },

    recentRecords: [] as RecentRowVM[],

    showWeightModal: false,
    weightModalValue: '',
    weightModalCurrent: null,
    weightModalIsUpdate: false,
  } as ProgressPageData,

  onLoad() {
    // 初始化 Canvas 尺寸：根据设备宽度（逻辑 px）计算
    const sys = wx.getSystemInfoSync ? wx.getSystemInfoSync() : ({ windowWidth: 375 } as any);
    // WXML 布局：page 左右 padding 各 28rpx → 约 56rpx；y-axis 占 100rpx；再留一些余量
    const pagePadPx = (sys.windowWidth || 375) * (56 / 750);
    const yAxisPx = (sys.windowWidth || 375) * (100 / 750);
    const cardPadPx = (sys.windowWidth || 375) * (60 / 750); // card 30 + 30
    const canvasWidth = Math.max(200, Math.round((sys.windowWidth || 375) - pagePadPx - yAxisPx - cardPadPx));
    const canvasHeight = Math.round(canvasWidth * 0.62);
    this.setData({
      canvasWidth,
      canvasHeight,
      gentleMessage: pickRandom(WEIGHT_GENTLE_MESSAGES)
    });
  },

  onShow() {
    this.refreshAll();
  },

  // ================================================================
  // 刷新：派生所有显示字段 + 重绘 Canvas
  // ================================================================
  refreshAll() {
    const stats = calcWeightStats();
    const trend = getRecentTrendPoints(WEIGHT_TREND_DAYS);
    const recent = getRecentRecords(WEIGHT_RECENT_LIMIT);
    const recentRows: RecentRowVM[] = recent.map(r => ({
      id: r.id,
      date: r.date,
      dateCN: formatDateCN(r.date),
      weight: r.weight
    }));

    let changeClass: 'negative' | 'positive' | 'zero' | 'neutral' = 'neutral';
    if (stats.changeKg !== null) {
      if (stats.changeKg < 0) changeClass = 'negative';
      else if (stats.changeKg > 0) changeClass = 'positive';
      else changeClass = 'zero';
    }

    // Y 轴刻度：min/max 从数据派生，给一定 padding
    const yTicks = this.computeYTicks(trend, stats);
    const xTicks = trend.length > 0
      ? { first: formatDateCN(trend[0].date), last: formatDateCN(trend[trend.length - 1].date) }
      : { first: '', last: '' };

    this.setData({
      stats,
      changeClass,
      trendPoints: trend,
      recentRecords: recentRows,
      yTicks,
      xTicks,
      gentleMessage: pickRandom(WEIGHT_GENTLE_MESSAGES)
    }, () => {
      this.drawCanvas(trend, yTicks);
    });
  },

  computeYTicks(trend: TrendPoint[], stats: WeightStats): { max: string; mid: string; min: string } {
    if (trend.length === 0) {
      return { max: '', mid: '', min: '' };
    }
    let minW = Infinity;
    let maxW = -Infinity;
    for (const p of trend) {
      if (p.weight < minW) minW = p.weight;
      if (p.weight > maxW) maxW = p.weight;
    }
    if (!isFinite(minW) || !isFinite(maxW)) {
      return { max: '', mid: '', min: '' };
    }
    // 固定至少 +/-1.5 kg 的余量，避免一根平线
    const pad = Math.max(1.5, (maxW - minW) * 0.15);
    const minV = Math.floor((minW - pad) * 2) / 2; // 向下取 0.5
    const maxV = Math.ceil((maxW + pad) * 2) / 2;  // 向上取 0.5
    const midV = Number(((minV + maxV) / 2).toFixed(1));
    return {
      max: maxV.toFixed(1),
      mid: midV.toFixed(1),
      min: minV.toFixed(1)
    };
  },

  drawCanvas(points: TrendPoint[], yTicks: { max: string; mid: string; min: string }) {
    const ctx = wx.createCanvasContext ? wx.createCanvasContext('weightTrend', this) : null;
    if (!ctx) return;
    const d = this.data || {} as ProgressPageData;
    const W = typeof d.canvasWidth === 'number' ? d.canvasWidth : 280;
    const H = typeof d.canvasHeight === 'number' ? d.canvasHeight : 180;
    const pad = CHART_PADDING;

    ctx.clearRect(0, 0, W, H);

    // 背景网格：两条横线（对应 max/min 之间 2 条分割 → 上、中、下）
    ctx.setStrokeStyle('#EEF1F6');
    ctx.setLineWidth(1);
    const yMax = parseFloat(yTicks.max);
    const yMin = parseFloat(yTicks.min);
    if (!isFinite(yMax) || !isFinite(yMin) || yMax <= yMin) {
      // 画一条底线兜底
      ctx.beginPath();
      ctx.moveTo(pad.left, H - pad.bottom);
      ctx.lineTo(W - pad.right, H - pad.bottom);
      ctx.stroke();
    } else {
      const usableTop = pad.top;
      const usableBottom = H - pad.bottom;
      const lines = 3;
      for (let i = 0; i < lines; i++) {
        const y = usableTop + (usableBottom - usableTop) * (i / (lines - 1));
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(W - pad.right, y);
        ctx.stroke();
      }
    }

    // 画折线 + 圆点（points.length === 1 时只画圆点）
    if (points.length === 0) return;

    const usableLeft = pad.left;
    const usableRight = W - pad.right;
    const usableTop = pad.top;
    const usableBottom = H - pad.bottom;

    const rangeValid = isFinite(yMax) && isFinite(yMin) && yMax > yMin;
    const max = rangeValid ? yMax : (points[0].weight + 1);
    const min = rangeValid ? yMin : (points[0].weight - 1);

    function weightToY(w: number): number {
      const t = (w - min) / (max - min);
      const tt = Math.max(0, Math.min(1, t));
      // kg 越大越靠上：y 随 weight 变大而减小
      return usableBottom - (usableBottom - usableTop) * tt;
    }
    function idxToX(i: number): number {
      if (points.length <= 1) return (usableLeft + usableRight) / 2;
      return usableLeft + (usableRight - usableLeft) * (i / (points.length - 1));
    }

    // 折线
    if (points.length >= 2) {
      ctx.setStrokeStyle('#FF6B6B');
      ctx.setLineWidth(2.5);
      ctx.setLineJoin('round');
      ctx.setLineCap('round');
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const x = idxToX(i);
        const y = weightToY(points[i].weight);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // 圆点
    const dotR = 3.2;
    for (let i = 0; i < points.length; i++) {
      const x = idxToX(i);
      const y = weightToY(points[i].weight);
      // 外圈白边
      ctx.beginPath();
      ctx.arc(x, y, dotR + 2, 0, Math.PI * 2);
      ctx.setFillStyle('#FFFFFF');
      ctx.fill();
      // 内部珊瑚点
      ctx.beginPath();
      ctx.arc(x, y, dotR, 0, Math.PI * 2);
      ctx.setFillStyle('#FF6B6B');
      ctx.fill();
    }
    ctx.draw();
  },

  // ================================================================
  // 记录今天体重（V11：自定义弹窗，直接输入不需要删除）
  // ================================================================
  onClickRecordToday() {
    const today = getTodayString();
    const check = hasRecordOnDate(today);

    if (check.exists && check.record) {
      this.setData({
        showWeightModal: true,
        weightModalValue: '',
        weightModalCurrent: check.record.weight,
        weightModalIsUpdate: true,
      });
    } else {
      this.setData({
        showWeightModal: true,
        weightModalValue: '',
        weightModalCurrent: null,
        weightModalIsUpdate: false,
      });
    }
  },

  onWeightModalInput(e: any) {
    const v = String(e?.detail?.value ?? '');
    this.setData({ weightModalValue: v });
  },

  onWeightModalCancel() {
    this.setData({ showWeightModal: false, weightModalValue: '' });
  },

  onWeightModalSave() {
    const that = this;
    const raw = (this.data as ProgressPageData).weightModalValue.trim();
    const isUpdate = (this.data as ProgressPageData).weightModalIsUpdate;
    const currentW = (this.data as ProgressPageData).weightModalCurrent;
    const today = getTodayString();

    if (!raw) {
      wx.showToast({ title: '请输入体重', icon: 'none' });
      return;
    }
    const v = validateWeightInput(raw);
    if (!v.ok) {
      wx.showToast({ title: v.msg, icon: 'none' });
      return;
    }
    if (isUpdate && currentW !== null && v.weight === currentW) {
      wx.showToast({ title: '与当前相同', icon: 'none' });
      return;
    }

    const doSave = () => {
      let res: any;
      const totalRecordsBefore = loadWeightRecords().length;
      try {
        res = saveWeight(v.weight, today);
      } catch (e) {
        toastSafe(toUserFriendlyError(e, UI_MSG.STORAGE_SAVE_FAIL));
        return;
      }
      if (!res || !res.ok) {
        toastSafe(UI_MSG.STORAGE_SAVE_FAIL);
        return;
      }
      try {
        const isFirstWeightRecord = totalRecordsBefore === 0 && res.action === 'created';
        trackWeightSaved(isFirstWeightRecord);
      } catch { /* ignore */ }

      that.setData({ showWeightModal: false, weightModalValue: '' });
      if (res.action === 'created') {
        wx.showToast({ title: '✓ 记录好了', icon: 'none', duration: 900 });
      } else {
        wx.showToast({ title: '已更新', icon: 'none', duration: 800 });
      }
      that.refreshAll();
    };

    if (isUpdate && currentW !== null) {
      wx.showModal({
        title: '确认更新今天的体重？',
        content: `当前 ${currentW} kg → 新值 ${v.weight} kg`,
        confirmText: '确认更新',
        cancelText: '再想想',
        success(rr: { confirm: boolean }) {
          if (!rr.confirm) return;
          doSave();
        },
      });
    } else {
      doSave();
    }
  },

  stopPropagation() { /* 阻止弹窗内部点击冒泡 */ },

  // ================================================================
  // 点击某条记录 → 删除确认
  // ================================================================
  onClickRecordRow(e: any) {
    const id = e && e.currentTarget && e.currentTarget.dataset.id;
    const dateCN = e && e.currentTarget && e.currentTarget.dataset.datecn;
    const weight = e && e.currentTarget && e.currentTarget.dataset.weight;
    if (!id || typeof id !== 'string') return;
    const page = this;
    wx.showModal({
      title: '删除这条记录？',
      content: `确定删除 ${dateCN || ''} ${weight ? '的 ' + weight + ' kg' : ''} 体重记录吗？`,
      confirmText: '删除',
      confirmColor: '#D04343',
      cancelText: '再想想',
      success(rr: { confirm: boolean }) {
        if (!rr.confirm) return;
        let ok = false;
        try {
          ok = !!deleteWeightRecord(id);
        } catch (e) {
          toastSafe(toUserFriendlyError(e, UI_MSG.STORAGE_SAVE_FAIL));
          return;
        }
        if (!ok) {
          toastSafe(UI_MSG.STORAGE_SAVE_FAIL);
          return;
        }
        wx.showToast({ title: '已删除', icon: 'none', duration: 800 });
        // 删除后重新计算全部统计（初始/当前/变化/趋势）
        page.refreshAll();
      }
    });
  },

  // ================================================================
  // 反馈入口 → 打开简单反馈页
  // ================================================================
  onClickOpenFeedback() {
    try {
      wx.navigateTo({ url: '/pages/feedback/feedback' });
    } catch (e) { /* ignore */ }
  }
});
