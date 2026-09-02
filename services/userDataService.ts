// 正式环境用户数据重置：清除本机 Storage 与小程序保存的用户文件。
//
// 注意：
// - 本服务不删除代码包内 assets，也不调用任何业务写入接口。
// - 当前饮食照片通过 wx.saveFile 保存，因此属于 getSavedFileList 返回的用户文件。
// - 云端已提交的反馈不属于本机资料，本服务不会删除云端数据。

export interface DeleteAllLocalUserDataResult {
  ok: boolean;
  clearedStorageKeys: number;
  deletedSavedFiles: number;
  failedSavedFiles: number;
  message?: string;
}

interface SavedFileCleanupResult {
  deleted: number;
  failed: number;
}

function clearSavedUserFiles(done: (result: SavedFileCleanupResult) => void): void {
  if (!wx.getSavedFileList || !wx.removeSavedFile) {
    done({ deleted: 0, failed: 0 });
    return;
  }

  try {
    wx.getSavedFileList({
      success: (res) => {
        const filePaths = (res.fileList || [])
          .map(item => item && typeof item.filePath === 'string' ? item.filePath : '')
          .filter(path => path.length > 0);

        if (filePaths.length === 0) {
          done({ deleted: 0, failed: 0 });
          return;
        }

        let pending = filePaths.length;
        let deleted = 0;
        let failed = 0;
        const finishOne = () => {
          pending -= 1;
          if (pending === 0) done({ deleted, failed });
        };

        filePaths.forEach((filePath) => {
          try {
            wx.removeSavedFile({
              filePath,
              success: () => { deleted += 1; },
              fail: () => { failed += 1; },
              complete: finishOne,
            });
          } catch {
            failed += 1;
            finishOne();
          }
        });
      },
      fail: () => {
        // 无法读取文件列表时仍允许清除 Storage，并把一次文件清理失败记入结果。
        done({ deleted: 0, failed: 1 });
      },
    });
  } catch {
    done({ deleted: 0, failed: 1 });
  }
}

/**
 * 删除此设备上属于「小步轻」的全部本地资料。
 *
 * 文件清理完成后才清空 Storage，避免仍有业务记录时失去照片路径。
 * Storage 清理成功即完成重置；个别孤立文件清理失败会在结果中报告，
 * 但不会阻止用户回到首次引导。
 */
export function deleteAllLocalUserData(
  done: (result: DeleteAllLocalUserDataResult) => void,
): void {
  let storageKeyCount = 0;
  try {
    storageKeyCount = (wx.getStorageInfoSync().keys || []).length;
  } catch {
    storageKeyCount = 0;
  }

  clearSavedUserFiles((fileResult) => {
    try {
      const wxApi = wx as any;
      if (typeof wxApi.clearStorageSync === 'function') {
        wxApi.clearStorageSync();
      } else {
        // 极低基础库兜底：逐项删除，效果与 clearStorageSync 一致。
        const keys = wx.getStorageInfoSync().keys || [];
        keys.forEach((key) => wx.removeStorageSync(key));
      }
      done({
        ok: true,
        clearedStorageKeys: storageKeyCount,
        deletedSavedFiles: fileResult.deleted,
        failedSavedFiles: fileResult.failed,
      });
    } catch (error) {
      done({
        ok: false,
        clearedStorageKeys: 0,
        deletedSavedFiles: fileResult.deleted,
        failedSavedFiles: fileResult.failed,
        message: error instanceof Error ? error.message : 'clear-storage-failed',
      });
    }
  });
}
