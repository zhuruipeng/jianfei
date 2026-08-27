// pages/journey/journey.ts
// V12.1 28 天旅程地图 + 旅程收藏卡（Day1/7/14/21/28）
//
// 规则：
//  - 旅程站点完全由 planDay 解锁（不要求任务完成率），漏一天不会卡死。
//  - 没有 UserPlan：以 app_first_launch_date 为准，planDay = date diff + 1（兜底）。
//  - 共 5 个站点：Day 1 / 7 / 14 / 21 / 28；对应 5 张旅程卡。
//  - 卡未解锁：显示简单轮廓 + ? + "继续旅程解锁"，不提前泄露完整标题/大图/文案。
//  - 卡已解锁：点击可查看详情（标题 / Day X / 大图 / 描述 / 额外短句 / unlockedAt）
import { JOURNEY_STOPS, JourneyStop, JOURNEY_CARDS, JourneyCard } from '../../types/index';
import * as planService from '../../services/planService';
import * as companionService from '../../services/companionService';
import { getJourneyCardRenderAsset, JourneyCardRenderAsset } from '../../utils/companionAssets';
import { calculatePlanDay, formatDateCN, getTodayString } from '../../utils/date';

interface StopVM {
  planDay: number;
  name: string;
  hint: string;
  reached: boolean;
  isCurrent: boolean;   // 是否为"当前所在"（最大的 planDay 之前站点）
  dateText: string;     // 如果存在 plan.startDate -> 显示对应的日期（YYYY-MM-DD），否则留空
}

interface JourneyCardVM {
  id: string;
  dayRequired: number;
  unlocked: boolean;
  emoji: string;             // 未解锁显示 🟟，已解锁显示卡片 emoji
  // 以下字段仅已解锁时非空（未解锁传占位，未泄露真实内容）
  titleMasked: string;       // 未解锁 = "Day XX · 未解锁"
  shortTitle: string;        // 未解锁 = ""
  description: string;       // 未解锁 = ""
  unlockedAtText: string;    // 未解锁 = ""
  asset: JourneyCardRenderAsset;
}

interface JourneyCardDetailVM {
  visible: boolean;
  id: string;
  dayRequired: number;
  title: string;
  shortTitle: string;
  description: string;
  extraSentence: string;
  unlockedAtText: string;
  asset: JourneyCardRenderAsset;
}

interface JourneyPageData {
  hasPlan: boolean;
  planDay: number;
  planTitle: string;            // 28天轻旅 / 等等
  durationDays: number;         // 7|28|90
  stops: StopVM[];
  startDateText: string;        // 如果有 plan，显示"X月X日开始"
  tipText: string;
  cards: JourneyCardVM[];
  cardsTitleSuffix: string;     // "已解锁 2 / 5"
  cardDetail: JourneyCardDetailVM;
}

function _planService_loadActivePlanSafe() {
  try { return planService.loadActivePlan(); } catch { return null; }
}

/** 本地日期 + days 偏移（按本地时区中午 12 点避免时区漂移） */
function _addDays(dateStr: string, days: number): string {
  const p = dateStr.split('-');
  if (p.length !== 3) return '';
  const d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10), 12, 0, 0, 0);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _fmtUnlockedAt(unlockedAt: string | undefined): string {
  if (!unlockedAt) return '';
  return formatDateCN(String(unlockedAt));
}

Page({
  data: {
    hasPlan: false,
    planDay: 1,
    planTitle: '',
    durationDays: 28,
    stops: [],
    startDateText: '',
    tipText: '',
    cards: [],
    cardsTitleSuffix: '',
    cardDetail: {
      visible: false,
      id: '',
      dayRequired: 0,
      title: '',
      shortTitle: '',
      description: '',
      extraSentence: '',
      unlockedAtText: '',
      asset: { useImage: false, imageKey: '', src: '', emoji: '', cssClass: '' },
    },
  } as JourneyPageData,

  onLoad() {
    this._refresh();
    try {
      const plan = _planService_loadActivePlanSafe();
      const planDay = Math.max(1,
        plan ? calculatePlanDay(plan.startDate, getTodayString()) : 1);
      companionService.trackJourneyViewed(planDay, !!plan);
      // 进入旅程页也确保旅程卡按当前 planDay 解锁一次（用户没点过首页升级弹层也能拿到）
      companionService.ensureJourneyCardsUnlocked(planDay);
    } catch { /* ignore */ }
  },

  _refresh() {
    const plan = _planService_loadActivePlanSafe();
    const today = getTodayString();

    let hasPlan = false;
    let planDay = 1;
    let planTitle = '轻旅';
    let durationDays = 28;
    let startDateText = '';

    if (plan) {
      hasPlan = true;
      durationDays = plan.durationDays;
      planTitle = `${plan.durationDays}天轻旅`;
      planDay = Math.max(1, calculatePlanDay(plan.startDate, today));
      startDateText = `${formatDateCN(plan.startDate)} 开始`;
    } else {
      // 无 active plan：兜底取 first_launch_date
      let first = '';
      try {
        first = String(wx.getStorageSync('app_first_launch_date') || '');
      } catch { first = ''; }
      if (!first) first = today;
      planDay = Math.max(1, calculatePlanDay(first, today));
      startDateText = `${formatDateCN(first)} 开始`;
      planTitle = '轻旅';
      durationDays = 28;  // 兜底展示 28 天里程碑
    }

    // 按 28 天周期展示（90天也按 Day1/7/14/21/28 展示第一阶段，到达 Day>28 后最后站点自动 reached=true）
    const stops: StopVM[] = JOURNEY_STOPS.map((s: JourneyStop) => {
      const reached = planDay >= s.planDay;
      const d = plan ? _addDays(plan.startDate, s.planDay - 1) : '';
      return {
        planDay: s.planDay,
        name: s.name,
        hint: s.hint,
        reached,
        isCurrent: false, // 后面再计算
        dateText: d ? formatDateCN(d) : '',
      };
    });

    // 标记"当前站"：第一个未到达站之前的那个；或者全到达则最后一个
    let currentIdx = -1;
    for (let i = 0; i < stops.length; i++) {
      if (stops[i].reached) currentIdx = i;
    }
    if (currentIdx >= 0) stops[currentIdx].isCurrent = true;

    let tipText = '';
    if (!hasPlan) {
      tipText = '开启28天计划，就能看到更清晰的旅程进度啦。';
    } else if (planDay <= 1) {
      tipText = '轻旅刚开始。每天完成一点小事，小轻和你一起出发。';
    } else if (planDay >= 28) {
      tipText = '你已经走到山顶啦 🏕️，这一路的记录都是你的。';
    } else {
      const nextIdx = Math.min(stops.length - 1, currentIdx + 1);
      const nextStop = stops[nextIdx];
      const remain = Math.max(0, nextStop.planDay - planDay);
      tipText = `下一站：${nextStop ? nextStop.name : '山顶'}，还有 ${remain} 天。`;
    }

    // ========== V12.1：旅程收藏卡网格 ==========
    let unlockedStateById: Record<string, { unlocked: boolean; unlockedAt?: string; planDayWhenUnlocked?: number }> = {};
    try {
      unlockedStateById = companionService.readJourneyCardsUnlockedStateById();
    } catch { unlockedStateById = {}; }

    const cards: JourneyCardVM[] = JOURNEY_CARDS.map((jc: JourneyCard) => {
      const st = unlockedStateById[jc.id] || null;
      const unlocked = !!(st && st.unlocked);
      const asset = unlocked
        ? getJourneyCardRenderAsset(jc.imageKey, jc.emoji, jc.shortTitle)
        : getJourneyCardRenderAsset('LOCKED', '🟟', '未解锁');
      const out: JourneyCardVM = {
        id: jc.id,
        dayRequired: jc.dayRequired,
        unlocked,
        emoji: unlocked ? jc.emoji : '🟟',
        titleMasked: unlocked ? `Day ${jc.dayRequired} · ${jc.shortTitle}` : `Day ${jc.dayRequired} · 继续旅程解锁`,
        shortTitle: unlocked ? jc.shortTitle : '',
        description: unlocked ? jc.description : '',
        unlockedAtText: unlocked ? _fmtUnlockedAt(st && st.unlockedAt) : '',
        asset,
      };
      return out;
    });
    const unlockedCount = cards.filter((c) => c.unlocked).length;
    const cardsTitleSuffix = `已解锁 ${unlockedCount} / ${cards.length}`;

    this.setData({
      hasPlan,
      planDay,
      planTitle,
      durationDays,
      stops,
      startDateText,
      tipText,
      cards,
      cardsTitleSuffix,
    } as JourneyPageData);
  },

  // 点击旅程卡：已解锁 → 打开详情；未解锁 → 轻提示不泄露
  onClickJourneyCard(e: any) {
    const id: string = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
    if (!id) return;
    const card: JourneyCard | undefined = JOURNEY_CARDS.find((c: JourneyCard) => c.id === id);
    const list: JourneyCardVM[] = this.data.cards || [];
    const vm = list.find((c) => c.id === id);
    if (!card || !vm) return;
    if (!vm.unlocked) {
      // 未解锁：小 toast，不显示真实内容
      try {
        wx.showToast({
          title: '继续旅程解锁这张卡',
          icon: 'none',
          duration: 1500,
        });
      } catch { /* ignore */ }
      return;
    }
    // 已解锁：展示详情，埋点
    try { companionService.trackJourneyCardViewed(id); } catch { /* ignore */ }
    this.setData({
      cardDetail: {
        visible: true,
        id: card.id,
        dayRequired: card.dayRequired,
        title: card.title,
        shortTitle: card.shortTitle,
        description: card.description,
        extraSentence: card.extraLine || '',
        unlockedAtText: vm.unlockedAtText,
        asset: getJourneyCardRenderAsset(card.imageKey, card.emoji, card.shortTitle),
      } as JourneyCardDetailVM,
    });
  },

  onCloseCardDetail() {
    this.setData({
      cardDetail: Object.assign({}, this.data.cardDetail, { visible: false }) as JourneyCardDetailVM,
    });
  },

  stopPropagation() {
    // 阻止点击详情内容时关闭（catchtap）
  },

  onGoBack() {
    try { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) }); }
    catch { try { wx.switchTab({ url: '/pages/index/index' }); } catch { /* ignore */ } }
  },
});
