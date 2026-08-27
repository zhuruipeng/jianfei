/**
 * feedbackService.ts：用户反馈提交
 *
 * V11：反馈真正进入云端（云函数 submitFeedback + 云数据库 feedback 集合）。
 *   - 提交成功的唯一标准：云函数返回 success=true
 *   - 失败（离线 / 云未就绪 / 服务端拒绝）→ 写入本地 pending_feedback 队列，由用户主动重试
 *   - 不自动批量上传旧 user_feedback（用户当时未预期上云，旧数据保留本地）
 */

import {
  UserFeedback,
  FeedbackRating,
  STORAGE_KEY_USER_FEEDBACK,
  STORAGE_KEY_PENDING_FEEDBACK,
  FEEDBACK_CONTENT_MAX,
  PendingFeedback,
} from '../types/index';
import { formatDateTimeNow, genLocalId } from '../utils/date';
import { callSubmitFeedback, getAppVersion } from '../utils/cloud';

export function loadAllFeedback(): UserFeedback[] {
  try {
    const v = wx.getStorageSync(STORAGE_KEY_USER_FEEDBACK);
    if (Array.isArray(v)) {
      return (v as any[]).filter((x: any) =>
        x && typeof x === 'object' &&
        typeof x.id === 'string' &&
        (x.rating === 'good' || x.rating === 'okay' || x.rating === 'difficult') &&
        typeof x.createdAt === 'string'
      );
    }
  } catch { /* ignore */ }
  return [];
}

export function saveFeedback(params: {
  rating: FeedbackRating;
  content?: string;
}): UserFeedback | null {
  try {
    const rating: FeedbackRating | undefined =
      params.rating === 'good' || params.rating === 'okay' || params.rating === 'difficult'
        ? params.rating
        : undefined;
    if (!rating) return null;
    let content: string | undefined;
    if (typeof params.content === 'string' && params.content.length > 0) {
      // 强制 trim 到 FEEDBACK_CONTENT_MAX（防超长写入）
      const t = params.content.trim();
      content = t.length > 0 ? t.slice(0, FEEDBACK_CONTENT_MAX) : undefined;
    }
    const rec: UserFeedback = {
      id: genLocalId().replace(/^r_/, 'f_'),
      rating,
      content,
      createdAt: formatDateTimeNow(),
    };
    const list = loadAllFeedback();
    // 倒序插入（新的在最前；总限制 ≤ 500 条）
    const next = [rec].concat(list).slice(0, 500);
    wx.setStorageSync(STORAGE_KEY_USER_FEEDBACK, next);
    return rec;
  } catch {
    return null;
  }
}

export function clearAllFeedback(): void {
  try { wx.removeStorageSync(STORAGE_KEY_USER_FEEDBACK); } catch { /* ignore */ }
}

// =========================================================================
// V11：云端提交 + 本地待重试队列
// =========================================================================

/** 提交结果（给页面用） */
export interface SubmitFeedbackResult {
  ok: boolean;
  /** 已成功写入云端 */
  success: boolean;
  /** 失败且已写入本地 pending 队列，可稍后重试 */
  pending: boolean;
  /** 服务端业务拒绝（内容非法等），不写 pending（重试也没用） */
  invalid: boolean;
  /** 离线导致失败 */
  offline: boolean;
  /** 云能力未初始化导致失败 */
  cloudNotReady: boolean;
  message: string;
  feedbackId?: string;
}

/** 生成反馈业务 id（前后端对齐用） */
function genFeedbackId(): string {
  const id = genLocalId();  // r_yyyymmddHHMMss_xxxx
  return id.replace(/^r_/, 'fb_');
}

/**
 * 提交反馈到云端。
 * 成功 → success=true；失败 → 自动写入 pending 队列，pending=true。
 * 服务端业务拒绝（invalid）→ 不写 pending。
 */
export function submitFeedbackToCloud(
  params: {
    rating: FeedbackRating;
    content?: string;
  },
  cb: (res: SubmitFeedbackResult) => void
): void {
  const rating: FeedbackRating | undefined =
    params.rating === 'good' || params.rating === 'okay' || params.rating === 'difficult'
      ? params.rating
      : undefined;
  if (!rating) {
    cb({
      ok: false, success: false, pending: false, invalid: true,
      offline: false, cloudNotReady: false, message: '反馈内容有点问题，请检查一下。',
    });
    return;
  }
  let content: string | undefined;
  if (typeof params.content === 'string' && params.content.trim().length > 0) {
    content = params.content.trim().slice(0, FEEDBACK_CONTENT_MAX);
  }

  const id = genFeedbackId();
  const createdAt = new Date().toISOString();
  const appVersion = getAppVersion();

  callSubmitFeedback(
    { rating, content, id, createdAt },
    (res) => {
      if (res.ok) {
        cb({
          ok: true, success: true, pending: false, invalid: false,
          offline: false, cloudNotReady: false,
          message: '谢谢你的反馈。\n我们会继续把记录这件事做得更简单。',
          feedbackId: res.feedbackId,
        });
        return;
      }
      // 失败：服务端业务拒绝不写 pending（重试无意义）；其余失败写 pending
      if (res.invalid) {
        cb({
          ok: false, success: false, pending: false, invalid: true,
          offline: false, cloudNotReady: false,
          message: res.message || '反馈内容有点问题，请检查一下。',
        });
        return;
      }
      // 写入 pending 队列
      const pendingItem: PendingFeedback = {
        id,
        rating,
        content,
        appVersion,
        createdAt,
        pendingSince: new Date().toISOString(),
        retryCount: 0,
      };
      const saved = savePendingFeedback(pendingItem);
      if (!saved) {
        // pending 队列写失败：仍提示用户已暂存（避免压力），但不谎称成功
        cb({
          ok: false, success: false, pending: false, invalid: false,
          offline: res.offline || false, cloudNotReady: res.cloudNotReady || false,
          message: '这次没有提交成功，可以稍后再试一次。',
        });
        return;
      }
      cb({
        ok: false, success: false, pending: true, invalid: false,
        offline: res.offline || false, cloudNotReady: res.cloudNotReady || false,
        message: '这次没有提交成功。\n你的反馈已经暂时保存在本机，可以稍后重新提交。',
      });
    }
  );
}

// ---------------- pending 队列 CRUD ----------------

/** 读取本地待重试队列 */
export function loadPendingFeedback(): PendingFeedback[] {
  try {
    const v = wx.getStorageSync(STORAGE_KEY_PENDING_FEEDBACK);
    if (Array.isArray(v)) {
      return (v as any[]).filter((x: any) =>
        x && typeof x === 'object' &&
        typeof x.id === 'string' &&
        (x.rating === 'good' || x.rating === 'okay' || x.rating === 'difficult') &&
        typeof x.createdAt === 'string'
      );
    }
  } catch { /* ignore */ }
  return [];
}

/** 写入一条 pending（失败时返回 false） */
export function savePendingFeedback(item: PendingFeedback): boolean {
  try {
    const list = loadPendingFeedback();
    // 同 id 不重复入队
    if (list.some((x) => x.id === item.id)) return true;
    list.push(item);
    wx.setStorageSync(STORAGE_KEY_PENDING_FEEDBACK, list);
    return true;
  } catch {
    return false;
  }
}

/** 删除一条 pending（提交成功后调用） */
export function removePendingFeedback(id: string): void {
  try {
    const list = loadPendingFeedback();
    const next = list.filter((x) => x.id !== id);
    wx.setStorageSync(STORAGE_KEY_PENDING_FEEDBACK, next);
  } catch { /* ignore */ }
}

/** 是否有待提交反馈（用于反馈页 onLoad 显示重试入口） */
export function hasPendingFeedback(): boolean {
  return loadPendingFeedback().length > 0;
}

/**
 * 重试一条 pending：复用 callSubmitFeedback，成功后从队列移除。
 * @param id pending 项 id
 */
export function retryPendingFeedback(
  id: string,
  cb: (res: SubmitFeedbackResult) => void
): void {
  const list = loadPendingFeedback();
  const item = list.find((x) => x.id === id);
  if (!item) {
    cb({
      ok: false, success: false, pending: false, invalid: false,
      offline: false, cloudNotReady: false,
      message: '这条反馈已经不在待提交列表里了。',
    });
    return;
  }
  // 标记重试次数 +1（仅展示）
  try {
    item.retryCount = (typeof item.retryCount === 'number' ? item.retryCount : 0) + 1;
    const next = list.map((x) => (x.id === id ? item : x));
    wx.setStorageSync(STORAGE_KEY_PENDING_FEEDBACK, next);
  } catch { /* ignore */ }

  callSubmitFeedback(
    {
      rating: item.rating,
      content: item.content,
      id: item.id,
      createdAt: item.createdAt,
    },
    (res) => {
      if (res.ok) {
        removePendingFeedback(id);
        cb({
          ok: true, success: true, pending: false, invalid: false,
          offline: false, cloudNotReady: false,
          message: '之前的反馈已经提交成功啦。',
          feedbackId: res.feedbackId,
        });
        return;
      }
      if (res.invalid) {
        // 服务端拒绝：从队列移除（重试无意义），但不谎称成功
        removePendingFeedback(id);
        cb({
          ok: false, success: false, pending: false, invalid: true,
          offline: false, cloudNotReady: false,
          message: res.message || '这条反馈内容有点问题，已经移出待提交列表。',
        });
        return;
      }
      cb({
        ok: false, success: false, pending: true, invalid: false,
        offline: res.offline || false, cloudNotReady: res.cloudNotReady || false,
        message: '这次没有提交成功，反馈仍保存在本机，可以稍后再试。',
      });
    }
  );
}

/** 清空 pending 队列（开发环境清理测试数据用） */
export function clearPendingFeedback(): void {
  try { wx.removeStorageSync(STORAGE_KEY_PENDING_FEEDBACK); } catch { /* ignore */ }
}
