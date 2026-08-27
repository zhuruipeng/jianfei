// utils/weight.ts - 体重记录（不与积分挂钩，仅观察趋势）

import {
  type WeightRecord,
  STORAGE_KEY_WEIGHT_RECORDS,
  WEIGHT_MIN,
  WEIGHT_MAX,
  WEIGHT_DECIMALS,
  WEIGHT_TREND_DAYS,
  WEIGHT_RECENT_LIMIT
} from '../types/index';

import { formatDateTimeNow, genLocalId, getTodayString } from './date';

// =========================================================================
// 一、基础读写
// =========================================================================

function normalizeWeight(raw: Partial<WeightRecord>, idx: number): WeightRecord {
  const date = (raw.date && typeof raw.date === 'string') ? raw.date : getTodayString();
  let weight = typeof raw.weight === 'number' ? raw.weight : NaN;
  if (!isFinite(weight) || isNaN(weight) || weight <= WEIGHT_MIN || weight >= WEIGHT_MAX) {
    weight = 0; // 无效值兜底（校验会拒绝写，但读取兼容时要安全）
  } else {
    weight = Number(weight.toFixed(WEIGHT_DECIMALS));
  }
  return {
    id: (raw.id && typeof raw.id === 'string' && raw.id.length > 0) ? raw.id : genLocalId(),
    date,
    weight,
    createdAt: (raw.createdAt && typeof raw.createdAt === 'string') ? raw.createdAt : formatDateTimeNow(),
    ...(raw.updatedAt && typeof raw.updatedAt === 'string' ? { updatedAt: raw.updatedAt } : {})
  };
}

export function loadWeightRecords(): WeightRecord[] {
  try {
    const v = wx.getStorageSync(STORAGE_KEY_WEIGHT_RECORDS);
    if (Array.isArray(v)) {
      const arr = (v as Partial<WeightRecord>[])
        .map((r, i) => normalizeWeight(r, i))
        .filter(r => r.weight > 0); // 过滤损坏的记录
      return arr;
    }
  } catch (e) {
    console.error('[Weight] loadWeightRecords failed', e);
  }
  return [];
}

export function saveWeightRecords(list: WeightRecord[]): boolean {
  try {
    wx.setStorageSync(STORAGE_KEY_WEIGHT_RECORDS, list);
    return true;
  } catch (e) {
    console.error('[Weight] saveWeightRecords failed', e);
    return false;
  }
}

// =========================================================================
// 二、排序/查询辅助
// =========================================================================

export function sortWeightRecordsByDateAsc(records: WeightRecord[]): WeightRecord[] {
  return [...records].sort((a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });
}

export function sortWeightRecordsByDateDesc(records: WeightRecord[]): WeightRecord[] {
  return [...records].sort((a, b) => {
    if (a.date > b.date) return -1;
    if (a.date < b.date) return 1;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
}

export function findWeightByDate(records: WeightRecord[], date: string): WeightRecord | undefined {
  return records.find(r => r.date === date);
}

// =========================================================================
// 三、输入校验（严格）
// =========================================================================

export interface WeightValidateResult {
  ok: boolean;
  msg: string;
  weight: number; // kg，已按 1 位小数四舍五入；ok=false 时为 0
}

export function validateWeightInput(rawStr: string): WeightValidateResult {
  const s = (rawStr || '').trim();
  if (s.length === 0) {
    return { ok: false, msg: '请输入正确的体重', weight: 0 };
  }
  // 只允许数字 + 一个小数点
  if (!/^\d+(\.\d+)?$/.test(s)) {
    return { ok: false, msg: '请输入正确的体重', weight: 0 };
  }
  // 小数位数：最多 WEIGHT_DECIMALS（1）位
  const parts = s.split('.');
  if (parts.length === 2 && parts[1].length > WEIGHT_DECIMALS) {
    return { ok: false, msg: `最多保留 ${WEIGHT_DECIMALS} 位小数`, weight: 0 };
  }
  const n = parseFloat(s);
  if (!isFinite(n) || isNaN(n)) {
    return { ok: false, msg: '请输入正确的体重', weight: 0 };
  }
  if (n <= WEIGHT_MIN) {
    return { ok: false, msg: `体重必须大于 ${WEIGHT_MIN} kg`, weight: 0 };
  }
  if (n >= WEIGHT_MAX) {
    return { ok: false, msg: `体重必须小于 ${WEIGHT_MAX} kg`, weight: 0 };
  }
  const rounded = Number(n.toFixed(WEIGHT_DECIMALS));
  return { ok: true, msg: '', weight: rounded };
}

// =========================================================================
// 四、保存体重（核心）：同一天只保留一条，重复记录提示覆盖
// 返回：{ created: true } 或 { updated: true, previousWeight: n } 或 { error: msg }
// =========================================================================

export interface SaveWeightResult {
  ok: boolean;
  action?: 'created' | 'updated';
  previousWeight?: number;
  record?: WeightRecord;
  error?: string;
}

export function saveWeight(weightKg: number, dateStr: string): SaveWeightResult {
  if (!isFinite(weightKg) || isNaN(weightKg) || weightKg <= WEIGHT_MIN || weightKg >= WEIGHT_MAX) {
    return { ok: false, error: '体重值非法' };
  }
  const weight = Number(weightKg.toFixed(WEIGHT_DECIMALS));
  const date = dateStr && dateStr.length > 0 ? dateStr : getTodayString();
  const all = loadWeightRecords();
  const existingIdx = all.findIndex(r => r.date === date);
  if (existingIdx === -1) {
    // 新建
    const rec: WeightRecord = {
      id: genLocalId(),
      date,
      weight,
      createdAt: formatDateTimeNow()
    };
    all.push(rec);
    saveWeightRecords(all);
    return { ok: true, action: 'created', record: rec };
  } else {
    // 覆盖更新（调用方负责弹窗确认；这里的函数被确认后调用）
    const prev = all[existingIdx];
    const previousWeight = prev.weight;
    const updated: WeightRecord = {
      ...prev,
      weight,
      updatedAt: formatDateTimeNow()
    };
    all[existingIdx] = updated;
    saveWeightRecords(all);
    return { ok: true, action: 'updated', previousWeight, record: updated };
  }
}

/** 判断指定日期是否已有记录（用于调用方决定弹"更新"确认） */
export function hasRecordOnDate(dateStr: string): { exists: boolean; record?: WeightRecord } {
  const all = loadWeightRecords();
  const r = all.find(x => x.date === dateStr);
  return { exists: !!r, record: r };
}

// =========================================================================
// 五、删除记录
// =========================================================================

export function deleteWeightRecord(id: string): boolean {
  const all = loadWeightRecords();
  const before = all.length;
  const next = all.filter(r => r.id !== id);
  if (next.length === before) return false;
  saveWeightRecords(next);
  return true;
}

// =========================================================================
// 六、派生统计（单一入口：保证显示一致）
// =========================================================================

export interface WeightStats {
  totalRecords: number;
  initialRecord: WeightRecord | null;  // 日期最早一条
  currentRecord: WeightRecord | null;  // 日期最新一条
  initialWeight: number | null;
  currentWeight: number | null;
  changeKg: number | null;             // current - initial
  changeText: string;                   // "-3.6 kg" / "+1.2 kg" / ""
}

export function calcWeightStats(): WeightStats {
  const all = loadWeightRecords();
  if (all.length === 0) {
    return {
      totalRecords: 0,
      initialRecord: null,
      currentRecord: null,
      initialWeight: null,
      currentWeight: null,
      changeKg: null,
      changeText: ''
    };
  }
  const asc = sortWeightRecordsByDateAsc(all);
  const initial = asc[0];
  const current = asc[asc.length - 1];
  const delta = current.weight - initial.weight;
  const sign = delta > 0 ? '+' : (delta < 0 ? '-' : '');
  const text = delta === 0
    ? '0 kg'
    : `${sign}${Math.abs(delta).toFixed(WEIGHT_DECIMALS)} kg`;
  return {
    totalRecords: all.length,
    initialRecord: initial,
    currentRecord: current,
    initialWeight: initial.weight,
    currentWeight: current.weight,
    changeKg: delta,
    changeText: text
  };
}

/**
 * 首页 "比上次"：
 * 传入 todayStr（通常 getTodayString()），找到今天记录之前的"最近一条"
 * 返回：
 *  - beforeRecord: 今天之前最近的记录；null 表示没有
 *  - todayRecord: 今天的记录；null 表示今天没有
 *  - delta: todayWeight - beforeWeight；都有时才有值
 *  - diffText: 如 "-0.3 kg"；若只有一条记录 → "这是你的第一次记录"；今天没记录 → ""
 */
export interface WeightDiffResult {
  todayRecord: WeightRecord | null;
  beforeRecord: WeightRecord | null;
  deltaKg: number | null;
  diffText: string;
  firstRecordEver: boolean;
}

export function calcTodayDiff(todayStr: string): WeightDiffResult {
  const all = loadWeightRecords();
  const todayRecord = all.find(r => r.date === todayStr) || null;
  if (all.length === 0 || !todayRecord) {
    return { todayRecord, beforeRecord: null, deltaKg: null, diffText: '', firstRecordEver: false };
  }
  // 取今天日期严格 < todayStr 的所有记录，按日期降序取第 1 条
  const before = all
    .filter(r => r.date < todayStr)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0];
  if (!before) {
    return {
      todayRecord,
      beforeRecord: null,
      deltaKg: null,
      diffText: '这是你的第一次记录',
      firstRecordEver: true
    };
  }
  const delta = todayRecord.weight - before.weight;
  const sign = delta > 0 ? '+' : (delta < 0 ? '-' : '');
  const text = delta === 0
    ? '与上次相同'
    : `比上次 ${sign}${Math.abs(delta).toFixed(WEIGHT_DECIMALS)} kg`;
  return {
    todayRecord,
    beforeRecord: before,
    deltaKg: delta,
    diffText: text,
    firstRecordEver: false
  };
}

// =========================================================================
// 七、趋势序列（最近 30 天，升序，用于 Canvas 绘图 & 最近记录列表）
// =========================================================================

export interface TrendPoint {
  date: string;        // YYYY-MM-DD
  weight: number;      // kg
}

/** 最近 30 天（含今天）内的、且有记录的日期，按日期升序；没有记录的日期不补点 */
export function getRecentTrendPoints(days: number = WEIGHT_TREND_DAYS): TrendPoint[] {
  const all = loadWeightRecords();
  if (all.length === 0) return [];
  // 最早允许日期 = today - (days - 1) 天（今天算第 1 天）
  const today = getTodayString();
  const todayObj = parseDateLocal(today);
  const earliestMs = todayObj.getTime() - (days - 1) * 24 * 60 * 60 * 1000;
  const earliest = dateStrFromMs(earliestMs);
  const inRange = all.filter(r => r.date >= earliest && r.date <= today);
  return sortWeightRecordsByDateAsc(inRange).map(r => ({ date: r.date, weight: r.weight }));
}

/** 最近 N 条（默认 10），按日期倒序 */
export function getRecentRecords(limit: number = WEIGHT_RECENT_LIMIT): WeightRecord[] {
  const all = loadWeightRecords();
  return sortWeightRecordsByDateDesc(all).slice(0, limit);
}

// =========================================================================
// 八、日期解析小工具（本地时区，避免 UTC 夏令时误差）
// =========================================================================

function parseDateLocal(dateStr: string): Date {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return new Date(NaN);
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  return new Date(y, m, d, 12, 0, 0, 0); // 中午 12 点避免跨时区
}

function dateStrFromMs(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
