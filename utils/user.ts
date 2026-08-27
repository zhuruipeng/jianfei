// utils/user.ts - 匿名用户 ID（V6 内部标识：不存手机号/昵称/头像）
import { STORAGE_KEY_ANONYMOUS_USER_ID } from '../types/index';

const UID_PREFIX = 'u_';
const UID_RAND_LEN = 12; // 小写字母 + 数字

/** 生成 12 位随机串（a-z0-9） */
function makeRandIdSegment(len: number): string {
  const pool = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  try {
    // 优先用微信基础库提供的加密随机（若可用），否则回退 Math.random
    const anyWx = wx as any;
    if (anyWx && typeof anyWx.getRandomValues === 'function') {
      const arr = new Uint8Array(len);
      anyWx.getRandomValues(arr);
      for (let i = 0; i < len; i++) out += pool.charAt((arr[i] as number) % pool.length);
      return out;
    }
  } catch (e) {
    // ignore
  }
  for (let i = 0; i < len; i++) {
    out += pool.charAt(Math.floor(Math.random() * pool.length));
  }
  return out;
}

/**
 * 取匿名用户 ID。没有则新建并持久化：u_ + 12 位随机（a-z0-9）。
 * 保证：同一用户不会每次启动重新生成；不包含手机号/姓名/昵称/头像等 PII。
 */
export function getOrCreateAnonymousUserId(): string {
  try {
    const raw: any = wx.getStorageSync(STORAGE_KEY_ANONYMOUS_USER_ID);
    if (typeof raw === 'string' && raw.length > UID_PREFIX.length && raw.indexOf(UID_PREFIX) === 0) {
      const rest = raw.substring(UID_PREFIX.length);
      if (/^[a-z0-9]+$/.test(rest)) return raw;
    }
  } catch (e) {
    // ignore
  }
  const fresh = UID_PREFIX + makeRandIdSegment(UID_RAND_LEN);
  try { wx.setStorageSync(STORAGE_KEY_ANONYMOUS_USER_ID, fresh); } catch (e) { /* swallow */ }
  return fresh;
}
