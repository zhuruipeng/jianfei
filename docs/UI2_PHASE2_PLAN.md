# 小步轻 UI 2.0 Phase 2 计划

> 本文档仅规划下一阶段，本轮不执行。开始 Phase 2 前必须先完成 UI 2.0 首页的真机视觉与核心流程验收。

## 目标与边界

把首页已经验证的 Design Tokens、基础组件和温和交互语言迁移到其余核心页面。Phase 2 不新增商城、好友世界、AI 聊天、发现物、积分规则、轻能量规则或新的 Storage 数据结构；所有页面继续使用现有 Service 与真实记录。

四个线程从同一集成基线提交建立独立 worktree，文件范围互斥。各线程只提交自己的页面或新通用组件，最终由集成主线程处理注册、Token、类型、路径、冲突、全量检查与截图。

## 线程 1：进展页

范围：实际 `pages/progress/**`，以及经主线程确认后与计划/周总结页面共享的纯展示转换类型。

- 当前体重卡、体重趋势、周总结、计划总结、反馈入口、空状态。
- 复用 `SoftCard`、`SectionHeader`、`ProgressBar`、`SummaryBanner`、`SoftButton`。
- 继续读取 `weightService`、`weeklySummaryService` 和当前计划；不在页面重算另一套趋势或完成率。
- 目标：从统计后台转为温和的旅程回顾，同时保留体重记录、周总结与计划总结入口。

验收：有/无体重数据、单点趋势、多点趋势、未查看周总结、计划完成、Storage 读取失败六种状态。

## 线程 2：奖励页

范围：实际 `pages/reward/**`。

- 累计积分、下一个现实奖励、创建、已解锁、已领取和空状态。
- 复用 `SoftCard`、`SectionHeader`、`ProgressBar`、`SoftButton`、`StatusPill`。
- 继续使用现有 `rewardService` 与积分结果；不把轻能量与现实奖励积分合并。
- 目标：从积分商城转为“给自己准备的小礼物”，保留创建、编辑、删除和领取流程。

验收：无奖励、未解锁、刚解锁、已领取、删除确认、保存失败。

## 线程 3：我的发现

范围：实际 `pages/discoveries/**`；不得修改 `discoveryService`、发现配置或正式素材。

- 图鉴、已解锁卡片、未解锁剪影、详情层、发现日期和空状态。
- 复用 `SoftCard`、`SectionHeader`、`FeedbackToast`、`SoftButton`。
- 继续使用正式 WebP 和现有发现持久化；不新增发现、不改变位置、资格或解锁日期。
- 目标：温和自然图鉴，清晰区分已发现和未发现而不制造压力。

验收：0/1/多项/全部发现、图片加载失败、详情打开关闭、返回首页后的已查看状态。

## 线程 4：通用表单与状态

范围：新增且仅新增以下组件目录：

```text
components/ui/ui-input/
components/ui/ui-modal/
components/ui/empty-state/
components/ui/error-state/
components/ui/loading-state/
```

- `ui-input`：标签、提示、错误、字数、禁用、输入事件。
- `ui-modal`：标题、正文、确认/取消、危险态、安全区和遮罩关闭策略。
- `empty-state`：温和空状态、可选图片和主/次操作。
- `error-state`：可恢复错误、重试事件和图片加载失败状态。
- `loading-state`：局部/整页 loading，避免无限动画和布局跳动。
- 统一删除确认、表单错误、保存中、图片失败与轻反馈语言。

组件只展示和转发事件，不读 Storage、不调 Service、不实现页面业务。

## 集成顺序

1. 通用表单与状态组件。
2. 进展页。
3. 奖励页。
4. 我的发现。
5. 主线程统一修正注册、路径、类型和 Token，并删除临时占位。

冲突处理以当前稳定业务逻辑为准；样式以 UI 2.0 Tokens 为准；禁止使用 `ours`/`theirs` 覆盖整个页面。

## Phase 2 验证

- `npx tsc --noEmit`、全量 JSON 解析、WXML/WXSS 静态检查、`git diff --check`。
- 375×812、390×844、414×896、430×932，无横向滚动且底部安全区正常。
- 进展、奖励、发现的正常、空、错误、loading 和图片失败状态截图。
- 核心增删改查回归；Storage 格式前后对比；Service/配置/业务规则 diff 审计。

## Phase 2 之后

停止继续加功能，进入真机视觉与留存验证：至少一台 iPhone、两台不同尺寸安卓，检查首屏加载、WebP 透明素材、动画帧率、长页滚动、Day 2/3 回访、3/3 完成率、发现查看率和 Day 7 到达率。只有真实数据支持时，才在前三天新手旅程、提醒、AI 每日总结或记录步骤优化中选择下一项。
