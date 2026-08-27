/**
 * uiStrings.ts
 * 错误/提示文案统一出口。
 *
 *  - 技术错误(request:fail / 500 / JSON parse / undefined 等)绝不直接显示给用户。
 *  - 页面需要给 Toast / showModal 的统一从这里取或从这里派生。
 */

import { UI_MSG, EMPTY_MSG } from '../types/index';

export { UI_MSG, EMPTY_MSG };

/** 网络 / 未分类 错误 → 友好文案 */
export function toUserFriendlyError(err: any, fallback: string = UI_MSG.NETWORK): string {
  if (!err) return fallback;
  const s: string =
    (typeof err === 'string' ? err : err?.message || err?.errMsg || '') as string;
  if (!s) return fallback;
  // AI 分析失败
  if (/ai|analyze|model/i.test(s)) return UI_MSG.AI_FAILED;
  // 图片
  if (/image|photo|file/i.test(s) && !/network/i.test(s)) return UI_MSG.IMAGE_BROKEN;
  // Storage 本地存储
  if (/storage|save|syncStorage/i.test(s)) return UI_MSG.STORAGE_SAVE_FAIL;
  return fallback;
}

/** Toast 安全 title（长度、过滤 control char） */
export function toastSafe(text: string, max = 18): string {
  if (typeof text !== 'string') return '';
  return text.replace(/[\r\n\t]/g, ' ').slice(0, max);
}
