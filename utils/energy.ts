/**
 * utils/energy.ts - V12 轻能量账本
 *
 * 唯一权威数据源：EnergyLedger 数组。
 * totalEnergy = 所有有效 Ledger 之和，不再维护容易漂移的累计字段。
 *
 * 防重原则：
 *   同一天 + 同一 source + 同一 sourceId → 全局唯一。
 *   调用者不用关心重复，awardEnergy 内部幂等。
 */

import {
  STORAGE_KEY_ENERGY_LEDGER,
  EnergyLedger,
  EnergySource,
} from '../types/index';
import { formatDateTimeNow, genLocalId, getTodayString } from './date';

function _normalize(raw: any): EnergyLedger | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw.source;
  if (typeof src !== 'string') return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (typeof raw.date !== 'string' || !raw.date) return null;
  if (typeof raw.sourceId !== 'string') return null;
  const amt = Number(raw.amount);
  if (!isFinite(amt) || amt <= 0) return null;
  if (typeof raw.createdAt !== 'string' || !raw.createdAt) return null;
  return {
    id: raw.id,
    date: raw.date,
    source: raw.source as EnergySource,
    sourceId: raw.sourceId,
    amount: Math.round(amt),
    createdAt: raw.createdAt,
  };
}

export function loadEnergyLedger(): EnergyLedger[] {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY_ENERGY_LEDGER);
    if (!Array.isArray(raw)) return [];
    const out: EnergyLedger[] = [];
    for (const item of raw) {
      const n = _normalize(item);
      if (n) out.push(n);
    }
    return out;
  } catch (e) {
    console.error('[energy] loadEnergyLedger failed', e);
    return [];
  }
}

function _save(list: EnergyLedger[]): void {
  try {
    wx.setStorageSync(STORAGE_KEY_ENERGY_LEDGER, list);
  } catch (e) {
    const err = new Error('能量保存失败');
    (err as any).cause = e;
    throw err;
  }
}

export function calculateTotalEnergy(list?: EnergyLedger[]): number {
  const arr = list || loadEnergyLedger();
  let sum = 0;
  for (const r of arr) sum += r.amount;
  return sum;
}

export function calculateTotalEnergyForDate(date: string, list?: EnergyLedger[]): number {
  if (!date) return 0;
  const arr = list || loadEnergyLedger();
  let sum = 0;
  for (const r of arr) {
    if (r.date === date) sum += r.amount;
  }
  return sum;
}

/**
 * 发放能量（幂等）。
 *
 * 若已存在 (date + source + sourceId) 完全相同的记录 -> 不重复，返回 existed=true。
 * 若新增成功 -> 返回 created=true，并附带新记录。
 * 调用方据此决定是否弹"获得能量"提示。
 */
export interface AwardResult {
  ok: boolean;
  created: boolean;
  existed: boolean;
  record?: EnergyLedger;
  msg?: string;
}

export function awardEnergy(
  args: { date: string; source: EnergySource; sourceId: string; amount: number }
): AwardResult {
  const { date, source, sourceId, amount } = args || ({} as any);
  if (!date || typeof date !== 'string') {
    return { ok: false, created: false, existed: false, msg: 'date 缺失' };
  }
  if (typeof source !== 'string') {
    return { ok: false, created: false, existed: false, msg: 'source 缺失' };
  }
  if (typeof sourceId !== 'string') {
    return { ok: false, created: false, existed: false, msg: 'sourceId 缺失' };
  }
  const amt = Math.round(Number(amount));
  if (!isFinite(amt) || amt <= 0) {
    return { ok: false, created: false, existed: false, msg: 'amount 不合法' };
  }

  const list = loadEnergyLedger();

  // 防重：同一 date+source+sourceId
  const dup = list.find(
    (r) => r.date === date && r.source === source && r.sourceId === sourceId
  );
  if (dup) {
    return { ok: true, created: false, existed: true, record: dup };
  }

  const rec: EnergyLedger = {
    id: `el_${genLocalId().slice(2)}`,
    date,
    source,
    sourceId,
    amount: amt,
    createdAt: formatDateTimeNow(),
  };
  list.push(rec);
  try {
    _save(list);
  } catch (e: any) {
    return {
      ok: false,
      created: false,
      existed: false,
      msg: e && e.message ? e.message : '保存失败',
    };
  }
  return { ok: true, created: true, existed: false, record: rec };
}

/** 仅开发环境：重置账本 */
export function _resetEnergyLedger(): void {
  _save([]);
}

/** 仅开发环境：手动注入一天的 bonus（防重按 date+source+sourceId） */
export function _awardAny(
  date: string,
  source: EnergySource,
  sourceId: string,
  amount: number
): AwardResult {
  return awardEnergy({ date: date || getTodayString(), source, sourceId, amount });
}
