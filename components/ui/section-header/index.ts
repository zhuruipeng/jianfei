Component({
  properties: {
    title: { type: String, value: '' },
    subtitle: { type: String, value: '' },
    icon: { type: String, value: '' },
    actionText: { type: String, value: '' },
    compact: { type: Boolean, value: false },
  },

  methods: {
    onAction() {
      if (!this.data.actionText) return;
      this.triggerEvent('action');
    },
  },
});
