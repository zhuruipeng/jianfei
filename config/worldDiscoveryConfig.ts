import type { WorldDiscoveryConfigItem, WorldDiscoveryId } from '../types/index';

/**
 * V1.5 固定发现表。条件只使用可解释的真实历史指标，不使用随机数。
 * 锁定页不会展示这里的 threshold / conditionType。
 */
export const WORLD_DISCOVERY_CONFIG: WorldDiscoveryConfigItem[] = [
  {
    id: 'butterfly', name: '叶间蝴蝶', emoji: '🦋', imageKey: 'butterfly', sceneClass: 'near-plants',
    description: '一只小蝴蝶记住了花园的气味，常常停在新叶旁边。',
    companionMessage: '嘘，它好像把这里也当成家了。', conditionType: 'meal_days', threshold: 3,
  },
  {
    id: 'mushroom', name: '草边蘑菇', emoji: '🍄', imageKey: 'mushroom', sceneClass: 'grass-edge',
    description: '不起眼的小记录积在一起，草边悄悄冒出了一朵蘑菇。',
    companionMessage: '它是什么时候长出来的？我居然没发现。', conditionType: 'meaningful_days', threshold: 5,
  },
  {
    id: 'bird', name: '远处小鸟', emoji: '🐦', imageKey: 'bird', sceneClass: 'far-path',
    description: '小路走得多了，远处的小鸟也开始来这里歇脚。',
    companionMessage: '它是不是在等我们把路走得更远？', conditionType: 'exercise_days', threshold: 3,
  },
  {
    id: 'bench', name: '木头长椅', emoji: '🪵', imageKey: 'bench', sceneClass: 'by-road',
    description: '完整照顾自己的日子，让路边多了一个可以慢慢休息的位置。',
    companionMessage: '累的时候坐一会儿，也算继续往前。', conditionType: 'all_complete_days', threshold: 3,
  },
  {
    id: 'firefly', name: '晚风萤火', emoji: '✨', imageKey: 'firefly', sceneClass: 'night-air',
    description: '旅程来到第七天，晚风里亮起了几颗温柔的小光点。',
    companionMessage: '原来小小的光，也能把这里照亮。', conditionType: 'plan_day', threshold: 7,
  },
  {
    id: 'rainbow', name: '天空彩虹', emoji: '🌈', imageKey: 'rainbow', sceneClass: 'in-sky',
    description: '七个完整的日子在天空留下了一道安静的彩虹。',
    companionMessage: '我数了两遍，还是会忍不住再看一遍。', conditionType: 'all_complete_days', threshold: 7,
  },
];

export const WORLD_DISCOVERY_BY_ID = WORLD_DISCOVERY_CONFIG.reduce((map, item) => {
  map[item.id] = item;
  return map;
}, {} as Record<WorldDiscoveryId, WorldDiscoveryConfigItem>);

export const WORLD_DISCOVERY_ASSET_DIR = '/assets/world/discoveries';

export function getWorldDiscoveryAsset(imageKey: string): string {
  return `${WORLD_DISCOVERY_ASSET_DIR}/${imageKey}.webp`;
}
