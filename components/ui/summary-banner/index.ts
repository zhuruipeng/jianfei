Component({
  properties: {
    iconSrc: { type: String, value: '' },
    iconEmoji: { type: String, value: '' },
    title: { type: String, value: '' },
    subtitle: { type: String, value: '' },
    actionText: { type: String, value: '' },
    tone: { type: String, value: 'green' },
    compact: { type: Boolean, value: false },
  },

  methods: {
    onTap() {
      this.triggerEvent('tap');
    },
  },
});
