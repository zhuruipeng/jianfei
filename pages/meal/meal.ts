// pages/meal/meal.ts - V8：接入 AI 饮食分析 V1（结构化定性卡片 + 重新分析二次确认 + dirty 提示 + 换图强清分析）
// V8 新增：
//   - 顶部「快速记录」4 个一键饱腹（和 selectSatiety 共用同一逻辑）
//   - 保存成功后短 Toast ✓记录好了 → 立即 navigateBack 回首页（首页 onShow 自动刷新）
//   - 错误提示统一（不透出 request:fail/500 给用户）
import {
  AiStatus,
  MealAnalysis,
  MealRecord,
  MealType,
  SatietyLevel,
  MealTagKey,
  MEAL_TYPE_LABEL,
  SATIETY_LABEL,
  SATIETY_ORDER,
  MEAL_TAG_LIST,
  STORAGE_KEY_AI_UPLOAD_CONSENT,
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
import {
  uploadMealPhotoToCloud,
  tryDeleteCloudFileBestEffort,
  callAnalyzeMeal,
  CloudUploadResult,
  CallAnalyzeResult,
} from '../../utils/cloud';
import * as uiStrings from '../../services/uiStrings';
import {
  trackMealCreated,
  trackMealUpdated,
  trackMealPhotoAdded,
  trackAiStarted,
  trackAiSucceeded,
  trackAiFailed,
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
  selected: boolean;
}

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

  // ===== V6/V7：AI 分析 =====
  existingCloudImageId: string;       // 加载时 MealRecord 里原始 cloudImageId；用于 avoid re-upload + 换图清关联
  originalPhotoPath: string;          // 加载时 MealRecord 里原始 photoPath；替换照片时用来判断 cloud 关联是否需要清空
  aiStatus: AiStatus | '';            // '' = 没状态（兼容旧记录 = none）
  isUploading: boolean;               // 正在上传/调用中，锁按钮防止重复提交
  aiHint: string;                     // 给用户的短提示（成功/失败/不可用说明）
  // V7 新增
  aiAnalysis?: MealAnalysis;          // 已完成时的结构化分析结果（否则 undefined）
  recordDirtyAfterAi: boolean;        // AI 分析完成后，用户改过文字/饱腹/标签 → true，显示"记录已修改可重新分析"
  veggieCN: string;                   // 蔬菜中文
  proteinCN: string;                  // 蛋白质中文
  stapleCN: string;                   // 主食中文
}

/** 把合法 AiStatus 归一化（undefined/'' → 'none'） */
function normalizeAiStatus(s: AiStatus | '' | undefined): AiStatus {
  if (!s) return 'none';
  if (s === 'none' || s === 'uploaded' || s === 'analyzing' || s === 'completed' || s === 'failed') return s;
  return 'none';
}

function portionLevelCN(p: string | undefined): string {
  if (p === 'light') return '偏少';
  if (p === 'appropriate') return '✅ 合适';
  if (p === 'heavy') return '偏多';
  return '暂时无法判断';
}
function veggieCN(v: string | undefined): string {
  if (v === 'low') return '偏少';
  if (v === 'adequate') return '基本足够';
  return '暂时无法判断';
}
function proteinCN(v: string | undefined): string {
  if (v === 'low') return '偏少';
  if (v === 'adequate') return '基本足够';
  return '暂时无法判断';
}
function stapleCN(v: string | undefined): string {
  if (v === 'low') return '偏少';
  if (v === 'adequate') return '基本合适';
  if (v === 'high') return '偏多';
  return '暂时无法判断';
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
    tagOptions: MEAL_TAG_LIST.map(t => ({
      key: t.key, label: t.label, emoji: t.emoji, selected: false
    })),
    photoPath: '',
    photoError: false,
    existingCloudImageId: '',
    originalPhotoPath: '',
    aiStatus: '',
    isUploading: false,
    aiHint: '',
    aiAnalysis: undefined,
    recordDirtyAfterAi: false,
    veggieCN: '暂时无法判断',
    proteinCN: '暂时无法判断',
    stapleCN: '暂时无法判断',
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
    const aiStatusRaw: AiStatus | '' = existing && existing.aiStatus ? existing.aiStatus : '';
    const aiAnalysis: MealAnalysis | undefined = existing && existing.aiAnalysis ? existing.aiAnalysis : undefined;
    const defaultHint = cloudImageId && normalizeAiStatus(aiStatusRaw) === 'uploaded'
      ? '照片已在云端，可继续分析'
      : '';
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
      tagOptions: MEAL_TAG_LIST.map(t => ({
        key: t.key, label: t.label, emoji: t.emoji,
        selected: !!(existing && existing.tags && existing.tags.indexOf(t.key) !== -1)
      })),
      photoPath,
      photoError: false,
      existingCloudImageId: cloudImageId,
      originalPhotoPath: photoPath,
      aiStatus: aiStatusRaw,
      isUploading: false,
      aiHint: normalizeAiStatus(aiStatusRaw) === 'failed' ? '上次分析未成功，可重新分析' : defaultHint,
      aiAnalysis,
      recordDirtyAfterAi: false,
      veggieCN: veggieCN(aiAnalysis && aiAnalysis.vegetables),
      proteinCN: proteinCN(aiAnalysis && aiAnalysis.protein),
      stapleCN: stapleCN(aiAnalysis && aiAnalysis.stapleFood),
    }, () => {
      if (satietyLevel) {
        this.selectSatiety({ currentTarget: { dataset: { level: satietyLevel } } });
      }
    });
  },

  /** 如果 AI 已经 completed，用户修改任何字段 → 标记 dirty（提示"重新分析"但不自动调用，省成本） */
  _markDirtyIfAiCompleted(): void {
    try {
      const d = this.data || {} as MealPageData;
      if (normalizeAiStatus(d.aiStatus) === 'completed') {
        this.setData({ recordDirtyAfterAi: true });
      }
    } catch (e) { /* ignore */ }
  },

  onInputFood(e: any) {
    this.setData({ foodText: (e && e.detail && typeof e.detail.value === 'string') ? e.detail.value : '' });
    this._markDirtyIfAiCompleted();
  },

  onInputNote(e: any) {
    this.setData({ note: (e && e.detail && typeof e.detail.value === 'string') ? e.detail.value : '' });
    this._markDirtyIfAiCompleted();
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
    this._markDirtyIfAiCompleted();
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
    this._markDirtyIfAiCompleted();
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
  /** 拍/选 -> 持久化 -> 更新本页 state 的 photoPath
   *  V7：换图必须清 aiAnalysis 并把 aiStatus 回 none，避免把旧图分析当成新图继续展示
   */
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
      // V7：换了新照片 → 清 AI 结果 & 状态；同步到 MealRecord
      try {
        if (hadPhotoBefore) {
          saveMeal(oldRecDate, oldMealType, { aiStatus: 'none', clearAiAnalysis: true });
        }
      } catch (e) { /* ignore */ }
      page.setData({
        photoPath: result.savedFilePath,
        photoError: false,
        existingCloudImageId: '',
        aiStatus: 'none',
        aiHint: '',
        aiAnalysis: undefined,
        recordDirtyAfterAi: false,
        veggieCN: '暂时无法判断',
        proteinCN: '暂时无法判断',
        stapleCN: '暂时无法判断',
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

  /** 删除本张照片（≠ 删除整餐记录）
   *  V7：删除照片也必须清旧分析结果（避免无图但还在显示 AI 卡）
   */
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
        // 同步清 MealRecord 里的 AI 分析结果（换过图就不继续保留旧分析）
        try { saveMeal(date, mealType, { aiStatus: 'none', clearAiAnalysis: true }); } catch (e) { /* ignore */ }
        page.setData({
          photoPath: '', photoError: false,
          existingCloudImageId: '',
          aiStatus: 'none',
          aiHint: '',
          aiAnalysis: undefined,
          recordDirtyAfterAi: false,
          veggieCN: '暂时无法判断',
          proteinCN: '暂时无法判断',
          stapleCN: '暂时无法判断',
        });
        if (oldPath) deletePhotoFile(oldPath);
        if (oldCloudImageId) tryDeleteCloudFileBestEffort(oldCloudImageId);
        try { gcUnusedPhotoFiles(); } catch (e) { /* ignore */ }
        wx.showToast({ title: '已删除照片', icon: 'success' });
      }
    });
  },

  /** 保存（或保存修改）—— 现在会把 photoPath 一起写回 MealRecord；
   *  V7：换图时清 cloud 关联 + 清 AI 分析；修改文字时不自动重新分析，保留 dirty 提示
   *  V8：保存成功 → 短 Toast「✓ 记录好了」(≈700ms) → 立即 navigateBack 回首页（首页 onShow 自动刷新餐次状态/完成度/积分）
   */
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
          aiStatus: '',
          isUploading: false,
          aiHint: '',
          aiAnalysis: undefined,
          recordDirtyAfterAi: false,
          veggieCN: '暂时无法判断',
          proteinCN: '暂时无法判断',
          stapleCN: '暂时无法判断',
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

  // ================== V6/V7：AI 分析入口 ==================
  /** 是否已同意"AI 分析时照片会上传云端"的首次说明（同意过=1） */
  _hasAiUploadConsent(): boolean {
    try {
      const v = wx.getStorageSync(STORAGE_KEY_AI_UPLOAD_CONSENT);
      return v === 1 || v === true;
    } catch (e) { return false; }
  },
  _setAiUploadConsent(): void {
    try { wx.setStorageSync(STORAGE_KEY_AI_UPLOAD_CONSENT, 1); } catch (e) { /* swallow */ }
  },

  /** 若 MealRecord 还没保存过（无 recordId），先静默保存一次，拿到 id/date 才能上传 */
  _ensureRecordSaved(): { ok: boolean; rec?: MealRecord } {
    const d = this.data || {} as MealPageData;
    if (d.recordId && d.recordId.length > 0) {
      const list = loadMealRecords();
      const rec = list.find(r => r.id === d.recordId);
      if (rec) return { ok: true, rec };
    }
    const photoPathVal = d.photoPath && d.photoPath.length > 0 && !d.photoError ? d.photoPath : undefined;
    const res = saveMeal(d.todayStr, d.mealType, {
      foodText: d.foodText,
      satietyLevel: this._getCurrentSatietyLevel(),
      tags: this._getCurrentTags(),
      note: d.note,
      photoPath: photoPathVal,
    });
    if (!res.ok) return { ok: false };
    this.setData({
      isEdit: true,
      hasRecord: true,
      recordId: res.record.id,
      photoPath: res.record.photoPath ? res.record.photoPath : '',
      originalPhotoPath: res.record.photoPath ? res.record.photoPath : '',
      existingCloudImageId: res.record.cloudImageId ? res.record.cloudImageId : '',
      aiStatus: res.record.aiStatus ? res.record.aiStatus : '',
      aiAnalysis: res.record.aiAnalysis,
    });
    return { ok: true, rec: res.record };
  },

  /** AI 首次使用提示 */
  _showAiFirstConsentModal(cb: (go: boolean) => void): void {
    try {
      wx.showModal({
        title: '关于 AI 分析',
        content: '为了分析这一餐，需要把这张饮食照片上传到云端。\n只会上传你主动选择分析的照片。',
        confirmText: '继续分析',
        cancelText: '取消',
        confirmColor: '#FF6B6B',
        success(r) { cb(!!r.confirm); },
        fail() { cb(false); },
      });
    } catch (e) { cb(false); }
  },

  /** 重新分析二次确认（避免误触消耗 AI 成本） */
  _askReAnalyzeConfirm(cb: (go: boolean) => void): void {
    try {
      wx.showModal({
        title: '重新分析',
        content: '重新分析会更新当前 AI 结果。\n确定继续吗？',
        confirmText: '继续',
        cancelText: '取消',
        confirmColor: '#FF6B6B',
        success(r) { cb(!!r.confirm); },
        fail() { cb(false); },
      });
    } catch (e) { cb(false); }
  },
  /**
   * 点击 ✨ AI看看这一餐
   * V7：
   *  - 首次 consent → 存 storage
   *  - 无 record → 先存 → 拿 id
   *  - photo 无变化 + 有 cloudImageId → 跳过上传 → 直接调用分析
   *  - 否则上传 → 再调用分析
   */
  onClickAnalyzeAi() {
    const page = this;
    const d = page.data || {} as MealPageData;
    if (!d.photoPath || d.photoError) {
      wx.showToast({ title: '先拍下一餐，才能使用AI分析', icon: 'none', duration: 2000 });
      return;
    }
    if (d.isUploading || normalizeAiStatus(d.aiStatus) === 'analyzing') return;
    const runAfterConsent = () => {
      const d2 = page.data || {} as MealPageData;
      if (d2.isUploading || normalizeAiStatus(d2.aiStatus) === 'analyzing') return;
      // V9：真正开始 AI 分析前 → 埋 ai_analysis_started（只带 mealType，不带照片/内容）
      try { trackAiStarted(d2.mealType); } catch { /* ignore */ }
      page.setData({ isUploading: true, aiStatus: 'analyzing', aiHint: '正在看看这一餐…' });
      const ensureRes = page._ensureRecordSaved();
      if (!ensureRes.ok || !ensureRes.rec) {
        page.setData({ isUploading: false, aiStatus: 'failed', aiHint: UI_MSG.STORAGE_SAVE_FAIL });
        wx.showToast({ title: UI_MSG.STORAGE_SAVE_FAIL, icon: 'none' });
        return;
      }
      const rec = ensureRes.rec;
      const curPhoto = (d2.photoPath && !d2.photoError) ? d2.photoPath : '';
      const canReuseCloud =
        !!rec.cloudImageId &&
        rec.photoPath === curPhoto &&
        normalizeAiStatus(rec.aiStatus) !== 'failed';
      if (canReuseCloud) {
        page._afterUploadReady(rec.id, rec.cloudImageId as string);
        return;
      }
      uploadMealPhotoToCloud(curPhoto, rec.date, rec.id, (upRes: CloudUploadResult) => {
        if (!upRes.ok) {
          const userMsg = upRes.offline === true ? UI_MSG.NETWORK : UI_MSG.AI_FAILED;
          try { saveMeal(rec.date, rec.mealType, { aiStatus: 'failed' }); } catch (e) { /* ignore */ }
          page.setData({
            isUploading: false,
            aiStatus: 'failed',
            aiHint: '',
          });
          try { trackAiFailed(rec.mealType, { phase: 'upload', offline: upRes.offline === true ? true : false }); } catch { /* ignore */ }
          wx.showModal({
            title: '暂时没分析成功',
            content: '饮食记录已经保存，\n可以稍后重新试试AI分析。',
            confirmText: '重新尝试',
            cancelText: '知道了',
            confirmColor: '#FF6B6B',
            success(rr) {
              if (rr.confirm) page.onClickAnalyzeAi();
            },
          });
          void userMsg;
          return;
        }
        const fileID: string = upRes.fileID as string;
        const save2 = saveMeal(rec.date, rec.mealType, {
          cloudImageId: fileID,
          cloudImageUrl: undefined,
          aiStatus: 'uploaded',
        });
        if (save2.ok) {
          page.setData({
            existingCloudImageId: fileID,
            aiStatus: 'uploaded',
          });
        }
        page._afterUploadReady(save2.ok ? save2.record.id : rec.id, fileID);
      });
    };

    if (this._hasAiUploadConsent()) {
      runAfterConsent();
    } else {
      this._showAiFirstConsentModal((go: boolean) => {
        if (!go) {
          // 用户取消 consent：把 analyzing 占位锁关掉
          const d3 = this.data || {} as MealPageData;
          if (d3.isUploading || normalizeAiStatus(d3.aiStatus) === 'analyzing') {
            this.setData({ isUploading: false, aiStatus: 'none', aiHint: '' });
          }
          return;
        }
        this._setAiUploadConsent();
        runAfterConsent();
      });
    }
  },

  /** 重新分析（有 AI 结果 + dirty 提示里都会显示这个按钮）
   *  - 二次确认后 → 清空旧 aiAnalysis → 走 onClickAnalyzeAi 完整流程
   */
  onClickReAnalyzeAi() {
    const page = this;
    const d = this.data || {} as MealPageData;
    if (d.isUploading || normalizeAiStatus(d.aiStatus) === 'analyzing') return;
    this._askReAnalyzeConfirm((go: boolean) => {
      if (!go) return;
      const d2 = page.data || {} as MealPageData;
      const date = d2.todayStr;
      const mt = d2.mealType;
      // 清分析（保留 cloudImageId 不删云图，省一次上传）
      try { saveMeal(date, mt, { aiStatus: 'uploaded', clearAiAnalysis: true }); } catch (e) { /* ignore */ }
      page.setData({
        aiAnalysis: undefined,
        recordDirtyAfterAi: false,
        veggieCN: '暂时无法判断',
        proteinCN: '暂时无法判断',
        stapleCN: '暂时无法判断',
      });
      page.onClickAnalyzeAi();
    });
  },

  /** 上传完成（或复用）后 → 调 analyzeMeal 云函数 → V7：
   *  status='ok' → 落 aiStatus=completed + 结构化卡片；
   *  status='not_implemented' → 旧占位（兼容未部署云函数）；
   *  其它失败 → 统一脱敏失败文案
   */
  _afterUploadReady(mealRecordId: string, cloudImageId: string) {
    const page = this;
    page.setData({ aiStatus: 'analyzing', aiHint: '正在看看这一餐…' });
    const d0 = page.data || {} as MealPageData;
    const curSat = page._getCurrentSatietyLevel();
    const curTags = page._getCurrentTags();
    callAnalyzeMeal(
      mealRecordId,
      cloudImageId,
      {
        mealType: d0.mealType,
        foodText: d0.foodText,
        satietyLevel: curSat,
        tags: curTags,
      },
      (ar: CallAnalyzeResult) => {
        const d = page.data || {} as MealPageData;
        // V7：成功 → 校验并落结构化分析
        if (ar.ok && ar.response && ar.response.status === 'ok' && ar.response.analysis) {
          const a = ar.response.analysis;
          const foodsOK = Array.isArray(a.foods) && a.foods.every((x: any) => typeof x === 'string');
          const portionOK = a.portionLevel === 'light' || a.portionLevel === 'appropriate' || a.portionLevel === 'heavy' || a.portionLevel === 'unknown';
          const vegOK = a.vegetables === 'low' || a.vegetables === 'adequate' || a.vegetables === 'unknown';
          const proOK = a.protein === 'low' || a.protein === 'adequate' || a.protein === 'unknown';
          const staOK = a.stapleFood === 'low' || a.stapleFood === 'adequate' || a.stapleFood === 'high' || a.stapleFood === 'unknown';
          const sugOK = a.sugaryDrink === 'yes' || a.sugaryDrink === 'no' || a.sugaryDrink === 'unknown';
          const confOK = a.confidence === 'low' || a.confidence === 'medium' || a.confidence === 'high';
          const summaryOK = typeof a.summary === 'string';
          const primOK = typeof a.primarySuggestion === 'string';
          const atOK = typeof a.analyzedAt === 'string';
          if (foodsOK && portionOK && vegOK && proOK && staOK && sugOK && confOK && summaryOK && primOK && atOK) {
            try {
              saveMeal(d.todayStr, d.mealType, { aiStatus: 'completed', aiAnalysis: a, clearAiAnalysis: false });
            } catch (e) { /* ignore */ }
            page.setData({
              isUploading: false,
              aiStatus: 'completed',
              aiHint: '',
              aiAnalysis: a,
              recordDirtyAfterAi: false,
              veggieCN: veggieCN(a.vegetables),
              proteinCN: proteinCN(a.protein),
              stapleCN: stapleCN(a.stapleFood),
            });
            // V9：AI 分析成功埋点（不存分析结果）
            try {
              const dur = (ar.response as any)?.duration;
              trackAiSucceeded(d.mealType, {
                durationMs: typeof dur === 'number' ? Math.max(0, Math.floor(dur)) : (typeof dur === 'string' ? parseInt(dur, 10) || 0 : 0),
              });
            } catch { /* ignore */ }
            wx.showToast({ title: '分析完成', icon: 'success', duration: 1200 });
            return;
          }
          // 校验没通过：当作失败（不写脏数据）
        }
        // 兼容旧版本云函数：not_implemented
        if (ar.ok && ar.response && ar.response.status === 'not_implemented') {
          try {
            saveMeal(d.todayStr, d.mealType, { aiStatus: 'uploaded' });
          } catch (e) { /* ignore */ }
          page.setData({
            isUploading: false,
            aiStatus: 'uploaded',
            aiHint: '✓ 照片已经准备好\nAI分析功能即将开放',
          });
          wx.showToast({ title: '照片已经准备好', icon: 'success', duration: 1800 });
          return;
        }
        // 失败：脱敏（永远统一文案，不暴露 Key / 堆栈 / 原始响应）
        try { saveMeal(d.todayStr, d.mealType, { aiStatus: 'failed' }); } catch (e) { /* ignore */ }
        page.setData({
          isUploading: false,
          aiStatus: 'failed',
          aiHint: '',
          aiAnalysis: undefined,
          veggieCN: '暂时无法判断',
          proteinCN: '暂时无法判断',
          stapleCN: '暂时无法判断',
        });
        // V9：AI 分析失败埋点（不存失败堆栈/原始内容）
        try { trackAiFailed(d.mealType, { phase: 'analyze' }); } catch { /* ignore */ }
        wx.showModal({
          title: '这次没有分析成功',
          content: '你的饮食记录和照片都已经保存，\n可以稍后重新试一次。',
          confirmText: '重新分析',
          cancelText: '知道了',
          confirmColor: '#FF6B6B',
          success(rr) {
            if (rr.confirm) page.onClickAnalyzeAi();
          },
        });
      }
    );
  },
});
// 未使用的局部导出占位（避免 tree-shake 警告）
void portionLevelCN;
