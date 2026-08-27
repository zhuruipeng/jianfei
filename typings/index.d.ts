// 自定义类型补充声明（最小可用的 miniprogram API 声明，用于 TS 语法自检；开发微信开发者工具时可替换为官方 miniprogram-api-typings）

interface IAppOption {
  globalData: {
    firstLaunchDate?: string;
    anonymousUserId?: string;
    /** V9-fix1：冷启动 onLaunch 已记过 app_open 后置 true；onShow 检查后重置 false */
    launchAppOpenLogged?: boolean;
  };
  onLaunch?(): void;
  onShow?(): void;
  onHide?(): void;
}

/** `App` 全局构造（微信小程序） */
declare function App<T extends IAppOption>(options: T & WechatMiniprogram.App.Option): void;

/** `Page` 构造（微信小程序）
 *  - D: data 类型
 *  - C: 自定义方法 / 生命周期（含 onShareAppMessage 等）
 */
declare function Page<D extends WechatMiniprogram.Page.DataOption, C extends WechatMiniprogram.Page.CustomOption = WechatMiniprogram.Page.CustomOption>(
  options: WechatMiniprogram.Page.Options<D, C>
): void;

/** 自定义组件构造（项目只需要最小声明，具体 this 由微信运行时注入）。 */
declare function Component(options: Record<string, any>): void;

/** 获取全局 app 实例 */
declare function getApp<T extends IAppOption = IAppOption>(): T;

/** 微信小程序 wx 全局对象（最小声明，仅包含项目使用的 API 签名） */
declare namespace WechatMiniprogram {
  namespace App {
    interface Option {
      onLaunch?(): void;
      onShow?(): void;
      onHide?(): void;
    }
  }
  namespace Page {
    type DataOption = Record<string, any>;
    interface CustomOption {
      [key: string]: any;
    }
    interface Options<D extends DataOption, C extends CustomOption> {
      data: D;
      onLoad?(query?: Record<string, string>): void;
      onShow?(): void;
      [key: string]: any;
    }
  }
}

declare function getApp<T extends IAppOption = IAppOption>(): T;

declare const wx: {
  // Storage
  getStorageSync(key: string): any;
  setStorageSync(key: string, value: any): void;
  removeStorageSync(key: string): void;
  getStorageInfoSync(): { keys: string[]; currentSize: number; limitSize: number };

  // System
  getSystemInfoSync(): { windowWidth: number; windowHeight: number; pixelRatio: number; [k: string]: any };

  // Canvas
  createCanvasContext(canvasId: string, pageInstance?: any): {
    clearRect(x: number, y: number, w: number, h: number): void;
    setStrokeStyle(color: string): void;
    setFillStyle(color: string): void;
    setLineWidth(w: number): void;
    setLineJoin(join: 'round' | 'bevel' | 'miter'): void;
    setLineCap(cap: 'round' | 'butt' | 'square'): void;
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    arc(x: number, y: number, r: number, start: number, end: number): void;
    stroke(): void;
    fill(): void;
    draw(reserve?: boolean, callback?: () => void): void;
  };

  // UI
  showToast(options: { title: string; icon?: 'success' | 'none' | 'loading'; duration?: number }): void;
  showModal(options: {
    title: string;
    content?: string;
    editable?: boolean;
    placeholderText?: string;
    confirmText?: string;
    confirmColor?: string;
    cancelText?: string;
    success?: (res: { confirm: boolean; cancel?: boolean; content?: string }) => void;
    fail?: (err: any) => void;
    complete?: () => void;
  }): void;

  // Router
  switchTab(options: {
    url: string;
    success?: () => void;
    fail?: (err: any) => void;
    complete?: () => void;
  }): void;
  navigateTo(options: {
    url: string;
    success?: () => void;
    fail?: (err: any) => void;
    complete?: () => void;
  }): void;
  redirectTo(options: {
    url: string;
    success?: () => void;
    fail?: (err: any) => void;
    complete?: () => void;
  }): void;
  navigateBack(options?: {
    delta?: number;
    success?: () => void;
    fail?: (err: any) => void;
    complete?: () => void;
  }): void;
  // 下拉刷新停止
  stopPullDownRefresh(): void;

  // Navigation bar
  setNavigationBarTitle(options: {
    title: string;
    success?: () => void;
    fail?: (err: any) => void;
    complete?: () => void;
  }): void;

  // 媒体选择（官方 chooseMedia 替代老 chooseImage：camera/album 合二为一 + 自带压缩）
  chooseMedia(options: {
    count?: number;                                   // 本次最多选多少
    mediaType?: Array<'image' | 'video' | 'mix'>;    // 我们只用 ['image']
    sourceType?: Array<'album' | 'camera'>;
    sizeType?: Array<'original' | 'compressed'>;      // 我们只用 ['compressed']
    camera?: 'back' | 'front';
    success?: (res: {
      type: 'image' | 'video' | string;
      tempFiles: Array<{
        tempFilePath: string;
        size?: number;
        duration?: number;
        height?: number;
        width?: number;
        thumbTempFilePath?: string;
        [k: string]: any;
      }>;
      [k: string]: any;
    }) => void;
    fail?: (err: { errMsg?: string; errCode?: number; [k: string]: any }) => void;
    complete?: () => void;
  }): void;

  // 本地用户文件（保存临时路径 -> 持久本地，跨关闭不丢）
  saveFile(options: {
    tempFilePath: string;
    success?: (res: { savedFilePath: string; [k: string]: any }) => void;
    fail?: (err: any) => void;
    complete?: () => void;
  }): void;
  getSavedFileList(options: {
    success?: (res: {
      fileList: Array<{ filePath: string; size: number; createTime: number; [k: string]: any }>;
      [k: string]: any;
    }) => void;
    fail?: (err: any) => void;
    complete?: () => void;
  }): void;
  removeSavedFile(options: {
    filePath: string;
    success?: () => void;
    fail?: (err: any) => void;
    complete?: () => void;
  }): void;

  // 图片预览（点开大图，选做）
  previewImage(options: {
    current?: string;
    urls: string[];
    success?: () => void;
    fail?: (err: any) => void;
    complete?: () => void;
  }): void;

  // 网络状态（V6 点击 AI 前先判断是否离线）
  getNetworkType(options: {
    success?: (res: { networkType: 'wifi' | '2g' | '3g' | '4g' | '5g' | 'unknown' | 'none' | string; [k: string]: any }) => void;
    fail?: (err: any) => void;
    complete?: () => void;
  }): void;

  // 文件系统管理器（V9：本地图片统计/清除用）
  getFileSystemManager(): {
    readdirSync(dirPath: string): string[];
    statSync(filePath: string): { size: number; isFile(): boolean; isDirectory(): boolean };
    unlinkSync(filePath: string): void;
    rmdirSync(dirPath: string): void;
  };

  // 获取账号信息（V9：判断 envVersion==='develop' 开发环境）
  getAccountInfoSync(): { miniProgram: { envVersion: string; [k: string]: any } };

  // V6：微信云开发（wx.cloud 对象，可能在未启用云开发时为 undefined）
  cloud?: WxCloud;
};

// ---- 云开发相关签名（最小可用，strict zero-error 优先） ----
interface WxCloudInitOptions {
  env?: string | { database?: string; storage?: string; functions?: string };
  traceUser?: boolean;
}
interface WxCloudUploadFileOptions {
  cloudPath: string;
  filePath: string;                  // 本地临时或持久文件路径
  success?: (res: { fileID: string; statusCode?: number; [k: string]: any }) => void;
  fail?: (err: any) => void;
  complete?: () => void;
}
interface WxCloudDeleteFileOptions {
  fileList: string[];                // 要删除的云文件 fileID 数组
  success?: (res: { fileList: Array<{ fileID: string; status: number; errMsg?: string; [k: string]: any }>; [k: string]: any }) => void;
  fail?: (err: any) => void;
  complete?: () => void;
}
interface WxCloudCallFunctionOptions {
  name: string;                      // 云函数名
  data?: any;
  success?: (res: {
    result: any;                     // 云函数返回值（JSON 解析后）
    requestID?: string;
    [k: string]: any;
  }) => void;
  fail?: (err: any) => void;
  complete?: () => void;
}
interface WxCloud {
  init(options?: WxCloudInitOptions): void;
  uploadFile(options: WxCloudUploadFileOptions): any;
  deleteFile(options: WxCloudDeleteFileOptions): void;
  callFunction(options: WxCloudCallFunctionOptions): void;
  /** 官方提供的常量：代表默认 env（使用当前默认环境时可省略 env 入参） */
  readonly DYNAMIC_CURRENT_ENV?: string;
}
