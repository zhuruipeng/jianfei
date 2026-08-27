// pages/weekly-summary/weekly-summary.ts
// V10 周总结页：展示某一周的 WeeklySummary（快照）
//  - 入口参数：planId, weekNumber
//  - 数据：weeklySummaryService.loadWeeklySummaryForView
//  - 一句话总结：规则生成（不调 AI）
//  - 底部"继续下一周" → 标记 viewed → 回首页
import * as weeklySummaryService from '../../services/weeklySummaryService';
import { markWeeklySummaryViewed } from '../../utils/weeklySummary';
import { formatDateCN } from '../../utils/date';
import type { WeeklySummary } from '../../types/index';
import { UI_MSG } from '../../types/index';

interface WeeklySummaryPageData {
  loaded: boolean;
  summary: WeeklySummary | null;

  weekTitle: string;
  dateRangeText: string;
  meaningfulText: string;
  oneLineSummary: string;

  // 体重展示
  weightHasTwo: boolean;
  weightHasOne: boolean;
  weightStartText: string;
  weightEndText: string;
  weightChangeText: string;
  weightChangeNegative: boolean;

  // 奖励
  rewardText: string;

  errorMsg: string;
}

const WEEK_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

Page({
  data: {
    loaded: false,
    summary: null,

    weekTitle: '',
    dateRangeText: '',
    meaningfulText: '',
    oneLineSummary: '',

    weightHasTwo: false,
    weightHasOne: false,
    weightStartText: '',
    weightEndText: '',
    weightChangeText: '',
    weightChangeNegative: false,

    rewardText: '',

    errorMsg: '',
  } as WeeklySummaryPageData,

  onLoad(query: Record<string, string>) {
    const planId = String(query?.planId || '');
    const weekNumber = parseInt(String(query?.weekNumber || '0'), 10);
    if (!planId || !isFinite(weekNumber) || weekNumber < 1) {
      this.setData({ loaded: true, errorMsg: '参数不合法' });
      return;
    }
    this._load(planId, weekNumber);
  },

  _load(planId: string, weekNumber: number) {
    const res = weeklySummaryService.loadWeeklySummaryForView(planId, weekNumber);
    if (!res.ok || !res.summary) {
      this.setData({
        loaded: true,
        errorMsg: res.msg || UI_MSG.RECORD_NOT_FOUND,
      });
      return;
    }
    const s = res.summary;
    const weekTitle = `第${WEEK_CN[weekNumber - 1] || weekNumber}周完成 🎉`;
    const dateRangeText = `${formatDateCN(s.startDate)} - ${formatDateCN(s.endDate)}`;
    const meaningfulText = `这一周你认真记录了 ${s.meaningfulDays} / 7 天`;
    const oneLineSummary = this._buildOneLineSummary(s);

    // 体重展示
    const hasStart = typeof s.weightStart === 'number' && isFinite(s.weightStart);
    const hasEnd = typeof s.weightEnd === 'number' && isFinite(s.weightEnd);
    const hasChange = typeof s.weightChange === 'number' && isFinite(s.weightChange);
    let weightHasTwo = false;
    let weightHasOne = false;
    let weightStartText = '';
    let weightEndText = '';
    let weightChangeText = '';
    let weightChangeNegative = false;
    if (hasStart && hasEnd) {
      weightHasTwo = true;
      weightStartText = `${s.weightStart!.toFixed(1)} kg`;
      weightEndText = `${s.weightEnd!.toFixed(1)} kg`;
      if (hasChange) {
        const sign = s.weightChange! > 0 ? '+' : (s.weightChange! < 0 ? '' : '');
        weightChangeText = `变化 ${sign}${s.weightChange!.toFixed(1)} kg`;
        weightChangeNegative = s.weightChange! < 0;
      } else {
        // 同一条记录被首末复用，change 为 0
        weightChangeText = '变化 0 kg';
      }
    } else if (hasStart || hasEnd) {
      weightHasOne = true;
    }

    // 奖励提示
    let rewardText = '';
    if (s.rewardsUnlocked > 0) {
      rewardText = `🎁 这一周你解锁了 ${s.rewardsUnlocked} 个奖励`;
    }
    if (s.rewardsRedeemed > 0) {
      rewardText = rewardText
        ? `${rewardText}\n你已经领取了自己的奖励。`
        : `你已经领取了自己的奖励。`;
    }

    this.setData({
      loaded: true,
      summary: s,
      weekTitle,
      dateRangeText,
      meaningfulText,
      oneLineSummary,
      weightHasTwo,
      weightHasOne,
      weightStartText,
      weightEndText,
      weightChangeText,
      weightChangeNegative,
      rewardText,
      errorMsg: '',
    });
  },

  /**
   * 规则生成一句周总结（不调 AI，按需求第二十三条）
   *  - meaningfulDays >= 5 → 你大部分时间在认真记录
   *  - exerciseGoalDays 最多 → 运动是这一周坚持得最好的一项
   *  - mealCount 较多 → 饮食记录最稳定
   *  - 否则 → 已经开始了，下一周可以先把记录一餐这件事坚持下来
   */
  _buildOneLineSummary(s: WeeklySummary): string {
    if (s.meaningfulDays >= 5) {
      return '这一周你大部分时间都在认真记录，继续保持现在的节奏。';
    }
    // 找出"达标天数最多"的项
    const maxGoal = Math.max(s.exerciseGoalDays, s.waterGoalDays);
    if (s.exerciseGoalDays >= 3 && s.exerciseGoalDays === maxGoal) {
      return '运动是这一周坚持得最好的一项。';
    }
    if (s.mealCount >= 12) {
      return '这一周饮食记录最稳定，这是一个很好的开始。';
    }
    return '这一周已经开始了，下一周可以先把记录一餐这件事坚持下来。';
  },

  onContinueNextWeek() {
    const s = (this.data as WeeklySummaryPageData).summary;
    if (s) {
      try { markWeeklySummaryViewed(s.planId, s.weekNumber); } catch { /* ignore */ }
    }
    this._goHome();
  },

  onGoHome() {
    this._goHome();
  },

  _goHome() {
    try {
      wx.switchTab({ url: '/pages/index/index' });
    } catch {
      try { wx.redirectTo({ url: '/pages/index/index' }); } catch { /* ignore */ }
    }
  },
});
