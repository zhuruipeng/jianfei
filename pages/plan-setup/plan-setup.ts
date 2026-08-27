// pages/plan-setup/plan-setup.ts
// V10 首次计划设置页：配置周期/运动/喝水/体重 → 保存 UserPlan → 回首页
//
// 设计：
//  - onLoad 检查是否已有 active plan（避免重复创建）；已有则跳回首页
//  - 选项改动只 setData 局部 selected，不重新渲染整列（pill 数量少，整列 setData 也可接受）
//  - "开始我的计划" → planService.createPlan → 若填了当前体重则 weightService.saveWeight
//    → writeSnapshotIfMissing(今日) → switchTab 回首页
//  - 体重输入做温和校验：空允许；填了需 25~200 kg 区间、1 位小数
import {
  GOAL_DAY_OPTIONS,
  EXERCISE_GOAL_OPTIONS,
  WATER_GOAL_OPTIONS,
  UI_MSG,
  WEIGHT_MIN,
  WEIGHT_MAX,
} from '../../types/index';
import * as planService from '../../services/planService';
import * as weightService from '../../services/weightService';
import { getTodayString } from '../../utils/date';

interface OptionItem {
  value: number;
  label: string;
  sub: string;
  selected: boolean;
}

interface PlanSetupPageData {
  durationOptions: OptionItem[];
  exerciseOptions: OptionItem[];
  waterOptions: OptionItem[];

  startWeightInput: string;
  targetWeightInput: string;

  errorMsg: string;
  submitting: boolean;
}

Page({
  data: {
    durationOptions: [] as OptionItem[],
    exerciseOptions: [] as OptionItem[],
    waterOptions: [] as OptionItem[],

    startWeightInput: '',
    targetWeightInput: '',

    errorMsg: '',
    submitting: false,
  } as PlanSetupPageData,

  // 当前选中（不放进 data 避免冗余渲染，但 wxml 需要靠 options.selected 反映）
  _duration: 28 as number,
  _exercise: 30 as number,
  _water: 8 as number,

  onLoad() {
    // 已有 active plan：直接回首页，不重复创建
    const existing = planService.loadActivePlan();
    if (existing) {
      this._goHome();
      return;
    }
    this._renderOptions();
  },

  _renderOptions() {
    const dur = this._duration;
    const ex = this._exercise;
    const w = this._water;

    const durationOptions: OptionItem[] = GOAL_DAY_OPTIONS.map(d => ({
      value: d,
      label: `${d}天`,
      sub: d === 7 ? '试一试' : d === 28 ? '推荐' : '长期坚持',
      selected: d === dur,
    }));
    const exerciseOptions: OptionItem[] = EXERCISE_GOAL_OPTIONS.map(v => ({
      value: v,
      label: `${v}分钟`,
      sub: '',
      selected: v === ex,
    }));
    const waterOptions: OptionItem[] = WATER_GOAL_OPTIONS.map(v => ({
      value: v,
      label: `${v}杯`,
      sub: '',
      selected: v === w,
    }));

    this.setData({ durationOptions, exerciseOptions, waterOptions });
  },

  onSelectOption(e: any) {
    const field = String(e?.currentTarget?.dataset?.field || '');
    const value = Number(e?.currentTarget?.dataset?.value);
    if (!isFinite(value)) return;

    if (field === 'duration' && (GOAL_DAY_OPTIONS as readonly number[]).includes(value)) {
      this._duration = value;
    } else if (field === 'exercise' && (EXERCISE_GOAL_OPTIONS as readonly number[]).includes(value)) {
      this._exercise = value;
    } else if (field === 'water' && (WATER_GOAL_OPTIONS as readonly number[]).includes(value)) {
      this._water = value;
    } else {
      return;
    }
    this._renderOptions();
  },

  onWeightInput(e: any) {
    const field = String(e?.currentTarget?.dataset?.field || '');
    const value = String(e?.detail?.value ?? '');
    if (field === 'startWeight') {
      this.setData({ startWeightInput: value });
    } else if (field === 'targetWeight') {
      this.setData({ targetWeightInput: value });
    }
  },

  /** 温和校验体重输入：空=未填；非空需数值合法且在区间内，保留 1 位小数 */
  _parseWeight(raw: string): { ok: boolean; value?: number; msg?: string } {
    const s = (raw || '').trim();
    if (s.length === 0) return { ok: true, value: undefined };
    const n = Number(s);
    if (!isFinite(n) || n <= 0) {
      return { ok: false, msg: '体重请填写数字' };
    }
    if (n < WEIGHT_MIN || n > WEIGHT_MAX) {
      return { ok: false, msg: `体重请在 ${WEIGHT_MIN}~${WEIGHT_MAX} kg 之间` };
    }
    return { ok: true, value: Number(n.toFixed(1)) };
  },

  onClickStart() {
    if ((this.data as PlanSetupPageData).submitting) return;
    this.setData({ errorMsg: '' });

    // 体重校验
    const sw = this._parseWeight((this.data as PlanSetupPageData).startWeightInput);
    if (!sw.ok) {
      this.setData({ errorMsg: sw.msg || UI_MSG.INVALID_INPUT });
      return;
    }
    const tw = this._parseWeight((this.data as PlanSetupPageData).targetWeightInput);
    if (!tw.ok) {
      this.setData({ errorMsg: tw.msg || UI_MSG.INVALID_INPUT });
      return;
    }

    this.setData({ submitting: true });

    try {
      // 1. 创建 plan
      const plan = planService.createPlan({
        durationDays: this._duration as 7 | 28 | 90,
        exerciseGoalMinutes: this._exercise,
        waterGoalCups: this._water,
        startWeight: sw.value,
        targetWeight: tw.value,
      });

      // 2. 当前体重 → 生成第一条 WeightRecord（失败不阻断）
      if (typeof sw.value === 'number') {
        try {
          weightService.saveWeight(sw.value, getTodayString());
        } catch (e) {
          console.warn('[plan-setup] saveWeight failed, plan already created', e);
        }
      }

      // 3. 当日 DailyRecord 写 snapshot（plan 创建后立即生效）
      try {
        planService.writeSnapshotIfMissing(getTodayString());
      } catch (e) {
        console.warn('[plan-setup] writeSnapshotIfMissing failed', e);
      }

      // 4. 回首页
      wx.showToast({ title: '✓ 计划开始啦', icon: 'none', duration: 1200 });
      setTimeout(() => this._goHome(), 600);
    } catch (e: any) {
      console.error('[plan-setup] createPlan failed', e);
      this.setData({
        submitting: false,
        errorMsg: UI_MSG.STORAGE_SAVE_FAIL,
      });
    }
  },

  _goHome() {
    try {
      wx.switchTab({ url: '/pages/index/index' });
    } catch {
      try { wx.redirectTo({ url: '/pages/index/index' }); } catch { /* ignore */ }
    }
  },
});
