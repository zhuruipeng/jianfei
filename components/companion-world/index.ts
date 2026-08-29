import { WORLD_DECOR_ASSETS } from '../../config/worldDiscoveryConfig';
import {
  UI2_GARDEN_ASSETS,
  UI2_PLANT_ASSETS,
} from '../../config/worldGrowthConfig';
import { UI2_WORLD_SCENE_STYLE } from '../../config/worldSceneLayout';

Component({
  data: {
    decorAssets: WORLD_DECOR_ASSETS,
    gardenAssets: UI2_GARDEN_ASSETS,
    sceneCoordinateStyle: UI2_WORLD_SCENE_STYLE,
    plantStageAsset: UI2_PLANT_ASSETS[0],
    plantAssetReady: true,
    gardenAssetReady: {
      base: true,
      foreground: true,
      light: true,
    },
  },

  observers: {
    'state.plantLevel': function onPlantLevelChange(plantLevel: number) {
      const level = Number.isInteger(plantLevel) && plantLevel >= 0 && plantLevel <= 4
        ? plantLevel
        : 0;
      this.setData({
        plantStageAsset: UI2_PLANT_ASSETS[level],
        plantAssetReady: true,
      });
    },
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
    onGardenAssetError(e: any) {
      const layer = e?.currentTarget?.dataset?.layer;
      if (layer === 'base' || layer === 'foreground' || layer === 'light') {
        this.setData({ [`gardenAssetReady.${layer}`]: false });
      }
    },
    onPlantAssetError() {
      this.setData({ plantAssetReady: false });
    },
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
