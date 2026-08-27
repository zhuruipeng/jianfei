// utils/cloud.ts - V6 云端基础封装：云存储上传/尽力删除 + callAnalyzeMeal
// 设计原则：
//   1. 前端永远不直接访问第三方 AI；AI key 只放在云函数/后端环境变量
//   2. 不上传任何用户未主动点击"AI看看这一餐"的历史照片
//   3. 本模块任何一步失败都要吞异常 + 返回 ok=false，不让本地记录/小程序崩
//   4. 相同 mealRecord + 本地照片没换 → 复用已有 cloudImageId，不重复上传
import { MealAnalysisResponse, FeedbackRating, CLOUD_FUNC_SUBMIT_FEEDBACK } from '../types/index';
import { getOrCreateAnonymousUserId } from './user';

/** 上传阶段统一回调结果 */
export interface CloudUploadResult {
  ok: boolean;
  fileID?: string;                   // 云存储 fileID（私有）
  cloudPath?: string;                // 实际上传的云端路径
  /** 具体失败原因，仅用于前端提示（不要把堆栈直接吐给用户） */
  message?: string;
  /** 无网络时 true（给用户看稍后再试） */
  offline?: boolean;
  /** 小程序没有启用云开发（wx.cloud 未初始化/不存在）时 true */
  cloudNotReady?: boolean;
}

/** 调用 analyzeMeal 云端入口的结果（V6 返回 not_implemented） */
export interface CallAnalyzeResult {
  ok: boolean;
  response?: MealAnalysisResponse;
  message?: string;
  offline?: boolean;
  cloudNotReady?: boolean;
}

const CLOUD_DIR_ROOT = 'meal-images';
/** 生成 目标云端路径： meal-images/YYYY/MM/anonymous_xxx/meal_abc123.jpg
 *  - mealRecordId 保证每条餐一个唯一目标名
 *  - 不直接用 fileID（fileID 不包含用户维度，且不方便目录分层清理）
 */
export function buildCloudImagePath(dateYYYYMMDD: string, mealRecordId: string): string {
  // date 形如 2026-08-20
  const safe = typeof dateYYYYMMDD === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateYYYYMMDD)
    ? dateYYYYMMDD
    : '0000-00-00';
  const parts = safe.split('-');
  const year = parts[0];
  const month = parts[1] || '00';
  const uid = getOrCreateAnonymousUserId();
  // 防止 mealRecordId 里有 '/'
  const cleanId = (mealRecordId || 'no_id').replace(/[\\/:*?"<>|]/g, '_');
  return `${CLOUD_DIR_ROOT}/${year}/${month}/${uid}/meal_${cleanId}.jpg`;
}

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

/** 判断 wx.cloud 是否启用并且已经 init（V6 我们 app.ts 启动时尽力 init，失败此处当 cloudNotReady） */
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
 * 把一条 meal 对应的本地照片传到云存储（私有）。
 * 只有"用户主动点 AI 分析"才会被调用。
 * @param localPhotoPath 已存在的本地持久路径（savedFilePath）或 临时路径
 * @param dateYYYYMMDD MealRecord.date，用于生成云端层级目录
 * @param mealRecordId MealRecord.id，保证文件名唯一且可追溯
 */
export function uploadMealPhotoToCloud(
  localPhotoPath: string,
  dateYYYYMMDD: string,
  mealRecordId: string,
  cb: (res: CloudUploadResult) => void
): void {
  if (!localPhotoPath || typeof localPhotoPath !== 'string' || localPhotoPath.length === 0) {
    cb({ ok: false, message: '本地照片不存在' });
    return;
  }
  isOfflineAsync((offline) => {
    if (offline) { cb({ ok: false, offline: true, message: '网络暂时不可用，稍后再试' }); return; }
    const ctx = getCloudReady();
    if (!ctx) { cb({ ok: false, cloudNotReady: true, message: '云能力暂未开通，请稍后再试' }); return; }
    const cloudPath = buildCloudImagePath(dateYYYYMMDD, mealRecordId);
    try {
      ctx.cloud.uploadFile({
        cloudPath,
        filePath: localPhotoPath,
        success(res: any) {
          const fileID: string | undefined = res && typeof res.fileID === 'string' ? res.fileID : undefined;
          if (!fileID) {
            cb({ ok: false, cloudPath, message: '上传成功但未返回文件标识' });
            return;
          }
          cb({ ok: true, fileID, cloudPath });
        },
        fail(err: any) {
          const msg = (err && typeof err.errMsg === 'string') ? err.errMsg : '上传失败';
          cb({ ok: false, cloudPath, message: msg });
        },
      });
    } catch (e) {
      cb({ ok: false, cloudPath, message: '上传失败' });
    }
  });
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

/**
 * 调用云端 analyzeMeal 入口（V7：传入饮食文字/饱腹/标签/anonymousUserId，云函数取私有图 tempURL 调 AI）
 * - 密钥只在云函数环境变量；前端只拿到结构化 MealAnalysis（脱敏）
 * - 不传图片 URL；云函数内部 cloud.getTempFileURL 生成临时地址（私有优先）
 */
export function callAnalyzeMeal(
  mealRecordId: string,
  cloudImageId: string,
  opts: {
    mealType?: string;
    foodText?: string;
    satietyLevel?: string;
    tags?: string[];
  },
  cb: (res: CallAnalyzeResult) => void
): void {
  if (!mealRecordId || !cloudImageId) {
    cb({ ok: false, message: '参数不完整' });
    return;
  }
  isOfflineAsync((offline) => {
    if (offline) { cb({ ok: false, offline: true, message: '网络暂时不可用，稍后再试' }); return; }
    const ctx = getCloudReady();
    if (!ctx) { cb({ ok: false, cloudNotReady: true, message: '云能力暂未开通，请稍后再试' }); return; }
    try {
      const anonymousUserId = getOrCreateAnonymousUserId();
      const o = opts || {};
      const data = {
        mealRecordId,
        cloudImageId,
        anonymousUserId,
        mealType: typeof o.mealType === 'string' ? o.mealType : '',
        foodText: typeof o.foodText === 'string' ? o.foodText : '',
        satietyLevel: typeof o.satietyLevel === 'string' ? o.satietyLevel : '',
        tags: Array.isArray(o.tags) ? o.tags.slice() : [],
      };
      ctx.cloud.callFunction({
        name: 'analyzeMeal',
        data,
        success(res: any) {
          const result: any = res && res.result;
          // 允许云函数直接返回 {success,status} 或 {returnValue:{...}} 两种风格
          const body: MealAnalysisResponse =
            result && typeof result === 'object' && ('success' in result || 'status' in result)
              ? (result as MealAnalysisResponse)
              : (result && typeof result.returnValue === 'object' ? result.returnValue : null);
          if (!body) {
            cb({ ok: false, message: '云端返回异常' });
            return;
          }
          cb({ ok: !!body.success, response: body, message: body.message });
        },
        fail(err: any) {
          const msg = (err && typeof err.errMsg === 'string') ? err.errMsg : '调用失败';
          cb({ ok: false, message: msg });
        },
      });
    } catch (e) {
      cb({ ok: false, message: '调用失败' });
    }
  });
}

// =========================================================================
// V11：用户反馈云端提交
//   - 只上传 anonymousUserId / rating / content / appVersion
//   - 不上传体重 / 饮食 / 照片 / AI / 运动 / 奖励等任何业务数据
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
