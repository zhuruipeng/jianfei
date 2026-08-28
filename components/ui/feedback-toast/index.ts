type FeedbackToastTimerHolder = {
  __feedbackTimer?: ReturnType<typeof setTimeout>;
};

function clearFeedbackTimer(instance: FeedbackToastTimerHolder) {
  if (instance.__feedbackTimer === undefined) return;

  clearTimeout(instance.__feedbackTimer);
  instance.__feedbackTimer = undefined;
}

Component({
  properties: {
    visible: { type: Boolean, value: false },
    icon: { type: String, value: '' },
    text: { type: String, value: '' },
    tone: { type: String, value: 'green' },
    duration: { type: Number, value: 2200 },
  },

  observers: {
    'visible, duration'(visible: boolean, duration: number) {
      const instance = this as unknown as FeedbackToastTimerHolder;
      clearFeedbackTimer(instance);
      if (!visible) return;

      const requestedDuration = Number(duration);
      const displayDuration = Number.isFinite(requestedDuration)
        ? Math.max(0, requestedDuration)
        : 2200;

      instance.__feedbackTimer = setTimeout(() => {
        instance.__feedbackTimer = undefined;
        this.triggerEvent('closed');
      }, displayDuration);
    },
  },

  lifetimes: {
    detached() {
      clearFeedbackTimer(this as unknown as FeedbackToastTimerHolder);
    },
  },
});
