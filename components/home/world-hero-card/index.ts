Component({
  properties: {
    journeyTitle: { type: String, value: '' },
    journeyDayText: { type: String, value: '' },
    dateText: { type: String, value: '' },
    atmosphereText: { type: String, value: '' },
    worldState: { type: Object, value: null },
    worldAssets: { type: Object, value: null },
    worldTransition: { type: Object, value: null },
    discoveries: { type: Array, value: [] },
    discoveryCount: { type: Number, value: 0 },
    companionStage: { type: String, value: 'seed' },
    companionMood: { type: String, value: 'encouraging' },
    companionAsset: { type: Object, value: null },
    companionName: { type: String, value: '小轻' },
    companionMessage: { type: String, value: '' },
    plantText: { type: String, value: '' },
    pathText: { type: String, value: '' },
    waterText: { type: String, value: '' },
    energyValue: { type: Number, value: 0 },
    energyMax: { type: Number, value: 0 },
    nextUnlockTitle: { type: String, value: '' },
    nextUnlockDescription: { type: String, value: '' },
    nextUnlockImage: { type: String, value: '' },
    nextUnlockVisible: { type: Boolean, value: false },
    journeyEntryTitle: { type: String, value: '查看旅程' },
    journeyEntryEnabled: { type: Boolean, value: true },
    settingsVisible: { type: Boolean, value: false },
  },

  methods: {
    onCompanionTap() {
      this.triggerEvent('companiontap');
    },

    onJourneyTap() {
      if (!this.data.journeyEntryEnabled) return;
      this.triggerEvent('journeytap');
    },

    onDiscoveryTap(event: { detail?: { discoveryId?: string } }) {
      this.triggerEvent('discoverytap', {
        discoveryId: event.detail?.discoveryId || '',
      });
    },

    onNextUnlockTap() {
      this.triggerEvent('nextunlocktap');
    },

    onSettingsTap() {
      this.triggerEvent('settingtap');
    },

    onDiscoveriesEntryTap() {
      this.triggerEvent('discoveriesentry');
    },
  },
});
