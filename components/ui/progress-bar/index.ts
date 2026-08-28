Component({
  properties: {
    value: { type: Number, value: 0 },
    max: { type: Number, value: 100 },
    tone: { type: String, value: 'green' },
    height: { type: Number, value: 12 },
    animated: { type: Boolean, value: true },
  },

  data: {
    percent: 0,
  },

  observers: {
    'value,max': function updatePercent(value: number, max: number) {
      const numericMax = Number(max);
      const numericValue = Number(value);
      const rawPercent = numericMax > 0 ? (numericValue / numericMax) * 100 : 0;
      const percent = Number.isFinite(rawPercent)
        ? Math.max(0, Math.min(100, rawPercent))
        : 0;

      this.setData({ percent });
    },
  },
});
