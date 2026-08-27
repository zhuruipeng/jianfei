// pages/feedback/feedback.ts - 用户反馈（V11 云端提交）
// 流程：用户填写 → isSubmitting 保护 → 调云函数 submitFeedback → 成功提示 / 失败入 pending 队列
// 进入页面时若存在 pending，展示「重新提交」入口（用户主动重试，不自动请求）
// onShareAppMessage 用 function 形式，避免对象字面量 shorthand 在某些 TS 编译器下的语法歧义
import {
  FeedbackRating,
  FEEDBACK_CONTENT_MAX,
  FEEDBACK_RATING_LABEL,
  UI_MSG,
  FEEDBACK_MSG,
  PendingFeedback,
} from '../../types/index';
import * as feedbackService from '../../services/feedbackService';

interface PendingItemView {
  id: string;
  rating: FeedbackRating;
  ratingLabel: string;
  content?: string;
  createdAtShort: string;   // 展示用 yyyy-MM-dd HH:mm
}

interface FeedbackPageData {
  rating: FeedbackRating | '';    // 空字符串表示未选择
  content: string;
  contentCount: number;
  contentMax: number;
  canSubmit: boolean;
  isSubmitting: boolean;          // V11：提交中锁，防重复点击
  submitBtnText: string;          // V11：按钮文案（提交反馈 / 正在提交...）
  ratingOptions: Array<{
    key: FeedbackRating;
    label: string;
  }>;
  // V11：待重试入口
  pendingVisible: boolean;
  pendingHint: string;
  pendingItems: PendingItemView[];
}

function toShortTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${hh}:${mm}`;
  } catch { return ''; }
}

function buildPendingViews(list: PendingFeedback[]): PendingItemView[] {
  return list.map((x) => ({
    id: x.id,
    rating: x.rating,
    ratingLabel: FEEDBACK_RATING_LABEL[x.rating] || x.rating,
    content: typeof x.content === 'string' ? x.content : '',
    createdAtShort: toShortTime(x.createdAt),
  }));
}

Page<FeedbackPageData, WechatMiniprogram.Page.CustomOption>({
  data: {
    rating: '',
    content: '',
    contentCount: 0,
    contentMax: FEEDBACK_CONTENT_MAX,
    canSubmit: false,
    isSubmitting: false,
    submitBtnText: '提交反馈',
    ratingOptions: [
      { key: 'good',      label: FEEDBACK_RATING_LABEL.good },
      { key: 'okay',      label: FEEDBACK_RATING_LABEL.okay },
      { key: 'difficult', label: FEEDBACK_RATING_LABEL.difficult },
    ],
    pendingVisible: false,
    pendingHint: '',
    pendingItems: [],
  } as FeedbackPageData,

  // onShareAppMessage 必须是普通方法，不能写 ?() 否则 TS 报 "An object member cannot be declared optional"
  onShareAppMessage: function () { return { title: '轻步' }; },

  onLoad() {
    this._refreshPending();
  },

  onShow() {
    // 从其他页面切回时也刷新 pending（用户可能在别处清了缓存）
    this._refreshPending();
  },

  _refreshPending() {
    const list = feedbackService.loadPendingFeedback();
    const views = buildPendingViews(list);
    this.setData({
      pendingVisible: views.length > 0,
      pendingHint: views.length > 0
        ? `你有${views.length}条反馈还没有成功提交。`
        : '',
      pendingItems: views,
    });
  },

  _refreshCanSubmit() {
    const d = this.data || {} as FeedbackPageData;
    // 提交中时强制不可提交（防止 canSubmit 旧值导致重复点击）
    if (d.isSubmitting) {
      if (d.canSubmit) this.setData({ canSubmit: false });
      return;
    }
    const canSubmit = d.rating === 'good' || d.rating === 'okay' || d.rating === 'difficult';
    if (canSubmit !== d.canSubmit) {
      this.setData({ canSubmit });
    }
  },

  onClickSelectRating(e: any) {
    const d = this.data || {} as FeedbackPageData;
    if (d.isSubmitting) return;
    const key = e && e.currentTarget && e.currentTarget.dataset.key as any;
    if (key !== 'good' && key !== 'okay' && key !== 'difficult') return;
    this.setData({ rating: key }, () => this._refreshCanSubmit());
  },

  onInputContent(e: any) {
    const d = this.data || {} as FeedbackPageData;
    if (d.isSubmitting) return;
    const raw: string = (e && e.detail && typeof e.detail.value === 'string') ? e.detail.value : '';
    // 强制上限 FEEDBACK_CONTENT_MAX
    let next: string = raw;
    if (next.length > FEEDBACK_CONTENT_MAX) {
      next = next.slice(0, FEEDBACK_CONTENT_MAX);
    }
    const contentCount = Array.from(next).length;
    this.setData({ content: next, contentCount }, () => this._refreshCanSubmit());
  },

  onClickSubmit() {
    const d = this.data || {} as FeedbackPageData;
    // V11：提交中锁，防重复点击
    if (d.isSubmitting) return;
    const rating: FeedbackRating | '' = d.rating;
    if (rating !== 'good' && rating !== 'okay' && rating !== 'difficult') {
      wx.showToast({ title: '先选一下今天用起来怎么样', icon: 'none' });
      return;
    }
    const content: string | undefined =
      typeof d.content === 'string' && d.content.trim().length > 0
        ? d.content.trim().slice(0, FEEDBACK_CONTENT_MAX)
        : undefined;

    // 锁定按钮
    this.setData({
      isSubmitting: true,
      canSubmit: false,
      submitBtnText: FEEDBACK_MSG.SUBMITTING,
    });

    feedbackService.submitFeedbackToCloud(
      { rating, content },
      (res) => {
        // 解锁按钮
        this.setData({
          isSubmitting: false,
          submitBtnText: '提交反馈',
        });

        if (res.success) {
          // 成功：温和感谢 + 返回上一页
          wx.showToast({
            title: res.message || FEEDBACK_MSG.SUCCESS,
            icon: 'none',
            duration: 1800,
          });
          const page = this;
          setTimeout(() => {
            try { wx.navigateBack({ fail() { /* ignore */ } }); } catch { /* ignore */ }
            void page;
          }, 1650);
          return;
        }

        // 失败
        if (res.pending) {
          // 已写入 pending：刷新入口，温和提示
          this._refreshPending();
          wx.showToast({
            title: res.message || FEEDBACK_MSG.FAIL,
            icon: 'none',
            duration: 2000,
          });
          // 清空当前表单，避免用户误以为已提交
          this.setData({
            rating: '',
            content: '',
            contentCount: 0,
          }, () => this._refreshCanSubmit());
          return;
        }

        // invalid / 其他失败：温和提示，不清空表单（用户可能要改）
        wx.showToast({
          title: res.message || UI_MSG.STORAGE_SAVE_FAIL,
          icon: 'none',
          duration: 1800,
        });
        this._refreshCanSubmit();
      }
    );
  },

  // V11：重试 pending 队列里某条反馈
  onClickRetryPending(e: any) {
    const id: string = (e && e.currentTarget && e.currentTarget.dataset.id) || '';
    if (!id) return;
    const d = this.data || {} as FeedbackPageData;
    if (d.isSubmitting) return;

    this.setData({
      isSubmitting: true,
      submitBtnText: '正在重新提交...',
    });

    feedbackService.retryPendingFeedback(id, (res) => {
      this.setData({
        isSubmitting: false,
        submitBtnText: '提交反馈',
      });
      this._refreshPending();

      if (res.success) {
        wx.showToast({
          title: res.message || FEEDBACK_MSG.RETRY_OK,
          icon: 'none',
          duration: 1600,
        });
        return;
      }
      wx.showToast({
        title: res.message || FEEDBACK_MSG.FAIL,
        icon: 'none',
        duration: 1800,
      });
    });
  },
});
