Component({
  options: {
    multipleSlots: true,
  },

  properties: {
    variant: { type: String, value: 'base' },
    padding: { type: String, value: 'md' },
    clickable: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    compact: { type: Boolean, value: false },
  },

  methods: {
    onTap() {
      if (!this.data.clickable || this.data.disabled) return;
      this.triggerEvent('tap');
    },
  },
});
