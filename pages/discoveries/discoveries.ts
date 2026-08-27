import { WORLD_DISCOVERY_ASSETS, WORLD_DISCOVERY_CONFIG } from '../../config/worldDiscoveryConfig';
import { loadWorldDiscoveries, trackWorldDiscoveryViewed } from '../../services/discoveryService';
import type { WorldDiscoveryId } from '../../types/index';

interface DiscoveryListItem {
  id: WorldDiscoveryId;
  unlocked: boolean;
  name: string;
  asset: string;
  description: string;
  discoveredAtText: string;
}

function formatDiscoveryDate(value: string): string {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${Number(match[2])}月${Number(match[3])}日发现` : '已经来到花园';
}

Page({
  data: {
    items: [] as DiscoveryListItem[],
    unlockedCount: 0,
    selected: null as DiscoveryListItem | null,
  },

  onShow() {
    const stateMap = new Map(loadWorldDiscoveries().map((item) => [item.discoveryId, item]));
    const items: DiscoveryListItem[] = WORLD_DISCOVERY_CONFIG.map((config) => {
      const state = stateMap.get(config.id);
      return state ? {
        id: config.id,
        unlocked: true,
        name: config.name,
        asset: WORLD_DISCOVERY_ASSETS[config.id],
        description: config.description,
        discoveredAtText: formatDiscoveryDate(state.unlockedAt),
      } : {
        id: config.id,
        unlocked: false,
        name: '尚未发现',
        asset: '',
        description: '继续照顾花园，也许会遇见新的小惊喜。',
        discoveredAtText: '',
      };
    });
    this.setData({ items, unlockedCount: items.filter((item) => item.unlocked).length, selected: null });
  },

  onItemTap(e: any) {
    const id = e?.currentTarget?.dataset?.id as WorldDiscoveryId;
    const item = (this.data.items as DiscoveryListItem[]).find((candidate) => candidate.id === id);
    if (!item) return;
    if (item.unlocked) trackWorldDiscoveryViewed(item.id);
    this.setData({ selected: item });
  },

  onCloseDetail() {
    this.setData({ selected: null });
  },

  stopPropagation() { /* 阻止卡片点击关闭遮罩 */ },
});
