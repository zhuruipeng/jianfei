// utils/image.ts - 饮食图片拍照/相册选择 + 本地持久化 + 回收清理
import { loadMealRecords, saveMealRecords } from './meal';
import { MealRecord } from '../types/index';

export interface PickAndSaveResult {
  ok: boolean;
  /** 最终已持久化的本地路径（永久文件） */
  savedFilePath?: string;
  /** 用户取消（不抛错，调用方静默即可） */
  canceled?: boolean;
  /** 失败/权限拒绝时的中文提示 */
  msg?: string;
}

/** 返回：当前所有 meal_records 里 photoPath 不为空的集合（用于清理孤文件） */
export function getMealPhotoPathsInUse(): Set<string> {
  try {
    const list = loadMealRecords();
    const s = new Set<string>();
    for (const r of list) {
      if (r.photoPath && typeof r.photoPath === 'string' && r.photoPath.length > 0) {
        s.add(r.photoPath);
      }
    }
    return s;
  } catch (e) {
    return new Set();
  }
}

/**
 * 弹一次拍照/相册选择（1张，官方压缩），选中后 saveFile 转成持久本地路径。
 * 注意：
 *  - 这里只做"选择 + 保存"，返回路径；调用方负责写回 MealRecord.photoPath
 *  - 不会在这里清理旧文件（因为调用方可能先拿到新路径再决定是否真正替换）
 */
export function chooseAndSaveOneMealPhoto(cb: (res: PickAndSaveResult) => void): void {
  if (!cb) return;
  if (!wx.chooseMedia) {
    // 极少数低版本 chooseMedia 不存在 -> 降级提示
    cb({ ok: false, msg: '当前微信版本不支持拍照，请升级微信后再试' });
    return;
  }
  wx.chooseMedia({
    count: 1,
    mediaType: ['image'],
    sourceType: ['album', 'camera'],
    sizeType: ['compressed'],
    camera: 'back',
    success: (res) => {
      try {
        const tempFiles = res && res.tempFiles;
        if (!tempFiles || !Array.isArray(tempFiles) || tempFiles.length === 0) {
          cb({ ok: false, canceled: true, msg: '' });
          return;
        }
        const first = tempFiles[0];
        const tmpPath: string = first && typeof first.tempFilePath === 'string' ? first.tempFilePath : '';
        if (!tmpPath) {
          cb({ ok: false, msg: '选择图片失败，请重试' });
          return;
        }
        // 保存成持久用户文件（跨关闭仍然存在）
        wx.saveFile({
          tempFilePath: tmpPath,
          success: (savedRes) => {
            const saved: string = savedRes && typeof savedRes.savedFilePath === 'string' ? savedRes.savedFilePath : '';
            if (!saved) {
              cb({ ok: false, msg: '图片保存失败，请重试' });
              return;
            }
            cb({ ok: true, savedFilePath: saved });
          },
          fail: () => {
            cb({ ok: false, msg: '图片保存失败，请检查微信存储空间是否充足' });
          }
        });
      } catch (e) {
        cb({ ok: false, msg: '处理图片时出错，请重试' });
      }
    },
    fail: (err) => {
      // 用户取消：errMsg 一般以 "chooseMedia:fail cancel" / "chooseMedia:fail user cancel" 结尾
      const msgStr: string = err && typeof err.errMsg === 'string' ? err.errMsg : '';
      if (/cancel/i.test(msgStr)) {
        cb({ ok: false, canceled: true, msg: '' });
        return;
      }
      // 权限拒绝：auth deny / permission
      if (/deny|permission|auth/i.test(msgStr)) {
        cb({ ok: false, msg: '无法访问相机或相册，请检查微信权限设置。' });
        return;
      }
      cb({ ok: false, canceled: false, msg: '选择图片失败，请重试。' });
    }
  });
}

/** 尝试删除单个本地文件，失败静默（不会影响新数据保存）。 */
export function deletePhotoFile(filePath?: string): boolean {
  if (!filePath || typeof filePath !== 'string' || filePath.length === 0) return false;
  try {
    let removed = false;
    wx.removeSavedFile({
      filePath,
      success: () => { removed = true; },
      fail: () => { /* swallow */ }
    });
    return removed;
  } catch (e) {
    return false;
  }
}

/**
 * 垃圾回收：
 *  取出微信本地用户文件列表 -> 只保留 meal_records.photoPath 集合中的路径；
 *  不在集合里的文件：尝试 removeSavedFile；失败静默（绝对不抛错）。
 *  调用时机：替换照片成功后、删除照片（确认后）都跑一次。
 */
export function gcUnusedPhotoFiles(): void {
  try {
    if (!wx.getSavedFileList) return;
    wx.getSavedFileList({
      success: (res) => {
        try {
          const inUse = getMealPhotoPathsInUse();
          const list = res && Array.isArray(res.fileList) ? res.fileList : [];
          for (const f of list) {
            if (!f || !f.filePath) continue;
            if (inUse.has(f.filePath)) continue;
            // 只清理"看起来是保存过的用户文件"（一般以 http://tmp 或 wxfile:// 开头；http 开头的是临时路径，不会出现在这里，保险 anyway）
            try {
              wx.removeSavedFile({ filePath: f.filePath });
            } catch (inner) { /* ignore */ }
          }
        } catch (e) { /* ignore */ }
      },
      fail: () => { /* ignore */ }
    });
  } catch (e) { /* ignore */ }
}

/**
 * 更新某条 MealRecord 的 photoPath = newValue 并回写 Storage。
 * 调用方建议在更新后再触发 gcUnusedPhotoFiles 回收孤文件。
 */
export function updateMealPhotoPath(recordId: string, newValue: string | undefined): MealRecord | null {
  const list = loadMealRecords();
  const idx = list.findIndex(r => r.id === recordId);
  if (idx === -1) return null;
  const now = new Date();
  void now;
  list[idx] = {
    ...list[idx],
    photoPath: newValue && newValue.length > 0 ? newValue : undefined,
    updatedAt: (() => {
      const pad = (n: number) => String(n).padStart(2, '0');
      const d = new Date();
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    })(),
  };
  saveMealRecords(list);
  return list[idx];
}
