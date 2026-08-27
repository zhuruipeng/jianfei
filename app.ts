// app.ts - 小程序入口
import { getOrCreateAnonymousUserId } from './utils/user';
import {
  trackAppFirstOpenOnce,
  trackAppOpen,
  trackPerfAppLaunchMs,
} from './services/usageService';

const APP_LAUNCH_START_MS = Date.now();  // app entry 首行即开始（最小性能记录）

function utilsGetTodayString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 尽力初始化云开发：
 *   - 成功：wx.cloud.xxx 后续可用
 *   - 失败：静默不抛，保证本地功能（记录/积分/奖励）在无网或未开云开发时完全可用
 */
function initCloudBestEffort(): void {
  try {
    const anyWx = wx as any;
    const cloud: any = anyWx.cloud;
    if (cloud && typeof cloud.init === 'function') {
      // V6 不写死 env：用户在微信开发者工具里开通云开发后，会自动走 DYNAMIC_CURRENT_ENV
      cloud.init({ traceUser: false });
    }
  } catch (e) {
    // swallow：没开云不影响其他本地功能
  }
}

App<IAppOption>({
  globalData: {
    firstLaunchDate: undefined,
    anonymousUserId: undefined,
    launchAppOpenLogged: false,  // V9-fix1：防 onLaunch+onShow 重复记 app_open
  },
  onLaunch() {
    // 1. 首次启动日期（用于显示"计划第几天"）
    const STORAGE_KEY_FIRST_DATE = 'app_first_launch_date';
    let firstDate: string | undefined;
    try {
      firstDate = wx.getStorageSync(STORAGE_KEY_FIRST_DATE) as string | undefined;
      if (firstDate && typeof firstDate === 'string' && firstDate.length > 0) {
        this.globalData.firstLaunchDate = firstDate;
      } else {
        const today = utilsGetTodayString();
        wx.setStorageSync(STORAGE_KEY_FIRST_DATE, today);
        this.globalData.firstLaunchDate = today;
        firstDate = today;
      }
    } catch (e) { /* swallow */ }

    // 2. V9：最小行为统计（不记录敏感内容）
    try {
      // app_first_open 只记录 1 次
      trackAppFirstOpenOnce(firstDate);
      // app_open 每次冷启动算 1 次（同一日可能多次）
      trackAppOpen();
      // V9-fix1：标记已记过，防止紧接着的 onShow 再记一次
      this.globalData.launchAppOpenLogged = true;
    } catch { /* swallow */ }

    // 3. V6：匿名用户 ID（启动即保证有值，用于云端目录分层 & 调用记录）
    try {
      this.globalData.anonymousUserId = getOrCreateAnonymousUserId();
    } catch (e) { /* swallow */ }

    // 4. V6：云开发尽力初始化（失败绝不阻断本地使用）
    initCloudBestEffort();

    // 5. V9：最小性能记录 App 启动耗时
    try {
      const dt = Math.max(0, Date.now() - APP_LAUNCH_START_MS);
      trackPerfAppLaunchMs(dt);
    } catch { /* swallow */ }
  },

  // V9：每次从后台切回前台，也记录 app_open（便于统计当日打开次数 / 使用粘性）
  // V9-fix1：onLaunch 后紧接的首次 onShow 不重复记（globalData.launchAppOpenLogged=true 时跳过并重置）
  onShow() {
    try {
      if (this.globalData.launchAppOpenLogged === true) {
        this.globalData.launchAppOpenLogged = false;
        return;
      }
      trackAppOpen();
    } catch { /* swallow */ }
  },

  onHide() {
    // V9-fix1：进入后台时清除标记，确保下次回前台会正常记 app_open
    try { this.globalData.launchAppOpenLogged = false; } catch { /* swallow */ }
  }
});
