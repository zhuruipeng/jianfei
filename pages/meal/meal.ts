// pages/meal/meal.ts - 饮食记录与照片管理
// V8 新增：
//   - 顶部「快速记录」4 个一键饱腹（和 selectSatiety 共用同一逻辑）
//   - 保存成功后短 Toast ✓记录好了 → 立即 navigateBack 回首页（首页 onShow 自动刷新）
//   - 错误提示统一（不透出 request:fail/500 给用户）
import {
  MealRecord,
  MealType,
  SatietyLevel,
  MealTagKey,
  MEAL_TYPE_LABEL,
  SATIETY_LABEL,
  SATIETY_ORDER,
  MEAL_TAG_LIST,
  UI_MSG,
} from '../../types/index';
import {
  findMealRecord,
  loadMealRecords,
  saveMeal,
  migrateLegacyCompletedToMealRecords,
} from '../../utils/meal';
import { getTodayString } from '../../utils/date';
import { deleteMealRecordById } from '../../services/mealService';
import {
  chooseAndSaveOneMealPhoto,
  deletePhotoFile,
  gcUnusedPhotoFiles,
} from '../../utils/image';
import { tryDeleteCloudFileBestEffort } from '../../utils/cloud';
import * as uiStrings from '../../services/uiStrings';
import {
  trackMealCreated,
  trackMealUpdated,
  trackMealPhotoAdded,
  trackPerfMealSaveMs,
} from '../../services/usageService';

interface SatietyOption {
  level: SatietyLevel;
  label: string;
  emoji: string;
}
interface TagOption {
  key: MealTagKey;
  label: string;
  emoji: string;
  visualEmoji: string;
  selected: boolean;
}

const TAG_VISUAL_EMOJIS = ['🥬', '🥚', '🍚', '🥣', '🍎', '🍪', '🧂', '🍳', '🥡'];

interface MealPageData {
  mealType: MealType;
  pageTitle: string;                  // "记录早餐"
  todayStr: string;
  isEdit: boolean;                    // 已有记录 -> 保存修改；否则 -> 保存
  recordId: string;                   // 已有记录的 id（删除用）
  hasRecord: boolean;                 // 是否已有记录
  foodText: string;                   // 双向绑定：吃了什么
  note: string;                       // 双向绑定：备注
  satietyOptions: SatietyOption[];    // 4 个饱腹选项
  tagOptions: TagOption[];            // 6 个标签

  // ===== 照片 =====
  photoPath: string;                  // 已持久化本地路径；空串 = 没有
  photoError: boolean;                // binderror 标记，显示"照片暂时无法显示"

  // 仅用于清理旧版本曾上传的照片关联；当前版本不再上传或分析。
  existingCloudImageId: string;
  originalPhotoPath: string;
}

Page<MealPageData>({
  data: {
    mealType: 'breakfast',
    pageTitle: '记录早餐',
    todayStr: '',
    isEdit: false,
    recordId: '',
    hasRecord: false,
    foodText: '',
    note: '',
    satietyOptions: SATIETY_ORDER.map(level => ({
      level, label: SATIETY_LABEL[level], emoji: '🟟'
    })),
    tagOptions: MEAL_TAG_LIST.map((t, index) => ({
      key: t.key, label: t.label, emoji: t.emoji,
      visualEmoji: TAG_VISUAL_EMOJIS[index] || '🍽️', selected: false
    })),
    photoPath: '',
    photoError: false,
    existingCloudImageId: '',
    originalPhotoPath: '',
  } as MealPageData,

  onLoad(options: { meal?: string; date?: string }) {
    const mealStr: any = options && options.meal;
    let mealType: MealType = 'breakfast';
    if (mealStr === 'breakfast' || mealStr === 'lunch' || mealStr === 'dinner') {
      mealType = mealStr;
    }
    const today = (options && options.date) || getTodayString();
    const title = `记录${MEAL_TYPE_LABEL[mealType]}`;
    wx.setNavigationBarTitle({ title });
    migrateLegacyCompletedToMealRecords(today);
    const list = loadMealRecords();
    const existing = findMealRecord(list, today, mealType);
    const satietyLevel: SatietyLevel | undefined = existing && existing.satietyLevel;
    const photoPath: string = existing && existing.photoPath ? existing.photoPath : '';
    const cloudImageId: string = existing && existing.cloudImageId ? existing.cloudImageId : '';
    this.setData({
      mealType,
      pageTitle: title,
      todayStr: today,
      isEdit: !!existing,
      hasRecord: !!existing,
      recordId: existing ? existing.id : '',
      foodText: existing && existing.foodText ? existing.foodText : '',
      note: existing && existing.note ? existing.note : '',
      satietyOptions: SATIETY_ORDER.map(level => ({
        level, label: SATIETY_LABEL[level], emoji: '🟟'
      })),
      tagOptions: MEAL_TAG_LIST.map((t, index) => ({
        key: t.key, label: t.label, emoji: t.emoji,
        visualEmoji: TAG_VISUAL_EMOJIS[index] || '🍽️',
        selected: !!(existing && existing.tags && existing.tags.indexOf(t.key) !== -1)
      })),
      photoPath,
      photoError: false,
      existingCloudImageId: cloudImageId,
      originalPhotoPath: photoPath,
    }, () => {
      if (satietyLevel) {
        this.selectSatiety({ currentTarget: { dataset: { level: satietyLevel } } });
      }
    });
  },

  onInputFood(e: any) {
    this.setData({ foodText: (e && e.detail && typeof e.detail.value === 'string') ? e.detail.value : '' });
  },

  onInputNote(e: any) {
    this.setData({ note: (e && e.detail && typeof e.detail.value === 'string') ? e.detail.value : '' });
  },

  /** 点击某个饱腹选项 */
  selectSatiety(e: any) {
    const level: SatietyLevel | undefined = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.level;
    const raw = this.data || {} as MealPageData;
    const currentOpts = raw.satietyOptions || [];
    let newOpts: SatietyOption[];
    const newLevel: SatietyLevel | undefined =
      (level === 'seven_tenths' || level === 'just_right' || level === 'a_little_full' || level === 'overfull')
        ? level : undefined;
    if (!newLevel) {
      newOpts = currentOpts.map(o => ({ ...o, emoji: '🟟' }));
    } else {
      const currentSelected = currentOpts.find(o => o.emoji !== '🟟');
      if (currentSelected && currentSelected.level === newLevel) {
        newOpts = currentOpts.map(o => ({ ...o, emoji: '🟟' }));
      } else {
        newOpts = currentOpts.map(o => ({
          ...o,
          emoji: o.level === newLevel ? '✅' : '🟟'
        }));
      }
    }
    this.setData({ satietyOptions: newOpts });
  },

  /** 点击某个标签（toggle） */
  toggleTag(e: any) {
    const key: MealTagKey | undefined = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key;
    if (!key) return;
    const raw = this.data || {} as MealPageData;
    const opts = (raw.tagOptions || []).slice();
    const idx = opts.findIndex(o => o.key === key);
    if (idx === -1) return;
    opts[idx] = { ...opts[idx], selected: !opts[idx].selected };
    this.setData({ tagOptions: opts });
  },

  _getCurrentSatietyLevel(): SatietyLevel | undefined {
    const raw = this.data || {} as MealPageData;
    const sel = (raw.satietyOptions || []).find(o => o.emoji !== '🟟');
    return sel ? sel.level : undefined;
  },
  _getCurrentTags(): MealTagKey[] {
    const raw = this.data || {} as MealPageData;
    return (raw.tagOptions || []).filter(o => o.selected).map(o => o.key);
  },

  // ================== 照片：选择 / 替换 / 删除 ==================
  /** 拍/选 -> 持久化 -> 更新本页 state 的 photoPath。 */
  onClickPickPhoto() {
    const page = this;
    const d0 = page.data || {} as MealPageData;
    const oldCloudImageId = d0.existingCloudImageId;
    const oldRecDate = d0.todayStr;
    const oldMealType = d0.mealType;
    const hadPhotoBefore = !!(d0.photoPath && d0.photoPath.length > 0);
    chooseAndSaveOneMealPhoto((result) => {
      if (!result) return;
      if (result.canceled) {
        return;
      }
      if (!result.ok || !result.savedFilePath) {
        const msg = result.msg && result.msg.length > 0 ? result.msg : '选择图片失败';
        wx.showToast({ title: msg, icon: 'none' });
        return;
      }
      // 换图时清理旧版本遗留的云端和分析关联。
      try {
        if (hadPhotoBefore) {
          saveMeal(oldRecDate, oldMealType, { aiStatus: 'none', clearAiAnalysis: true });
        }
      } catch (e) { /* ignore */ }
      page.setData({
        photoPath: result.savedFilePath,
        photoError: false,
        existingCloudImageId: '',
      });
      // V9-fix3：meal_photo_added 不再在拍照瞬间记，改为保存成功时才记（避免拍 10 次不保存产生脏数据）
      if (oldCloudImageId && typeof oldCloudImageId === 'string' && oldCloudImageId.length > 0) {
        tryDeleteCloudFileBestEffort(oldCloudImageId);
      }
      wx.showToast({ title: '已选择照片，记得点保存哦', icon: 'none', duration: 1600 });
    });
  },

  /** 图片加载失败 -> 显示「照片暂时无法显示」占位，不崩 */
  onPhotoError() {
    const d = this.data || {} as MealPageData;
    if (d.photoError) return;
    this.setData({ photoError: true });
  },

  /** 点击已存在的大图预览（点开可双指缩放/关闭） */
  onClickPreviewPhoto() {
    const d = this.data || {} as MealPageData;
    if (!d.photoPath || d.photoError) return;
    try {
      if (wx.previewImage) {
        wx.previewImage({ current: d.photoPath, urls: [d.photoPath] });
      }
    } catch (e) { /* ignore */ }
  },

  /** 删除本张照片（≠ 删除整餐记录）。 */
  onClickDeletePhoto() {
    const page = this;
    const d = page.data || {} as MealPageData;
    if (!d.photoPath) return;
    const oldPath = d.photoPath;
    const oldCloudImageId = d.existingCloudImageId;
    const date = d.todayStr;
    const mealType = d.mealType;
    wx.showModal({
      title: '删除照片',
      content: '确定删除这张饮食照片吗？\n\n（只删照片，其他内容继续保留）',
      confirmColor: '#D04343',
      confirmText: '删除',
      cancelText: '取消',
      success(rr: { confirm: boolean }) {
        if (!rr.confirm) return;
        // 同步清理旧版本遗留的云端和分析关联。
        try { saveMeal(date, mealType, { aiStatus: 'none', clearAiAnalysis: true }); } catch (e) { /* ignore */ }
        page.setData({
          photoPath: '', photoError: false,
          existingCloudImageId: '',
        });
        if (oldPath) deletePhotoFile(oldPath);
        if (oldCloudImageId) tryDeleteCloudFileBestEffort(oldCloudImageId);
        try { gcUnusedPhotoFiles(); } catch (e) { /* ignore */ }
        wx.showToast({ title: '已删除照片', icon: 'success' });
      }
    });
  },

  /** 保存（或保存修改），并把 photoPath 一起写回 MealRecord。 */
  onClickSave() {
    const perfT0 = Date.now();
    const d = this.data || {} as MealPageData;
    const photoPathVal: string | undefined = d.photoPath && d.photoPath.length > 0 && !d.photoError ? d.photoPath : undefined;
    const photoChanged = d.photoPath !== d.originalPhotoPath;
    const clearCloudAiRefs = photoChanged;
    const clearAiAnalysis = photoChanged;
    const satietyLevel = this._getCurrentSatietyLevel();
    let result: { ok: boolean; action?: 'created' | 'updated'; record?: MealRecord } | null = null;
    try {
      result = saveMeal(d.todayStr, d.mealType, {
        foodText: d.foodText,
        satietyLevel,
        tags: this._getCurrentTags(),
        note: d.note,
        photoPath: photoPathVal,
        clearCloudAiRefs,
        clearAiAnalysis,
      });
    } catch (e) {
      wx.showToast({ title: uiStrings.toUserFriendlyError(e, UI_MSG.STORAGE_SAVE_FAIL), icon: 'none' });
      return;
    }
    if (!result || !result.ok) {
      wx.showToast({ title: UI_MSG.STORAGE_SAVE_FAIL, icon: 'none' });
      return;
    }

    // V9：最小行为统计（不记录食物内容/照片/备注，只记录餐类+有无照片+饱腹程度）
    try {
      const hasPhoto = !!(photoPathVal && photoPathVal.length > 0);
      if (result.action === 'created') {
        trackMealCreated(d.mealType, hasPhoto, satietyLevel);
        // V9-fix3：首次创建且带照片 → 记 meal_photo_added（只在保存成功时记，避免拍照不保存产生脏数据）
        if (hasPhoto) {
          trackMealPhotoAdded(d.mealType);
        }
      } else if (result.action === 'updated') {
        trackMealUpdated(d.mealType, hasPhoto, satietyLevel);
        // V9-fix3：更新时从无照片变为有照片 → 记 meal_photo_added（已有照片更新不重复记）
        if (hasPhoto && photoChanged) {
          trackMealPhotoAdded(d.mealType);
        }
      }
      const saveMs = Math.max(0, Date.now() - perfT0);
      trackPerfMealSaveMs(saveMs, d.mealType);
    } catch { /* ignore */ }

    try { gcUnusedPhotoFiles(); } catch (e) { /* ignore */ }

    // V8：保存成功的短反馈，然后返回首页（首页 onShow 会立即重新计算最新数据：完成度/餐次状态/积分/奖励进度）
    const page = this;
    wx.showToast({ title: '✓ 记录好了', icon: 'none', duration: 700 });
    setTimeout(() => {
      wx.navigateBack({
        fail() {
          // navigateBack 失败（比如直接被分享链接打开）→ switchTab 回今日首页
          try { wx.switchTab({ url: '/pages/index/index' }); } catch { /* ignore */ }
        }
      });
      void page;
    }, 650);
  },

  /** 删除本次记录（二次确认）—— 同时触发孤文件 gc + 尽力清理云文件 */
  onClickDelete() {
    const d = this.data || {} as MealPageData;
    if (!d.hasRecord || !d.recordId) return;
    const mealLabel = MEAL_TYPE_LABEL[d.mealType];
    let dateCn: string = d.todayStr;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.todayStr);
    if (m) {
      dateCn = `${parseInt(m[2], 10)}月${parseInt(m[3], 10)}日`;
    }
    const oldCloudImageId = d.existingCloudImageId;
    wx.showModal({
      title: '删除记录',
      content: `确定删除${dateCn}的${mealLabel}记录吗？`,
      confirmColor: '#D04343',
      confirmText: '删除',
      cancelText: '取消',
      success: (r) => {
        if (!r.confirm) return;
        let res: { ok: boolean; deletePhotoFailed: boolean; recordDeleted: boolean };
        try {
          res = deleteMealRecordById(d.recordId);
        } catch (e) {
          uiStrings.toastSafe(uiStrings.toUserFriendlyError(e, UI_MSG.STORAGE_SAVE_FAIL));
          return;
        }
        if (!res || !res.recordDeleted) {
          uiStrings.toastSafe(UI_MSG.STORAGE_SAVE_FAIL);
          return;
        }
        try { gcUnusedPhotoFiles(); } catch (e) { /* ignore */ }
        if (oldCloudImageId) tryDeleteCloudFileBestEffort(oldCloudImageId);
        const tagOptions = (d.tagOptions || []).map(t => ({ ...t, selected: false }));
        const satietyOptions = SATIETY_ORDER.map(level => ({
          level, label: SATIETY_LABEL[level], emoji: '🟟'
        }));
        this.setData({
          isEdit: false,
          hasRecord: false,
          recordId: '',
          foodText: '',
          note: '',
          satietyOptions,
          tagOptions,
          photoPath: '',
          photoError: false,
          existingCloudImageId: '',
          originalPhotoPath: '',
        });
        // 删除整顿饭：图片清理失败不阻止用户（只做弱提示）
        if (res.deletePhotoFailed) {
          wx.showToast({ title: '记录已删除，旧照片稍后会自动清理', icon: 'none', duration: 1200 });
        } else {
          wx.showToast({ title: '已删除', icon: 'none', duration: 800 });
        }
      }
    });
  },

});
