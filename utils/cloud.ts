// utils/cloud.ts - 用户反馈提交与旧云文件清理。
// 当前版本不上传饮食照片，也不提供自动分析服务。
import { FeedbackRating, CLOUD_FUNC_SUBMIT_FEEDBACK } from '../types/index';
import { getOrCreateAnonymousUserId } from './user';

/** 检查网络是否离线；返回 false 代表"无网或 unknown 失败" */
export function isOfflineAsync(cb: (offline: boolean) => void): void {
  try {
    wx.getNetworkType({
      success(res) {
        const t = res && res.networkType;
        if (t === 'none') { cb(true); return; }
        if (!t) { cb(false); return; }              // 拿不到类型，允许试试（可能新的 networkType 值）
        cb(false);
      },
      fail() { cb(false); },
    });
  } catch (e) { cb(false); }
}

/** 判断 wx.cloud 是否启用并且已经 init。 */
function getCloudReady(): { cloud: any } | null {
  try {
    const anyWx = wx as any;
    const cloud = anyWx.cloud;
    if (cloud && typeof cloud.uploadFile === 'function' && typeof cloud.callFunction === 'function') {
      return { cloud };
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * 尽力删除一条云端文件（不保证成功，不抛异常，不阻塞用户操作）。
 * 用户删除 MealRecord、或替换旧照片、或删除单张照片 → 都可以尝试调用。
 */
export function tryDeleteCloudFileBestEffort(fileID?: string): void {
  if (!fileID || typeof fileID !== 'string' || fileID.length === 0) return;
  const ctx = getCloudReady();
  if (!ctx) return;
  try {
    ctx.cloud.deleteFile({
      fileList: [fileID],
      // success/fail 都静默：用户无需知道云端清理失败
      success() { /* noop */ },
      fail() { /* noop */ },
      complete() { /* noop */ },
    });
  } catch (e) {
    // swallow
  }
}

// =========================================================================
// V11：用户反馈云端提交
//   - 只上传 anonymousUserId / rating / content / appVersion
//   - 不上传体重 / 饮食 / 照片 / 运动 / 奖励等任何业务数据
// =========================================================================

/** 提交反馈云函数返回结果 */
export interface CallSubmitFeedbackResult {
  ok: boolean;
  feedbackId?: string;
  message?: string;
  offline?: boolean;
  cloudNotReady?: boolean;
  /** 服务端返回的"内容非法"等业务拒绝 */
  invalid?: boolean;
}

/** 获取小程序版本号（用于反馈埋点，可空） */
export function getAppVersion(): string | undefined {
  try {
    const info = (wx as any).getAccountInfoSync?.();
    const v = info && info.miniProgram && info.miniProgram.version;
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    // 开发版 / 体验版 version 通常为空，用 envVersion 兜底标记
    const env = info && info.miniProgram && info.miniProgram.envVersion;
    if (env === 'develop') return 'dev';
    if (env === 'trial') return 'trial';
    return undefined;
  } catch (e) {
    return undefined;
  }
}

/**
 * 调用 submitFeedback 云函数，把反馈写入云数据库。
 * 成功的唯一标准：云函数返回 success=true。
 * 任何失败（离线 / 云未初始化 / 云函数异常 / 服务端拒绝）都返回 ok=false，
 *   由调用方决定是否写入本地 pending 队列。
 */
export function callSubmitFeedback(
  params: {
    rating: FeedbackRating;
    content?: string;
    id: string;                  // 前端生成的业务 id，便于去重与重试对齐
    createdAt: string;           // ISO 字符串
  },
  cb: (res: CallSubmitFeedbackResult) => void
): void {
  const rating: FeedbackRating | undefined =
    params.rating === 'good' || params.rating === 'okay' || params.rating === 'difficult'
      ? params.rating
      : undefined;
  if (!rating || !params.id || !params.createdAt) {
    cb({ ok: false, invalid: true, message: '反馈内容有点问题，请检查一下。' });
    return;
  }
  isOfflineAsync((offline) => {
    if (offline) { cb({ ok: false, offline: true, message: '网络暂时不可用，稍后再试。' }); return; }
    const ctx = getCloudReady();
    if (!ctx) { cb({ ok: false, cloudNotReady: true, message: '云能力暂未开通，请稍后再试。' }); return; }
    try {
      const anonymousUserId = getOrCreateAnonymousUserId();
      const appVersion = getAppVersion();
      // 严格只传允许的字段，绝不夹带业务数据
      const data: Record<string, string> = {
        id: params.id,
        anonymousUserId,
        rating,
        createdAt: params.createdAt,
      };
      if (typeof params.content === 'string' && params.content.trim().length > 0) {
        data.content = params.content.trim();
      }
      if (typeof appVersion === 'string' && appVersion.length > 0) {
        data.appVersion = appVersion;
      }
      ctx.cloud.callFunction({
        name: CLOUD_FUNC_SUBMIT_FEEDBACK,
        data,
        success(res: any) {
          const result: any = res && res.result;
          const body: any =
            result && typeof result === 'object' && ('success' in result)
              ? result
              : (result && typeof result.returnValue === 'object' ? result.returnValue : null);
          if (!body) {
            cb({ ok: false, message: '云端返回异常，可以稍后再试。' });
            return;
          }
          if (body.success === true) {
            cb({ ok: true, feedbackId: body.feedbackId || params.id });
            return;
          }
          // 服务端拒绝（参数非法 / DB 写入失败 / 未知错误）
          cb({
            ok: false,
            invalid: body.error === 'INVALID_INPUT',
            message: typeof body.message === 'string' ? body.message : '这次没有提交成功，可以稍后再试。',
          });
        },
        fail(err: any) {
          const msg = (err && typeof err.errMsg === 'string') ? err.errMsg : '调用失败，可以稍后再试。';
          cb({ ok: false, message: msg });
        },
      });
    } catch (e) {
      cb({ ok: false, message: '调用失败，可以稍后再试。' });
    }
  });
}
