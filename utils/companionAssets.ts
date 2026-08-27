/**
 * utils/companionAssets.ts
 *
 * 角色与旅程卡资源统一映射（需求第 25 / 26 条）。
 *
 * 业务代码不要散落 "/assets/companion/xxx.webp" 这种硬编码。
 * 所有资源通过：
 *   resolveCompanionAsset(stage, mood)
 *   resolveJourneyCardAsset(imageKey)
 * 获取。
 *
 * 图片文件准备说明：
 *   - 把正式 PNG/WebP/SVG 按约定命名放入：
 *       /assets/companion/companion_seed_neutral.webp
 *       /assets/companion/companion_seed_happy.webp
 *       ... 共 12 张
 *       /assets/journey/card_day1.webp
 *       ... 共 5 张
 *   - 业务代码不需要改；若某张图还没准备好，会降级到 EMJI_FALLBACK，保证页面不崩。
 */

import {
  COMPANION_ASSET_DIR,
  JOURNEY_CARD_ASSET_DIR,
  CompanionMood,
  CompanionVisualStage,
} from '../types/index';

// ---------------- 支持的扩展名（按优先级尝试；目前优先 webp → png → svg） ----------------
const COMPANION_EXT = 'webp';       // 美术以后换成 webp 直接改这里
const JOURNEY_CARD_EXT = 'webp';

// ---------------- 4 阶段 × 3 情绪（共 12 张）imageKey 列表 ----------------
export const COMPANION_STAGE_KEYS: CompanionVisualStage[] = ['seed', 'baby', 'growing', 'grown'];
export const COMPANION_MOOD_KEYS: CompanionMood[] = ['neutral', 'happy', 'encouraging'];

/** 按资源命名规范拼接真实路径 */
export function resolveCompanionAsset(
  stage: CompanionVisualStage,
  mood: CompanionMood,
): string {
  return `${COMPANION_ASSET_DIR}/companion_${stage}_${mood}.${COMPANION_EXT}`;
}

/** 旅程收藏卡 5 张 */
export function resolveJourneyCardAsset(imageKey: string): string {
  return `${JOURNEY_CARD_ASSET_DIR}/card_${imageKey}.${JOURNEY_CARD_EXT}`;
}

// ---------------- Emoji 占位（当素材文件未就位时，UI 层可降级用 emoji 展示） ----------------
/** 每个阶段 × 情绪 给一个占位 emoji，让页面在无图时也能表达情绪，而不是一个空盒子 */
export const COMPANION_EMOJI_FALLBACK: Record<CompanionVisualStage, Record<CompanionMood, string>> = {
  seed: {
    neutral:     '🌱',
    happy:       '🌱',
    encouraging: '🌱',
  },
  baby: {
    neutral:     '🌿',
    happy:       '🍃',
    encouraging: '🌿',
  },
  growing: {
    neutral:     '🍀',
    happy:       '🌾',
    encouraging: '🍀',
  },
  grown: {
    neutral:     '🌳',
    happy:       '✨',
    encouraging: '🌳',
  },
};

/** 未解锁卡的占位 ? 号 + 简单 emoji 提示（不在详情提前显示完整内容） */
export const JOURNEY_LOCKED_EMOJI: string = '❔';

/**
 * 小轻角色区 4 种状态，是否需要真正 <image> 加载。
 * 当 COMPANION_HAS_ASSETS = false 时，UI 层直接用 emoji 占位，
 * 避免小程序找不到 12 张资源文件时出现一堆"加载失败"占位图。
 * 美术给图后，把下面常量改为 true（再做一次文件存在性自检即可）。
 */
export const COMPANION_HAS_ASSETS: boolean = false;
export const JOURNEY_CARDS_HAVE_ASSETS: boolean = false;

/** 给业务层用：返回最终渲染所需的 {src, emoji}，让 UI 统一判断 */
export interface ResolvedCompanionAsset {
  /** 是否展示 <image>。false 表示没素材，建议 UI 显示 emoji */
  useImage: boolean;
  /** 当 useImage = true 时的图片路径，否则为空字符串（方便 UI 直接绑定 src） */
  src: string;
  /** 当 useImage = false 时的 emoji 占位；useImage=true 时可用于 alt / 无障碍 */
  emoji: string;
  /** 供 UI 加 CSS hook：按 stage+mood 微调位置 */
  cssClass: string;
}

export function getCompanionRenderAsset(
  stage: CompanionVisualStage,
  mood: CompanionMood,
): ResolvedCompanionAsset {
  const src = resolveCompanionAsset(stage, mood);
  const emoji = (COMPANION_EMOJI_FALLBACK[stage] && COMPANION_EMOJI_FALLBACK[stage][mood]) || '🌱';
  return {
    useImage: COMPANION_HAS_ASSETS,
    src: COMPANION_HAS_ASSETS ? src : '',
    emoji,
    cssClass: `c-${stage}-${mood}`,
  };
}

export interface ResolvedJourneyCardAsset {
  useImage: boolean;
  emoji: string;
  /** 供 UI 加 CSS hook：imageKey 维度，保持与角色资源返回结构一致 */
  imageKey: string;
  /** 非空字符串：当 useImage=false 时为空字符串，UI 层据此不渲染 <image> */
  src: string;
  cssClass: string;
}

/** 别名：便于 journey 页面 VM 直接使用 */
export type JourneyCardRenderAsset = ResolvedJourneyCardAsset;

export function getJourneyCardRenderAsset(
  imageKey: string,
  fallbackEmoji: string,
  shortTitleHint: string = '',
): ResolvedJourneyCardAsset {
  const src = resolveJourneyCardAsset(imageKey);
  const realSrc = JOURNEY_CARDS_HAVE_ASSETS ? src : '';
  return {
    useImage: JOURNEY_CARDS_HAVE_ASSETS,
    src: realSrc,
    emoji: fallbackEmoji || '🟟',
    imageKey: String(imageKey || ''),
    cssClass: `jc-${imageKey}${shortTitleHint ? ` jc-t-${shortTitleHint}` : ''}`,
  };
}
