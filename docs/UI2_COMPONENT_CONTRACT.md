# 小步轻 UI 2.0 组件契约

本文档是 UI 2.0 首页并行开发的唯一组件接口约定。组件只负责展示与事件转发；首页只把现有 Service 和工具函数的结果转换为展示字段。任何线程不得新建第二套业务状态、修改 Storage 数据格式，或改写饮食、运动、喝水、积分、轻能量、世界成长和发现解锁规则。

## 文件归属

| 线程 | 独占文件 |
| --- | --- |
| A：基础体系 | `styles/ui-tokens.wxss`、`styles/ui-common.wxss`、`components/ui/soft-card/**`、`section-header/**`、`status-pill/**`、`progress-bar/**`、`soft-button/**` |
| B：任务与反馈 | `components/ui/task-card/**`、`paper-note/**`、`summary-banner/**`、`feedback-toast/**` |
| C：世界主视觉 | `components/home/world-hero-card/**`；仅可有限调整 `components/companion-world/*.wxss` 和必要的容器级 WXML |
| D：首页 | 实际首页 `pages/index/**` |
| 集成主线程 | `app.json`、`app.wxss`、组件注册与路径、跨线程类型与字段对齐、本文档、`docs/UI2_PHASE2_PLAN.md` |

线程不得修改其他线程的独占文件。需要变更契约时先报告集成主线程。

## Design Tokens

文件：`styles/ui-tokens.wxss`、`styles/ui-common.wxss`；线程 A。

必须提供语义化变量，覆盖页面/卡片/浅绿/主绿/深绿/浅木/深木/湖水蓝/阳光黄/柔粉/主文字/次文字/边框颜色，以及字体层级、4–40rpx 间距、14/20/28/36/999rpx 圆角、柔和阴影、160/260/520/900ms 动画时长和 `cubic-bezier(0.22, 1, 0.36, 1)` 缓动。Token 不读取任何业务数据。

## SoftCard

文件：`components/ui/soft-card/**`；线程 A。

- Properties：`variant: 'base' | 'green' | 'blue' | 'yellow' | 'paper'`，`padding: 'sm' | 'md' | 'lg'`，`clickable: boolean`，`disabled: boolean`，`compact: boolean`。
- Slots：`header`、默认 slot、`footer`。
- Events：可点击且未禁用时触发 `tap`。
- 真实业务字段：无；由父组件传入 slot 内容。

## SectionHeader

文件：`components/ui/section-header/**`；线程 A。

- Properties：`title: string`，`subtitle?: string`，`icon?: string`，`actionText?: string`，`compact?: boolean`。
- Events：点击操作区触发 `action`。
- 真实业务字段：首页标题为固定展示文案；操作行为由首页现有跳转方法处理。

## StatusPill

文件：`components/ui/status-pill/**`；线程 A。

- Properties：`icon?: string`，`label: string`，`value: string`，`tone: 'green' | 'wood' | 'water' | 'neutral'`，`active?: boolean`。
- Events / Slots：无。
- 真实业务字段：`WorldState.plantLevel/pathLevel/waterLevel` 只在首页转换成 `value`；组件不读取世界状态。

## ProgressBar

文件：`components/ui/progress-bar/**`；线程 A。

- Properties：`value: number`，`max: number`，`tone: 'green' | 'yellow' | 'blue' | 'wood'`，`height?: number`，`animated?: boolean`。
- Events / Slots：无。
- 行为：`max <= 0` 时展示 0%；其余结果限制在 0%–100%；只计算展示百分比。
- 真实业务字段：由父组件传入任务当前值/目标或计划进度，不自行读取业务数据。

## SoftButton

文件：`components/ui/soft-button/**`；线程 A。

- Properties：`text: string`，`variant: 'primary' | 'secondary' | 'ghost' | 'danger'`，`size: 'sm' | 'md' | 'lg'`，`loading?: boolean`，`disabled?: boolean`，`fullWidth?: boolean`。
- Events：非 loading 且非 disabled 时触发 `tap`。
- 真实业务字段：无。

## TaskCard

文件：`components/ui/task-card/**`；线程 B。

- Properties：`taskId: string`，`iconSrc?: string`，`iconEmoji?: string`，`title: string`，`subtitle?: string`，`status: 'pending' | 'active' | 'completed'`，`indicator: 'check' | 'ring' | 'bar'`，`progress?: number`，`progressMax?: number`，`progressText?: string`，`footerText?: string`，`disabled?: boolean`。
- Events：整卡点击触发 `tap`，detail 为 `{ taskId }`；禁用时不触发。
- Slots：无。
- 真实业务字段：首页通过 `computeDailyTasksForDate(today)` 的结果转换；饮食来自 `MealRecord`，运动/喝水来自 `DailyRecord` 与 effective goal，轻能量领取态来自现有 `EnergyLedger`。组件不得判断任务是否完成。

## PaperNote

文件：`components/ui/paper-note/**`；线程 B。

- Properties：`eyebrow?: string`，`title: string`，`description?: string`，`imageSrc?: string`，`actionText?: string`，`compact?: boolean`。
- Events：仅点击操作入口时触发 `action`。
- Slots：无。
- 真实业务字段：标题和描述来自 `WorldState.nextUnlock`；图片来自正式素材映射。组件不得计算解锁进度。

## SummaryBanner

文件：`components/ui/summary-banner/**`；线程 B。

- Properties：`iconSrc?: string`，`iconEmoji?: string`，`title: string`，`subtitle?: string`，`actionText?: string`，`tone: 'green' | 'blue' | 'warm'`，`compact?: boolean`。
- Events：整卡点击触发 `tap`。
- Slots：无。
- 真实业务字段：计划完成来自 `planService.loadActivePlan()` 与现有计划日判断；周总结来自 `weeklySummaryService`；进展入口只做导航。

## FeedbackToast

文件：`components/ui/feedback-toast/**`；线程 B。

- Properties：`visible: boolean`，`icon?: string`，`text: string`，`tone: 'green' | 'water' | 'warm'`，`duration?: number`（默认约 2200ms）。
- Events：展示时长结束后触发 `closed`。
- Slots：无。
- 行为：轻微向上淡入；不拦截点击或保存；组件 detached 时清理定时器。
- 真实业务字段：反馈文字由首页现有保存和世界反馈结果提供；组件不得调用 Service。

## WorldHeroCard

文件：`components/home/world-hero-card/**`；线程 C。

- Properties：`journeyTitle: string`，`journeyDayText: string`，`dateText: string`，`atmosphereText?: string`，`worldState: object`，`worldAssets?: object`，`worldTransition?: object`，`discoveries?: array`，`discoveryCount?: number`，`companionStage: string`，`companionMood: string`，`companionAsset: object`，`companionName: string`，`companionMessage: string`，`plantText: string`，`pathText: string`，`waterText: string`，`energyValue: number`，`energyMax: number`，`nextUnlockTitle: string`，`nextUnlockDescription: string`，`nextUnlockImage?: string`，`nextUnlockVisible?: boolean`，`journeyEntryTitle: string`，`journeyEntryEnabled: boolean`，`settingsVisible?: boolean`。
- Events：`companiontap`、`journeytap`、`discoverytap`（透传 `{ discoveryId }`）、`nextunlocktap`；为保留现有首页入口，兼容转发 `settingtap` 与 `discoveriesentry`。
- Slots：无。内部组合现有 `companion-world`、三个 `StatusPill`、`ProgressBar` 和 `PaperNote`。
- 真实业务字段：世界场景来自 `buildWorldState`、`getWorldAssetSet`、`syncWorldUiState`；伙伴来自现有 `CompanionState`、`EnergyLedger` 与 companion 工具；发现来自 `syncWorldDiscoveries`。组件不得读取 Storage 或调用 Service。

`components/companion-world` 的业务 Properties 和发现事件必须保留。线程 C 只可调整圆角、裁切、图层透明度、素材尺寸、场景留白、动画时长及视觉层级，不得修改 TypeScript、解锁条件、日期规则、发现位置算法或持久化。

## 首页 ViewModel

文件：`pages/index/**`；线程 D。

```ts
type HomeTaskStatus = 'pending' | 'active' | 'completed'
type HomeTaskIndicator = 'check' | 'ring' | 'bar'

interface HomeTaskViewModel {
  taskId: string
  iconSrc?: string
  iconEmoji?: string
  title: string
  subtitle?: string
  status: HomeTaskStatus
  indicator: HomeTaskIndicator
  progress?: number
  progressMax?: number
  progressText?: string
  footerText?: string
  disabled?: boolean
}

interface SummaryBannerViewModel {
  id: 'plan' | 'weekly' | 'progress'
  title: string
  subtitle?: string
  actionText?: string
  tone: 'green' | 'blue' | 'warm'
}

interface HomeUiViewModel {
  journey: {
    title: string
    dayText: string
    dateText: string
    atmosphereText?: string
    completed: boolean
  }
  world: {
    state: WorldState
    assets: WorldAssetSet
    transition: WorldTransition
    discoveries: WorldDiscoveryView[]
    discoveryCount: number
    companionStage: string
    companionMood: string
    companionAsset: ResolvedCompanionAsset
    companionName: string
    companionMessage: string
    plantText: string
    pathText: string
    waterText: string
    energyValue: number
    energyMax: number
    nextUnlockVisible: boolean
    nextUnlockTitle: string
    nextUnlockDescription: string
    nextUnlockImage?: string
  }
  tasks: HomeTaskViewModel[]
  summaryBanners: SummaryBannerViewModel[]
}
```

`IndexPageData` 增加 `homeUi: HomeUiViewModel`，并提供不含模拟业务数据的空展示值。`refreshAll()` 仍是唯一真实刷新入口：先执行原有计划、DailyRecord、MealRecord、任务、轻能量、伙伴、世界、发现与总结逻辑，再统一转换为 `homeUi` 并随原字段一起 `setData`。

首页事件映射必须保留：任务 `meal_any` → 原记录一餐逻辑，`exercise_min` → 原运动输入，`water_goal` → 原喝水增加；伙伴 → `onClickCompanion`；旅程 → `onOpenJourney`；发现 → `onWorldDiscoveryTap` / `onOpenDiscoveries`；下一解锁 → `onNextUnlockTap`；计划/周总结/进展 → 原有导航方法。

## 集成约束

- 组件路径统一使用绝对小程序路径 `/components/.../index`。
- 页面和组件 JSON 必须可被 `JSON.parse` 解析。
- 所有新组件使用 `styleIsolation: "isolated"`；Token 在组件 WXSS 中显式导入。
- 首页不得写死整页高度；必须保留底部安全区，宽度采用 `box-sizing: border-box` 和可收缩 flex 内容。
- 正式 WebP 发现素材继续由现有配置和 Service 提供，不提交静态业务假数据。
- 基线 `ce18793` 已存在缺少 `HomeTaskViewModel`、`HomeTaskStatus`、`HomeTaskIndicator`、`HomeUiViewModel` 定义的 4 个 TypeScript 错误；线程 D 在首页独占文件内补齐类型和 `homeUi` 数据绑定，不改变业务计算。
