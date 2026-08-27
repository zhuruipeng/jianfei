/**
 * devDataService.ts：开发环境专用——统计本地数据大小/图片数量 & 一键清除全部测试数据
 *
 * 注意：本文件内所有 API 都只能在开发环境按钮的回调里调用，
 *       正式版 UI 不会暴露任何入口（V9-16 强约束）。
 */

import * as usageService from './usageService';
import * as feedbackService from './feedbackService';
import {
  STORAGE_KEY_MEAL_RECORDS,
  STORAGE_KEY_WEIGHT_RECORDS,
  STORAGE_KEY_REWARDS,
  STORAGE_KEY_USAGE_EVENTS,
  STORAGE_KEY_USER_FEEDBACK,
  STORAGE_KEY_USAGE_FIRST_OPEN_DONE,
  STORAGE_KEY_WATER_GOAL_REACHED_BY_DATE,
  STORAGE_KEY_AI_UPLOAD_CONSENT,
  STORAGE_KEY_HOME_WELCOME_SHOWN,
  STORAGE_KEY_GOAL_DAYS,
  STORAGE_KEY_FIRST_DATE,
  STORAGE_KEY_ANONYMOUS_USER_ID,
  STORAGE_KEY_ONBOARDING_DONE,
  // V10：计划闭环相关 storage keys
  STORAGE_KEY_USER_PLAN,
  STORAGE_KEY_USER_PLAN_HISTORY,
  STORAGE_KEY_WEEKLY_SUMMARIES,
  STORAGE_KEY_PLAN_SETUP_DISMISSED,
  // V11：反馈待重试队列
  STORAGE_KEY_PENDING_FEEDBACK,
  // V12：养成系统相关
  STORAGE_KEY_ENERGY_LEDGER,
  STORAGE_KEY_COMPANION_STATE,
  STORAGE_KEY_COMPANION_INTRO_SHOWN,
  STORAGE_KEY_COMPANION_WELCOME_GIVEN,
  STORAGE_KEY_SPECIAL_TASK_SKIPPED_PREFIX,
  // V12.1：旅程收藏卡解锁
  STORAGE_KEY_JOURNEY_CARDS_UNLOCKED_V1,
  // V13：世界动画已读状态（业务状态不存储）
  STORAGE_KEY_WORLD_UI_STATE,
  STORAGE_KEY_WORLD_DISCOVERIES,
} from '../types/index';
import { isDevEnv } from './devService';

/** 仅开发环境允许，其它环境直接抛（调用方 UI 已 guard，这里再次兜底） */
function assertDev(label: string): void {
  if (!isDevEnv()) {
    throw new Error(`${label}: only allowed in develop environment`);
  }
}

export interface LocalStorageStats {
  ok: boolean;
  keysCount: number;      // 当前 Storage 中 key 总数
  currentSizeKb: number;  // wx.getStorageInfoSync().currentSize (KB)
  currentSizeBytes: number;
  limitSizeKb: number;    // limitSize (KB)，微信基础库 2.27+ 保证，否则返回 0
  msg?: string;
}

/** 本地数据：Storage 总体大小（用 wx 提供的 API，最快最准） */
export function getLocalStorageStats(): LocalStorageStats {
  assertDev('getLocalStorageStats');
  try {
    const info = wx.getStorageInfoSync();
    const kb: number = typeof (info as any).currentSize === 'number' ? (info as any).currentSize : 0;
    const limit: number = typeof (info as any).limitSize === 'number' ? (info as any).limitSize : 0;
    return {
      ok: true,
      keysCount: (info.keys || []).length,
      currentSizeKb: Math.round(kb),
      currentSizeBytes: Math.round(kb * 1024),
      limitSizeKb: Math.round(limit),
    };
  } catch (e) {
    return { ok: false, keysCount: 0, currentSizeKb: 0, currentSizeBytes: 0, limitSizeKb: 0, msg: e && (e as Error).message ? (e as Error).message : 'unknown' };
  }
}

export interface LocalImageStats {
  ok: boolean;
  imageFilesCount: number;
  totalSizeBytes: number;
  totalSizeKb: number;
  imageDirPath: string;
  msg?: string;
}

/** 本地饮食照片：image 目录下的文件总数 & 总占用（wx.env.USER_DATA_PATH/images） */
export function getLocalImageStats(): LocalImageStats {
  assertDev('getLocalImageStats');
  try {
    const userData = (wx as any).env && typeof (wx as any).env.USER_DATA_PATH === 'string' ? (wx as any).env.USER_DATA_PATH : '';
    const baseDir = userData && userData.length > 0 ? `${userData}/images` : '';
    if (!baseDir) {
      return { ok: false, imageFilesCount: 0, totalSizeBytes: 0, totalSizeKb: 0, imageDirPath: '', msg: 'no-user-data-path' };
    }
    const fs = wx.getFileSystemManager();
    let count = 0;
    let totalBytes = 0;

    // V9-fix6：递归扫描 images 目录（兼容未来按日期子目录存储）
    const walk = (dir: string, depth: number) => {
      if (depth > 5) return;  // 防止无限递归
      let names: string[] = [];
      try { names = fs.readdirSync(dir) as string[]; } catch { return; }
      for (const name of names || []) {
        const p = `${dir}/${name}`;
        try {
          const st: any = fs.statSync(p);
          if (st && typeof st.isDirectory === 'function' && st.isDirectory()) {
            walk(p, depth + 1);
          } else if (st && typeof st.isFile === 'function' ? st.isFile() : /\.[a-zA-Z0-9]{1,8}$/.test(name)) {
            count += 1;
            totalBytes += (typeof st.size === 'number') ? st.size : 0;
          }
        } catch { /* ignore individual file errors */ }
      }
    };
    walk(baseDir, 0);

    return {
      ok: true,
      imageFilesCount: count,
      totalSizeBytes: totalBytes,
      totalSizeKb: Math.round(totalBytes / 1024),
      imageDirPath: baseDir,
    };
  } catch (e) {
    return {
      ok: false,
      imageFilesCount: 0,
      totalSizeBytes: 0,
      totalSizeKb: 0,
      imageDirPath: '',
      msg: e && (e as Error).message ? (e as Error).message : 'unknown',
    };
  }
}

/** 清除全部测试数据（返回 cleared count 仅用于 Toast）
 *
 *  删除范围（V9-16 清单）：
 *   - daily_record_* 前缀（90 天兜底）
 *   - meal_records
 *   - weight_records
 *   - rewards
 *   - usage_events
 *   - user_feedback
 *   - 本地饮食照片（USER_DATA_PATH/images 下所有文件 + MealRecord 引用）
 *   - AI 本地关联（consent/analysis 等字段在 MealRecord 中一并删除）
 *   - onboarding / goalDays / firstDate / welcomeShown 等进度/开关
 */
export interface ClearAllTestDataResult {
  ok: boolean;
  msg?: string;
  clearedStorageKeys: number;
  deletedImageFiles: number;
}

function clearAllDailyRecordPrefixes(): number {
  // V9-fix7：改为读 keys 列表过滤 daily_record_ 前缀（不再扫 180 天兜底，更彻底无遗漏）
  let n = 0;
  try {
    const allKeys = wx.getStorageInfoSync().keys || [];
    for (const k of allKeys) {
      if (typeof k === 'string' && k.indexOf('daily_record_') === 0) {
        try { wx.removeStorageSync(k); n += 1; } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return n;
}

function clearAllWaterGoalFlags(): number {
  // V9-fix7：改为读 keys 列表过滤 water_goal_reached_flag_v1_ 前缀（不再扫 180 天兜底）
  let n = 0;
  try {
    const allKeys = wx.getStorageInfoSync().keys || [];
    for (const k of allKeys) {
      if (typeof k === 'string' && k.indexOf(STORAGE_KEY_WATER_GOAL_REACHED_BY_DATE) === 0) {
        try { wx.removeStorageSync(k); n += 1; } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return n;
}

function tryDeleteAllLocalImages(): number {
  try {
    const userData = (wx as any).env && typeof (wx as any).env.USER_DATA_PATH === 'string' ? (wx as any).env.USER_DATA_PATH : '';
    if (!userData) return 0;
    const baseDir = `${userData}/images`;
    const fs = wx.getFileSystemManager();
    let removed = 0;

    // V9-fix6：递归删除所有文件（兼容子目录）
    const walk = (dir: string, depth: number) => {
      if (depth > 5) return;
      let names: string[] = [];
      try { names = fs.readdirSync(dir) as string[]; } catch { return; }
      for (const name of names || []) {
        const p = `${dir}/${name}`;
        try {
          const st: any = fs.statSync(p);
          if (st && typeof st.isDirectory === 'function' && st.isDirectory()) {
            walk(p, depth + 1);
            try { fs.rmdirSync(p); } catch { /* ignore: dir not empty */ }
          } else {
            try { fs.unlinkSync(p); removed += 1; } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      }
    };
    walk(baseDir, 0);
    return removed;
  } catch {
    return 0;
  }
}

export function clearAllTestData(): ClearAllTestDataResult {
  assertDev('clearAllTestData');
  try {
    let clearedKeys = 0;
    // 1) daily records（扫 180 天前缀兜底）
    clearedKeys += clearAllDailyRecordPrefixes();
    clearedKeys += clearAllWaterGoalFlags();

    // 2) Meal / Weight / Reward / Usage / Feedback 主体
    const list = [
      STORAGE_KEY_MEAL_RECORDS,
      STORAGE_KEY_WEIGHT_RECORDS,
      STORAGE_KEY_REWARDS,
      STORAGE_KEY_USAGE_EVENTS,
      STORAGE_KEY_USER_FEEDBACK,
      STORAGE_KEY_USAGE_FIRST_OPEN_DONE,
      STORAGE_KEY_AI_UPLOAD_CONSENT,
      STORAGE_KEY_HOME_WELCOME_SHOWN,
      STORAGE_KEY_GOAL_DAYS,
      STORAGE_KEY_FIRST_DATE,
      STORAGE_KEY_ANONYMOUS_USER_ID,
      STORAGE_KEY_ONBOARDING_DONE,
      'ai_analysis_cache_v1',
      // V10：计划闭环
      STORAGE_KEY_USER_PLAN,
      STORAGE_KEY_USER_PLAN_HISTORY,
      STORAGE_KEY_WEEKLY_SUMMARIES,
      STORAGE_KEY_PLAN_SETUP_DISMISSED,
      // V11：反馈待重试队列
      STORAGE_KEY_PENDING_FEEDBACK,
      // V12：养成系统主体
      STORAGE_KEY_ENERGY_LEDGER,
      STORAGE_KEY_COMPANION_STATE,
      STORAGE_KEY_COMPANION_INTRO_SHOWN,
      STORAGE_KEY_COMPANION_WELCOME_GIVEN,
      // V12.1：旅程收藏卡解锁
      STORAGE_KEY_JOURNEY_CARDS_UNLOCKED_V1,
      // V13：世界动画缓存
      STORAGE_KEY_WORLD_UI_STATE,
      STORAGE_KEY_WORLD_DISCOVERIES,
    ];
    for (const k of list) {
      try { wx.removeStorageSync(k); clearedKeys += 1; } catch { /* ignore */ }
    }
    // V9-fix2：清除所有 reward_unlocked_done_* 幂等标记（按 keys 扫描）
    try {
      const allKeys = wx.getStorageInfoSync().keys || [];
      for (const k of allKeys) {
        if (typeof k === 'string' && k.indexOf('reward_unlocked_done_') === 0) {
          try { wx.removeStorageSync(k); clearedKeys += 1; } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
    // V10：清除所有 weekly_summary_viewed_* 标记（按 keys 扫描）
    try {
      const allKeys2 = wx.getStorageInfoSync().keys || [];
      for (const k of allKeys2) {
        if (typeof k === 'string' && k.indexOf('weekly_summary_viewed_') === 0) {
          try { wx.removeStorageSync(k); clearedKeys += 1; } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
    // V12：清除所有 special_task_skipped_v1_* 前缀标记（按 keys 扫描）
    try {
      const allKeys3 = wx.getStorageInfoSync().keys || [];
      for (const k of allKeys3) {
        if (typeof k === 'string' && k.indexOf(STORAGE_KEY_SPECIAL_TASK_SKIPPED_PREFIX) === 0) {
          try { wx.removeStorageSync(k); clearedKeys += 1; } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
    // 3) usageService/feedbackService 内部清理（确保缓存同步）
    try { usageService.clearAllUsageEvents(); } catch { /* ignore */ }
    try { feedbackService.clearAllFeedback(); } catch { /* ignore */ }

    // 4) 本地饮食照片
    const deletedImageFiles = tryDeleteAllLocalImages();

    return {
      ok: true,
      clearedStorageKeys: clearedKeys,
      deletedImageFiles,
    };
  } catch (e) {
    return {
      ok: false,
      msg: e && (e as Error).message ? (e as Error).message : 'unknown',
      clearedStorageKeys: 0,
      deletedImageFiles: 0,
    };
  }
}
