Component({
  properties: {
    state: { type: Object, value: null },
    assets: { type: Object, value: null },
    transition: { type: Object, value: null },
    companionStage: { type: String, value: 'seed' },
    companionMood: { type: String, value: 'encouraging' },
    companionAsset: { type: Object, value: null },
    companionName: { type: String, value: '小轻' },
    message: { type: String, value: '' },
    headerText: { type: String, value: '28天轻旅 · 第1天' },
    subtitleText: { type: String, value: '' },
    energyText: { type: String, value: '' },
    settingsVisible: { type: Boolean, value: false },
  },

  methods: {
    onCompanionTap() {
      this.triggerEvent('companiontap');
    },
    onJourneyTap() {
      this.triggerEvent('journeytap');
    },
    onSettingsTap() {
      this.triggerEvent('settingtap');
    },
  },
});
