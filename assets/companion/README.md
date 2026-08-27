# 角色素材目录（/assets/companion）

按以下命名准备 12 张角色素材（建议 400×400 左右，透明背景，WebP 或 PNG）：

```
companion_seed_neutral.webp        Lv.1 · 小种子 平静
companion_seed_happy.webp          Lv.1 · 小种子 开心
companion_seed_encouraging.webp    Lv.1 · 小种子 鼓励

companion_baby_neutral.webp        Lv.2~3 · 小轻刚出现 平静
companion_baby_happy.webp          Lv.2~3 · 小轻刚出现 开心
companion_baby_encouraging.webp    Lv.2~3 · 小轻刚出现 鼓励

companion_growing_neutral.webp     Lv.4~5 · 成长中的小轻 平静
companion_growing_happy.webp       Lv.4~5 · 成长中的小轻 开心
companion_growing_encouraging.webp Lv.4~5 · 成长中的小轻 鼓励

companion_grown_neutral.webp       Lv.6~7 · 完整小轻 平静
companion_grown_happy.webp         Lv.6~7 · 完整小轻 开心
companion_grown_encouraging.webp   Lv.6~7 · 完整小轻 鼓励
```

当前 `utils/companionAssets.ts` 中 `COMPANION_HAS_ASSETS = false`，
代码自动降级到 Emoji 占位。等素材就位后：

1. 把 12 张图放进本目录；
2. 打开 `utils/companionAssets.ts`，把 `COMPANION_HAS_ASSETS` 改为 `true`；
3. 若用 png/svg 而非 webp，同步把 `COMPANION_EXT = 'webp'` 改为对应后缀。
