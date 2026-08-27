# 旅程收藏卡素材目录（/assets/journey）

按以下命名准备 5 张收藏卡（建议 640×400 左右，PNG/WebP）：

```
card_day1.webp   Day 1  初遇
card_day7.webp   Day 7  森林入口
card_day14.webp  Day 14 湖边
card_day21.webp  Day 21 星光营地
card_day28.webp  Day 28 山顶
```

当前 `utils/companionAssets.ts` 中 `JOURNEY_CARDS_HAVE_ASSETS = false`，
代码自动降级到每个卡的 emoji 占位（🌱 / 🌲 / 💧 / 🌙 / ⛰️）。
等素材就位后：

1. 把 5 张图放进本目录；
2. 打开 `utils/companionAssets.ts`，把 `JOURNEY_CARDS_HAVE_ASSETS` 改为 `true`；
3. 如需改后缀，同步把 `JOURNEY_CARD_EXT = 'webp'` 改为对应后缀。
