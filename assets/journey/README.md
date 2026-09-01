# 旅程收藏卡素材目录（/assets/journey）

按以下命名准备 5 张收藏卡（建议 640×400 左右，PNG/WebP）：

```
card_day1.webp   Day 1  初遇
card_day7.webp   Day 7  森林入口
card_day14.webp  Day 14 湖边
card_day21.webp  Day 21 星光营地
card_day28.webp  Day 28 山顶
```

5 张 UI 2.0 WebP 已接入，`utils/companionAssets.ts` 通过统一映射加载这些文件。
未解锁卡不会请求不存在的图片，也不会提前展示正式插画。
