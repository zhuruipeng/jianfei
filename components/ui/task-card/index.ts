Component({
  properties: {
    taskId: { type: String, value: '' },
    iconSrc: { type: String, value: '' },
    iconEmoji: { type: String, value: '' },
    title: { type: String, value: '' },
    subtitle: { type: String, value: '' },
    status: { type: String, value: 'pending' },
    indicator: { type: String, value: 'check' },
    progress: { type: Number, value: 0 },
    progressMax: { type: Number, value: 0 },
    progressText: { type: String, value: '' },
    footerText: { type: String, value: '' },
    disabled: { type: Boolean, value: false },
  },

  data: {
    ringPercent: 0,
  },

  observers: {
    'progress, progressMax'(progress: number, progressMax: number) {
      const value = Number(progress);
      const max = Number(progressMax);
      const percent = max > 0 && Number.isFinite(value)
        ? Math.max(0, Math.min(100, Math.round((value / max) * 100)))
        : 0;

      this.setData({ ringPercent: percent });
    },
  },

  methods: {
    onTap() {
      if (this.data.disabled) return;

      this.triggerEvent('tap', { taskId: this.data.taskId });
    },
  },
});
