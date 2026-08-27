# 小轻世界素材

当前 `config/worldGrowthConfig.ts` 中的 `WORLD_HAS_ASSETS` 为 `false`，首页使用
`components/companion-world` 内的 CSS / Emoji 分层占位，不会请求不存在的图片。

美术素材完成后按下面的固定命名放入目录，再把开关改成 `true`：

```text
background.webp
ground.webp
plants/plant_0.webp ... plant_4.webp
path/path_0.webp ... path_4.webp
water/water_0.webp ... water_4.webp
effects/flowers.webp
effects/sunlight.webp
effects/sparkle.webp
```

所有图片使用相同画布尺寸和锚点，组件会按“背景 → 土地 → 道路 → 水池 → 植物 →
小轻 → 特效”的顺序叠加。
