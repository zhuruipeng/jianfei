import { WORLD_DECOR_ASSETS } from '../../config/worldDiscoveryConfig';

Component({
  data: {
    decorAssets: WORLD_DECOR_ASSETS,
  },

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
    discoveries: { type: Array, value: [] },
    discoveryCount: { type: Number, value: 0 },
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
    onDiscoveryTap(e: any) {
      this.triggerEvent('discoverytap', { discoveryId: e?.currentTarget?.dataset?.id || '' });
    },
    onDiscoveriesEntryTap() {
      this.triggerEvent('discoveriesentry');
    },
    onNextUnlockTap() {
      this.triggerEvent('nextunlocktap');
    },
  },
});
