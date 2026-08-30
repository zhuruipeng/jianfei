import {
  type WorldElementType,
  type WorldJourneyLandmark,
  type WorldLevel,
} from '../types/index';

export interface WorldGrowthStage {
  level: WorldLevel;
  requiredDays: number;
  label: string;
}

/** 三种元素统一采用 0 / 1 / 3 / 7 / 14 个有效日的五阶段成长。 */
export const WORLD_GROWTH_STAGES: WorldGrowthStage[] = [
  { level: 0, requiredDays: 0, label: '刚刚开始' },
  { level: 1, requiredDays: 1, label: '出现变化' },
  { level: 2, requiredDays: 3, label: '慢慢生长' },
  { level: 3, requiredDays: 7, label: '逐渐丰富' },
  { level: 4, requiredDays: 14, label: '完整花园' },
];

export const WORLD_ELEMENT_LABELS: Record<WorldElementType, string> = {
  plant: '饮食记录',
  path: '运动目标',
  water: '喝水目标',
};

export const WORLD_ELEMENT_CHANGE_LABELS: Record<WorldElementType, string> = {
  plant: '植物会继续成长',
  path: '小路会继续延伸',
  water: '水池会发生新的变化',
};

export const WORLD_JOURNEY_LANDMARKS: WorldJourneyLandmark[] = [
  { visible: true, dayRequired: 7, title: '森林入口', emoji: '🌲', hint: '已经可以前往' },
  { visible: true, dayRequired: 14, title: '湖边', emoji: '💧', hint: '去看看' },
  { visible: true, dayRequired: 21, title: '星光营地', emoji: '🌙', hint: '去看看' },
  { visible: true, dayRequired: 28, title: '山顶', emoji: '⛰️', hint: '去看看' },
];

export const WORLD_ASSET_DIR = '/assets/world';

/** UI 2.0 花园固定环境层。动态道路、水面、植物和发现物仍由组件按真实状态绘制。 */
export const UI2_GARDEN_ASSETS = {
  base: `${WORLD_ASSET_DIR}/ui2/garden_base.png`,
  foreground: `${WORLD_ASSET_DIR}/ui2/garden_foreground.png`,
  light: `${WORLD_ASSET_DIR}/ui2/garden_light.png`,
} as const;

/** UI 2.0 动态植物素材；数组索引与现有 plantLevel 0～4 严格对应。 */
export const UI2_PLANT_ASSETS = [
  `${WORLD_ASSET_DIR}/ui2/plants/plant_0.png`,
  `${WORLD_ASSET_DIR}/ui2/plants/plant_1.png`,
  `${WORLD_ASSET_DIR}/ui2/plants/plant_2.png`,
  `${WORLD_ASSET_DIR}/ui2/plants/plant_3.png`,
  `${WORLD_ASSET_DIR}/ui2/plants/plant_4.png`,
] as const;

/** 美术素材到齐后切成 true；业务开发期间使用组件内的 CSS / Emoji 分层占位。 */
export const WORLD_HAS_ASSETS = false;

export interface WorldAssetSet {
  useImages: boolean;
  background: string;
  ground: string;
  plant: string;
  path: string;
  water: string;
  flowers: string;
  sunlight: string;
  sparkle: string;
}

export function getWorldAssetSet(
  plantLevel: WorldLevel,
  pathLevel: WorldLevel,
  waterLevel: WorldLevel,
): WorldAssetSet {
  return {
    useImages: WORLD_HAS_ASSETS,
    background: `${WORLD_ASSET_DIR}/background.webp`,
    ground: `${WORLD_ASSET_DIR}/ground.webp`,
    plant: `${WORLD_ASSET_DIR}/plants/plant_${plantLevel}.webp`,
    path: `${WORLD_ASSET_DIR}/path/path_${pathLevel}.webp`,
    water: `${WORLD_ASSET_DIR}/water/water_${waterLevel}.webp`,
    flowers: `${WORLD_ASSET_DIR}/effects/flowers.webp`,
    sunlight: `${WORLD_ASSET_DIR}/effects/sunlight.webp`,
    sparkle: `${WORLD_ASSET_DIR}/effects/sparkle.webp`,
  };
}
