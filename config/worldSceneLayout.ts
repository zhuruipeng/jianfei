/**
 * UI2 花园使用同一套 0~100 场景坐标。
 *
 * 坐标原点位于 4:3 scene-shell 左上角。角色与植物使用脚底锚点，
 * 其余元素使用中心锚点。这里只描述视觉位置，不参与任何成长或解锁计算。
 */
export const UI2_WORLD_SCENE_LAYOUT = {
  companion: { x: 30, y: 92 },
  plant: { x: 46, y: 89 },
  path: { x: 62, y: 72 },
  pond: { x: 75, y: 72 },
  decor: {
    flower: { x: 60, y: 89 },
    stone: { x: 93, y: 90 },
    grass: { x: 8, y: 90 },
  },
  discoveries: {
    nearPlants: { x: 50, y: 32 },
    grassEdge: { x: 11, y: 86 },
    farPath: { x: 84, y: 46 },
    byRoad: { x: 65, y: 73 },
    nightAir: { x: 80, y: 41 },
    inSky: { x: 48, y: 14 },
  },
} as const;

const p = (value: number) => `${value}%`;

/** WXSS 只消费变量，避免各图层自行维护百分比坐标。 */
export const UI2_WORLD_SCENE_STYLE = [
  `--scene-companion-x:${p(UI2_WORLD_SCENE_LAYOUT.companion.x)}`,
  `--scene-companion-y:${p(UI2_WORLD_SCENE_LAYOUT.companion.y)}`,
  `--scene-plant-x:${p(UI2_WORLD_SCENE_LAYOUT.plant.x)}`,
  `--scene-plant-y:${p(UI2_WORLD_SCENE_LAYOUT.plant.y)}`,
  `--scene-path-x:${p(UI2_WORLD_SCENE_LAYOUT.path.x)}`,
  `--scene-path-y:${p(UI2_WORLD_SCENE_LAYOUT.path.y)}`,
  `--scene-pond-x:${p(UI2_WORLD_SCENE_LAYOUT.pond.x)}`,
  `--scene-pond-y:${p(UI2_WORLD_SCENE_LAYOUT.pond.y)}`,
  `--scene-decor-flower-x:${p(UI2_WORLD_SCENE_LAYOUT.decor.flower.x)}`,
  `--scene-decor-flower-y:${p(UI2_WORLD_SCENE_LAYOUT.decor.flower.y)}`,
  `--scene-decor-stone-x:${p(UI2_WORLD_SCENE_LAYOUT.decor.stone.x)}`,
  `--scene-decor-stone-y:${p(UI2_WORLD_SCENE_LAYOUT.decor.stone.y)}`,
  `--scene-decor-grass-x:${p(UI2_WORLD_SCENE_LAYOUT.decor.grass.x)}`,
  `--scene-decor-grass-y:${p(UI2_WORLD_SCENE_LAYOUT.decor.grass.y)}`,
  `--scene-discovery-near-plants-x:${p(UI2_WORLD_SCENE_LAYOUT.discoveries.nearPlants.x)}`,
  `--scene-discovery-near-plants-y:${p(UI2_WORLD_SCENE_LAYOUT.discoveries.nearPlants.y)}`,
  `--scene-discovery-grass-edge-x:${p(UI2_WORLD_SCENE_LAYOUT.discoveries.grassEdge.x)}`,
  `--scene-discovery-grass-edge-y:${p(UI2_WORLD_SCENE_LAYOUT.discoveries.grassEdge.y)}`,
  `--scene-discovery-far-path-x:${p(UI2_WORLD_SCENE_LAYOUT.discoveries.farPath.x)}`,
  `--scene-discovery-far-path-y:${p(UI2_WORLD_SCENE_LAYOUT.discoveries.farPath.y)}`,
  `--scene-discovery-by-road-x:${p(UI2_WORLD_SCENE_LAYOUT.discoveries.byRoad.x)}`,
  `--scene-discovery-by-road-y:${p(UI2_WORLD_SCENE_LAYOUT.discoveries.byRoad.y)}`,
  `--scene-discovery-night-air-x:${p(UI2_WORLD_SCENE_LAYOUT.discoveries.nightAir.x)}`,
  `--scene-discovery-night-air-y:${p(UI2_WORLD_SCENE_LAYOUT.discoveries.nightAir.y)}`,
  `--scene-discovery-in-sky-x:${p(UI2_WORLD_SCENE_LAYOUT.discoveries.inSky.x)}`,
  `--scene-discovery-in-sky-y:${p(UI2_WORLD_SCENE_LAYOUT.discoveries.inSky.y)}`,
].join(';');
