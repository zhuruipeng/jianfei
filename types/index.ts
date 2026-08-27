// types/index.ts - 业务类型定义

/**
 * 每日记录（唯一权威数据源）
 * 积分/完成度均通过本结构动态计算，不保存累计字段，避免重复奖励
 */
export interface DailyRecord {
  date: string;                 // YYYY-MM-DD
  breakfastCompleted: boolean;
  lunchCompleted: boolean;
  dinnerCompleted: boolean;
  exerciseMinutes: number;      // 0~无限，完成判定 >= 当日 effective goal（snapshot→plan→常量回退）
  waterCups: number;            // 0~无限，完成判定 >= 当日 effective goal
  /** V10：当日运动目标快照（分钟）。一旦写入即冻结，修改目标只影响当天及以后 */
  exerciseGoalMinutesSnapshot?: number;
  /** V10：当日喝水目标快照（杯） */
  waterGoalCupsSnapshot?: number;
}

export const EXERCISE_TARGET_MINUTES = 30;   // 兜底常量（无 plan、无 snapshot 时使用）
export const WATER_TARGET_CUPS = 8;          // 兜底常量

/** 任务奖励（固定） */
export const REWARD = {
  BREAKFAST: 10,
  LUNCH: 10,
  DINNER: 10,
  EXERCISE: 30,
  WATER: 10
};

export const TOTAL_TASKS = 5;

/** 每个任务的唯一标识 */
export type TaskKey =
  | 'breakfast'
  | 'lunch'
  | 'dinner'
  | 'exercise'
  | 'water';

/** 今日汇总（从 DailyRecord 派生计算） */
export interface DailySummary {
  points: number;
  completionPercent: number;
  completedTasks: TaskKey[];
}

/** Storage Key 前缀 */
export const STORAGE_PREFIX_DAILY = 'daily_record_';
export const STORAGE_KEY_FIRST_DATE = 'app_first_launch_date';
export const STORAGE_KEY_REWARDS = 'rewards';
export const STORAGE_KEY_MEAL_RECORDS = 'meal_records';
/** 迁移标记：某个日期的 DailyRecord.xxxCompleted -> MealRecord 的迁移已经跑过（防止重复创建） */
export const STORAGE_KEY_MEAL_MIGRATED_PREFIX = 'meal_migrated_v1_';  // + date
/** V6：匿名用户 ID 持久化（u_xxxxxxxxxx） */
export const STORAGE_KEY_ANONYMOUS_USER_ID = 'anonymous_user_id_v1';
/** V6：用户是否已经同意"AI 分析时照片会上传到云端"的首次说明（showModal 确认一次即永久） */
export const STORAGE_KEY_AI_UPLOAD_CONSENT = 'ai_photo_upload_consent_v1';

// ================================================================
// 三餐记录（权威完成态：三餐必须存在 MealRecord 才算完成）
// ================================================================
export type MealType = 'breakfast' | 'lunch' | 'dinner';

/** 饱腹程度（存枚举值，不存 Emoji/中文） */
export type SatietyLevel =
  | 'seven_tenths'
  | 'just_right'
  | 'a_little_full'
  | 'overfull';

/** 饮食标签（多选，存英文 key，V8 统一为 9 个，与云函数 analyzeMeal 的 TAG_CN 对齐）
 *  - 老数据里可能出现 has_veg / has_sweets / has_sweet_drink / night_snack：utils/meal.loadMealRecords 内自动 normalize 为新 key，不丢
 */
export type MealTagKey =
  | 'has_vegetables'
  | 'has_protein'
  | 'has_staple'
  | 'has_soup'
  | 'has_fruit'
  | 'has_snack'
  | 'has_sugary'
  | 'has_oil'
  | 'eating_out';

/** AI 分析状态：none 未触发 / uploaded 已上传待分析 / analyzing 分析中 / completed 分析完成 / failed 上传或分析失败 */
export type AiStatus = 'none' | 'uploaded' | 'analyzing' | 'completed' | 'failed';

export interface MealRecord {
  id: string;
  date: string;                      // YYYY-MM-DD
  mealType: MealType;                // 早餐/午餐/晚餐
  foodText?: string;                 // "吃了什么"自由文本（最多 ~100 字；可空）
  satietyLevel?: SatietyLevel;       // 饱腹（可空）
  tags: MealTagKey[];                // 多选标签（默认空数组）
  note?: string;                     // 备注（最多 ~200 字；可空）
  photoPath?: string;                // V5：本地永久照片路径
  // ===== V6：AI / 云端 =====
  cloudImageId?: string;             // 云存储文件 ID（默认私有）
  cloudImageUrl?: string;            // 临时/永久公开访问地址（下一阶段按需生成，默认空，不主动公开）
  aiStatus?: AiStatus;               // 分析链路状态（可空，兼容旧记录 = none）
  // ===== V7：AI 分析结果（可空；成功 completed 时填充）=====
  aiAnalysis?: MealAnalysis;
  createdAt: string;
  updatedAt?: string;
  /** 内部标记：是否从 DailyRecord.xxxCompleted=true 的旧数据自动迁移生成（只展示区分用） */
  migratedFromLegacy?: boolean;
}

/** 长度限制 */
export const MEAL_FOOD_TEXT_MAX = 100;
export const MEAL_NOTE_MAX = 200;

/** 中文展示映射（餐次名） */
export const MEAL_TYPE_LABEL: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐'
};

/** 饱腹程度中文映射 */
export const SATIETY_LABEL: Record<SatietyLevel, string> = {
  seven_tenths:  '七分饱',
  just_right:    '刚刚好',
  a_little_full: '有点撑',
  overfull:      '吃撑了'
};
export const SATIETY_EMOJI: Record<SatietyLevel, string> = {
  seven_tenths:  '🟟',
  just_right:    '🟟',
  a_little_full: '🟟',
  overfull:      '🟟'
};
export const SATIETY_ORDER: SatietyLevel[] = ['seven_tenths', 'just_right', 'a_little_full', 'overfull'];

/** 标签展示（key → 中文，9 个与云函数 TAG_CN 完全对齐） */
export interface MealTagDef {
  key: MealTagKey;
  label: string;
  emoji: string;
}
export const MEAL_TAG_LIST: MealTagDef[] = [
  { key: 'has_vegetables', label: '有蔬菜',   emoji: '🟟' },
  { key: 'has_protein',    label: '有蛋白质', emoji: '🟟' },
  { key: 'has_staple',     label: '有主食',   emoji: '🟟' },
  { key: 'has_soup',       label: '有汤/粥',  emoji: '🟟' },
  { key: 'has_fruit',      label: '有水果',   emoji: '🟟' },
  { key: 'has_snack',      label: '有零食',   emoji: '🟟' },
  { key: 'has_sugary',     label: '明显高糖', emoji: '🟟' },
  { key: 'has_oil',        label: '明显高油', emoji: '🟟' },
  { key: 'eating_out',     label: '外卖/外食', emoji: '🟟' },
];

/** 旧 key → 新 key 映射表（loadMealRecords 时自动 normalize，保证历史数据不丢失、不出现 unknown） */
export const LEGACY_MEAL_TAG_KEY_MAP: Record<string, MealTagKey> = {
  has_veg:         'has_vegetables',
  has_sweets:      'has_snack',
  has_sweet_drink: 'has_sugary',
  night_snack:     'has_snack',
};


/** 用户自定义奖励 */
export interface Reward {
  id: string;               // 唯一 id
  title: string;            // 奖励名称
  emoji: string;            // 表情符号，默认 🟟
  requiredPoints: number;   // 需要累计积分（最低 10）
  redeemed: boolean;        // 是否已领取
  redeemedAt?: string;      // 领取时间 YYYY-MM-DD HH:mm:ss
  createdAt: string;        // 创建时间 YYYY-MM-DD HH:mm:ss
}

/** 默认奖励（首次进入奖励页面且 rewards 为空时预置） */
export const DEFAULT_REWARDS: Omit<Reward, 'id' | 'createdAt'>[] = [
  { title: '喝一杯喜欢的咖啡', emoji: '☕', requiredPoints: 100, redeemed: false },
  { title: '看一场电影',       emoji: '🎬', requiredPoints: 300, redeemed: false },
  { title: '给自己买一件喜欢的小东西', emoji: '🎁', requiredPoints: 500, redeemed: false }
];

export const DEFAULT_EMOJI = '🟟';
export const REWARD_REQUIRED_POINTS_MIN = 10;
export const REWARD_REQUIRED_POINTS_MAX = 100000;
export const REWARD_TITLE_MAX_LENGTH = 20;

// ================================================================
// 体重记录
// ================================================================
export interface WeightRecord {
  id: string;
  date: string;          // YYYY-MM-DD（同一天只保留 1 条）
  weight: number;        // kg，保留 1 位小数，20 < x < 300
  createdAt: string;     // "YYYY-MM-DD HH:mm:ss"
  updatedAt?: string;    // 同一天覆盖更新时填
}

export const STORAGE_KEY_WEIGHT_RECORDS = 'weight_records';
export const WEIGHT_MIN = 20;          // 严格大于
export const WEIGHT_MAX = 300;         // 严格小于
export const WEIGHT_DECIMALS = 1;      // 最多 1 位小数
export const WEIGHT_TREND_DAYS = 30;   // 趋势图最近 30 天
export const WEIGHT_RECENT_LIMIT = 10; // 最近记录列表条数

/** 温和提示文案池（记录完成/进展页顶部随机展示） */
export const WEIGHT_GENTLE_MESSAGES: string[] = [
  '体重会自然波动，\n关注长期趋势就好。',
  '记录是为了看见自己，\n不是为了苛责。',
  '你比昨天更了解自己一点，\n这就很棒啦。',
  '数字只是参考，\n身体的感受更重要。',
  '慢慢来，\n每一次记录都算数。',
  '曲线比单日数字更有意义。',
  '继续保持自己的节奏，\n你做得很好。'
];


/** 鼓励文案池，随机抽一条 */
export const ENCOURAGE_MESSAGES: string[] = [
  '今天不用完美，\n完成一点就是进步。',
  '轻一点，慢一点，\n你已经很棒啦。',
  '小目标，慢慢来，\n坚持本身就是意义。',
  '每一次小小的选择，\n都在让未来的你更轻盈。',
  '别想太多，\n先完成今天的第一口。',
  '你比昨天又多走了一步，\n真的很了不起。',
  '对自己温柔一点，\n慢慢来也没关系。'
];

// ================================================================
// V7：AI 饮食分析 V1（结构化定性，不输出精确卡路里/克数）
// ================================================================
/** 饮食分析结果：围绕「观察 + 1 条小建议」，不以卡路里/克数/分数为核心指标 */
export interface MealAnalysis {
  /** 主要食物（能合理确认才填，看不清不要乱猜） */
  foods: string[];
  /** 整体分量：light 偏少 / appropriate 合适 / heavy 偏多 / unknown 无法判断 */
  portionLevel: 'light' | 'appropriate' | 'heavy' | 'unknown';
  /** 蔬菜量 */
  vegetables: 'low' | 'adequate' | 'unknown';
  /** 蛋白质量 */
  protein:    'low' | 'adequate' | 'unknown';
  /** 主食量（比蔬菜/蛋白多一档：可高） */
  stapleFood: 'low' | 'adequate' | 'high' | 'unknown';
  /** 是否含糖饮料 */
  sugaryDrink: 'yes' | 'no' | 'unknown';
  /** 一段简短中文观察总结（例如："这一餐有饭、有菜、有肉，搭配比较均衡。"） */
  summary: string;
  /** V7：唯一一条「下一餐小调整」建议（永远只给 1 条，不超过约 40 字；语气温和） */
  primarySuggestion: string;
  /** AI 内部置信度：low 时 UI 提示"照片信息有限，仅供参考"，不显示百分比 */
  confidence: 'low' | 'medium' | 'high';
  /** 分析完成时间 YYYY-MM-DD HH:mm:ss（由服务端写入，不信任客户端时钟） */
  analyzedAt: string;
}

/** 云端 analyzeMeal 云函数/后端入口返回结构（V7：status=ok 时 analysis 有值） */
export interface MealAnalysisResponse {
  success: boolean;
  status: 'not_implemented' | 'ok' | 'error';
  message?: string;
  analysis?: MealAnalysis;
}

// =========================================================================
// V8：全局统一 UI 文案 + 首次引导 + 空状态
// =========================================================================

/** 用户选择的坚持天数目标（只问一次：7/28/90，默认 28） */
export const GOAL_DAY_OPTIONS = [7, 28, 90] as const;
export type GoalDaysOption = typeof GOAL_DAY_OPTIONS[number];
export const DEFAULT_GOAL_DAYS: GoalDaysOption = 28;
export const STORAGE_KEY_GOAL_DAYS = 'goal_days_v1';
/** 引导是否已完成（首次进入小程序弹设置天数页） */
export const STORAGE_KEY_ONBOARDING_DONE = 'onboarding_done_v1';
/** 欢迎卡显示一次（首次显示完首页 welcome 卡片后置 1） */
export const STORAGE_KEY_HOME_WELCOME_SHOWN = 'home_welcome_shown_v1';

/** 用户统一错误文案（所有 showToast/showModal 尽量使用这些，禁止把技术错误透出给用户） */
export const UI_MSG = {
  NETWORK:           '网络暂时不可用，稍后再试。',
  AI_FAILED:         '这次没有分析成功，可以稍后重新试试。',
  IMAGE_BROKEN:      '照片暂时无法显示，可以重新选择。',
  IMAGE_DELETE_FAIL: '照片删除失败，可以再试一次。',
  STORAGE_SAVE_FAIL: '保存没有成功，请再试一次。',
  RECORD_NOT_FOUND:  '记录不存在，可能已被删除。',
  INVALID_INPUT:     '填写的内容有点问题，请检查一下。',
} as const;

/** 主要页面空状态文案（统一语气：温和 + 提供下一步动作） */
export const EMPTY_MSG = {
  NO_WEIGHT_RECORDS_TITLE: '还没有体重记录',
  NO_WEIGHT_RECORDS_BODY:  '第一次记录以后，\n这里会慢慢出现你的变化趋势。',
  NO_REWARDS_TITLE:        '还没有给自己设置奖励',
  NO_REWARDS_BODY:         '给坚持这件事一点期待。',
  NO_MEAL_RECORDED:        '还没有记录',
} as const;


// =========================================================================
// V9：最小本地行为统计（7 天真实用户测试使用，数据最小化）
// =========================================================================

/**
 * UsageEvent —— 所有埋点统一走此结构，保存在 storage usage_events 中
 *  - 永远不写入：食物内容 / 真实体重数字 / 奖励名称 / 用户照片 / 个人身份信息
 *  - metadata 只允许 string | number | boolean（方便后续筛选统计）
 */
export interface UsageEvent {
  id: string;                            // 本地唯一 id，时间戳 + 随机
  eventName: UsageEventName;             // 事件名称（枚举，只允许列出的）
  date: string;                          // 事件所属日期 YYYY-MM-DD
  timestamp: string;                     // ISO 时间字符串（本地时钟）
  metadata?: UsageEventMetadata;         // 可空，只存非敏感派生信息
}

export type UsageEventMetadata = Record<string, string | number | boolean | undefined>;

/** 固定事件名（不要乱加；只有能回答"用户为什么留下/离开"的才添加） */
export const USAGE_EVENT_NAMES = {
  APP_FIRST_OPEN:         'app_first_open',            // 安装后第 1 次打开（只 1 次）
  APP_OPEN:               'app_open',                  // 冷启动/回前台 算 1 次（同一日可能多次）

  MEAL_CREATED:           'meal_created',              // 第一次创建（留存量主要看这个）
  MEAL_UPDATED:           'meal_updated',              // 修改同一顿（不计入"完成几餐"）
  MEAL_PHOTO_ADDED:       'meal_photo_added',          // 添加照片（不含照片内容）

  EXERCISE_SAVED:         'exercise_saved',            // 运动保存（minutes + goalReached）
  WATER_GOAL_REACHED:     'water_goal_reached',        // 喝水达成 8 杯（每日首次）

  WEIGHT_SAVED:           'weight_saved',              // 体重记录（只带 isFirstWeightRecord，不带真实 kg）

  REWARD_CREATED:         'reward_created',            // 创建奖励（requiredPoints，不带名称）
  REWARD_UNLOCKED:        'reward_unlocked',           // 达到 requiredPoints
  REWARD_REDEEMED:        'reward_redeemed',           // 用户点击领取

  AI_ANALYSIS_STARTED:    'ai_analysis_started',       // 点击 AI 分析（上传后或直接开始分析）
  AI_ANALYSIS_SUCCEEDED:  'ai_analysis_succeeded',     // analyzeMeal status=ok 且分析完整
  AI_ANALYSIS_FAILED:     'ai_analysis_failed',        // 上传或分析失败

  // 最小性能（不发送云端，只本地统计）
  PERF_APP_LAUNCH:        'perf_app_launch_ms',        // App 启动耗时
  PERF_MEAL_SAVE:         'perf_meal_save_ms',         // 餐次保存耗时（本地 setStorage 部分）
} as const;
export type UsageEventName = (typeof USAGE_EVENT_NAMES)[keyof typeof USAGE_EVENT_NAMES];

export const STORAGE_KEY_USAGE_EVENTS = 'usage_events';
export const STORAGE_KEY_USAGE_FIRST_OPEN_DONE = 'usage_first_open_done_v1';  // 防止重复 app_first_open
export const STORAGE_KEY_WATER_GOAL_REACHED_BY_DATE = 'water_goal_reached_flag_v1_';  // + date（防一天多次记录 water_goal_reached）


// =========================================================================
// V9：用户反馈（本地保存；先不做后台）
// =========================================================================

export type FeedbackRating = 'good' | 'okay' | 'difficult';

export interface UserFeedback {
  id: string;                                   // 本地唯一
  rating: FeedbackRating;                       // 很好用 / 还可以 / 有点麻烦
  content?: string;                             // 自由输入，最多 300 字
  createdAt: string;                            // YYYY-MM-DD HH:mm:ss（本地时间）
}

export const STORAGE_KEY_USER_FEEDBACK = 'user_feedback';
export const FEEDBACK_CONTENT_MAX = 300;
export const FEEDBACK_RATING_LABEL: Record<FeedbackRating, string> = {
  good:      '很好用',
  okay:      '还可以',
  difficult: '有点麻烦',
};

// ----- V11：反馈云端提交 -----
/** 服务端反馈状态：新反馈 / 已读 / 已处理 */
export type FeedbackStatus = 'new' | 'read' | 'resolved';

/** 提交到云端 / 云数据库存储的反馈记录（服务端权威结构） */
export interface CloudFeedback {
  _id?: string;                       // 云数据库自动 id（管理员端读取时会有）
  id: string;                         // 业务 id（前端生成，便于跨端对齐）
  anonymousUserId: string;            // u_xxxxxxxxxx（不携带任何 PII）
  rating: FeedbackRating;
  content?: string;                   // ≤ 300 字，可空
  appVersion?: string;                // 小程序版本，可空
  createdAt: string;                  // ISO 字符串
  status: FeedbackStatus;             // 默认 'new'
}

/** 本地待重试队列项（提交失败时缓存，下次进入反馈页提示重试） */
export interface PendingFeedback {
  id: string;                         // 本地 id（与 CloudFeedback.id 复用）
  rating: FeedbackRating;
  content?: string;
  appVersion?: string;
  createdAt: string;                  // 用户最初填写时间
  pendingSince: string;               // 进入待重试队列的时间
  retryCount: number;                 // 已重试次数（仅展示，不做硬限制）
}

/** 本地待重试队列 storage key（与历史 user_feedback 分开，不混用） */
export const STORAGE_KEY_PENDING_FEEDBACK = 'pending_feedback';

/** 云函数名 */
export const CLOUD_FUNC_SUBMIT_FEEDBACK = 'submitFeedback';

/** 提交反馈相关文案（温和、非压力） */
export const FEEDBACK_MSG = {
  SUBMITTING:    '正在提交...',
  SUCCESS:       '谢谢你的反馈。\n我们会继续把记录这件事做得更简单。',
  FAIL_OFFLINE:  '这次没有提交成功。\n你的反馈已经暂时保存在本机，可以稍后重新提交。',
  FAIL:          '这次没有提交成功。\n你的反馈已经暂时保存在本机，可以稍后重新提交。',
  PENDING_HINT:  '你有1条反馈还没有成功提交。',
  RETRY_BTN:     '重新提交',
  RETRY_OK:      '之前的反馈已经提交成功啦。',
} as const;


// =========================================================================
// V10：28 天计划 + 周总结 V1
// =========================================================================

/** 计划状态：进行中 / 已完成 / 用户主动停止 */
export type PlanStatus = 'active' | 'completed' | 'stopped';

/**
 * 用户计划（同时只允许一个 active；历史 plan 存 user_plan_history）
 *  - startDate 当天 = Day1（自然日计算）
 *  - durationDays 与 onboarding GOAL_DAY_OPTIONS 对齐：7/28/90
 *  - exerciseGoalMinutes / waterGoalCups 可在 plan-settings 修改；修改只影响当天及以后
 */
export interface UserPlan {
  id: string;                          // r_yyyymmddHHMMss_xxxx
  startDate: string;                   // YYYY-MM-DD（首日 = Day1）
  durationDays: 7 | 28 | 90;
  exerciseGoalMinutes: number;         // 15 / 30 / 45 / 60
  waterGoalCups: number;               // 6 / 8 / 10
  startWeight?: number;                // 计划开始体重（可选，仅展示）
  targetWeight?: number;               // 目标体重（可选，仅展示）
  status: PlanStatus;
  createdAt: string;                   // YYYY-MM-DD HH:mm:ss
  completedAt?: string;                // status=completed 时填
  stoppedAt?: string;                  // status=stopped 时填
}

export const STORAGE_KEY_USER_PLAN = 'user_plan';                 // 当前 active plan（UserPlan | null）
export const STORAGE_KEY_USER_PLAN_HISTORY = 'user_plan_history'; // 已结束的 plan 数组

export const EXERCISE_GOAL_OPTIONS = [15, 30, 45, 60] as const;
export type ExerciseGoalOption = typeof EXERCISE_GOAL_OPTIONS[number];
export const DEFAULT_EXERCISE_GOAL_MINUTES = 30;

export const WATER_GOAL_OPTIONS = [6, 8, 10] as const;
export type WaterGoalOption = typeof WATER_GOAL_OPTIONS[number];
export const DEFAULT_WATER_GOAL_CUPS = 8;

/** 兼容旧用户：首页"加入 28 天计划"提示卡 dismissed 标记 */
export const STORAGE_KEY_PLAN_SETUP_DISMISSED = 'plan_setup_dismissed_v1';

/**
 * 周总结（按 7 天自然区间快照保存，不随后漂移）
 *  - 一旦生成即冻结：用户后来修改历史记录不会影响已生成的 summary（需求三十三条）
 *  - 数据从 MealRecord/DailyRecord/WeightRecord/Reward/UsageEvent 动态计算
 */
export interface WeeklySummary {
  id: string;                          // ws_yyyymmddHHMMss_xxxx
  planId: string;
  weekNumber: number;                   // 1-based
  startDate: string;                   // YYYY-MM-DD（自然周首日）
  endDate: string;                     // YYYY-MM-DD（自然周末日）
  activeDays: number;                  // 当周有 APP_OPEN 的天数
  meaningfulDays: number;               // 当周有任意 meal/exercise/water/weight 记录的天数
  mealCount: number;                   // 当周 MealRecord 总数
  breakfastCount: number;
  lunchCount: number;
  dinnerCount: number;
  exerciseGoalDays: number;             // 当周运动达标天数（按当日 snapshot goal 判定）
  waterGoalDays: number;               // 当周喝水达标天数
  weightStart?: number;                 // 当周首条体重
  weightEnd?: number;                   // 当周末条体重
  weightChange?: number;               // weightEnd - weightStart（都有才有）
  pointsEarned: number;                 // 当周每日 calculatePoints 累加
  rewardsUnlocked: number;              // 当周 reward_unlocked 事件数
  rewardsRedeemed: number;              // 当周 reward_redeemed 事件数
  aiAnalysisCount: number;              // 当周 ai_analysis_succeeded 事件数
  createdAt: string;
}

export const STORAGE_KEY_WEEKLY_SUMMARIES = 'weekly_summaries';   // WeeklySummary[]
export const STORAGE_PREFIX_WEEKLY_VIEWED = 'weekly_summary_viewed_';  // + <planId>_<weekNumber> = true

/** 周总结规则文案池（不调 AI，规则生成一句鼓励总结；禁止评分/羞辱） */
export const WEEKLY_SUMMARY_MESSAGES: string[] = [
  '这一周你认真记下来了，\n看见自己就是改变的开始。',
  '数据不会骗人，\n这一周你比想象中更努力。',
  '一周的坚持已经攒下了不少，\n慢慢来，下一周继续。',
  '记录的意义是"看见"，\n你做到了。',
];

/** 28/90 天计划总结文案池 */
export const PLAN_SUMMARY_MESSAGES: string[] = [
  '走完了一段路，\n下一步随时可以开始。',
  '这么多天的记录都是你的，\n不丢、不重。',
  '完成本身不是终点，\n是你对自己温柔的证明。',
];

/** 体重展示温和兜底文案（周总结内体重数据不足 2 条时） */
export const WEEKLY_WEIGHT_GENTLE_FALLBACK = '体重数据还比较少，\n下周再看看趋势。';

/** 周总结"继续下一周"等通用温和文案 */
export const WEEKLY_NO_WEIGHT_GENTLE = '这一周没有体重记录。\n没关系，饮食和运动习惯本身也值得记录。';


// =========================================================================
// V12：小轻养成系统 V1（轻能量 + 每日3任务 + 旅程）
// =========================================================================

// ---------------- 轻能量账本（唯一权威数据源，禁止额外维护 total 字段）----------------
export type EnergySource =
  | 'daily_task'          // 每日3核心任务之一（sourceId = taskKey）
  | 'daily_all_complete'  // 当日3任务全完成额外奖励（sourceId = date）
  | 'special_task'        // 每日特别任务完成（sourceId = date）
  | 'growth_bonus';       // 其他一次性奖励（例如旧用户 +50，sourceId = 'welcome_v1'）

export interface EnergyLedger {
  id: string;                     // el_yyyymmddHHMMss_xxxx
  date: string;                   // YYYY-MM-DD
  source: EnergySource;
  sourceId: string;               // 同 (date + source + sourceId) 全局唯一 = 一次发放
  amount: number;                 // 正整数（能量只增不减）
  createdAt: string;              // ISO 字符串
}
export const STORAGE_KEY_ENERGY_LEDGER = 'energy_ledger';

// ---------------- 每日3核心任务（与现有记录映射，不新建第二套状态） ----------------
export type DailyTaskKey = 'meal_any' | 'exercise_min' | 'water_goal';

export interface DailyTaskDef {
  key: DailyTaskKey;
  title: string;
  emoji: string;
  amountPerTask: number;    // 完成一个得多少能量（固定 20）
  allCompleteBonus: number; // 三个全完成额外奖励（固定 20）
}

export const DAILY_TASK_CONFIG: DailyTaskDef[] = [
  { key: 'meal_any',     title: '记录一餐',         emoji: '🥗', amountPerTask: 20, allCompleteBonus: 20 },
  { key: 'exercise_min', title: '动一动',           emoji: '🚶', amountPerTask: 20, allCompleteBonus: 20 },
  { key: 'water_goal',   title: '完成今天的喝水目标', emoji: '💧', amountPerTask: 20, allCompleteBonus: 20 },
];

// ---------------- 伙伴状态 ----------------
export interface CompanionState {
  companionId: string;       // 默认 'c_001'（V12 只有一只）
  name: string;              // 用户起名（默认 "小轻"；≤8 中文字符）
  createdAt: string;         // 创建时间（旧用户升级那天）
  unlockedTitles: string[];  // 已解锁称号（对应等级），不重复
  lastLevelUpAt?: string;    // 最近一次升级时间（仅展示用）
  lastKnownLevel?: number;   // 仅用于升级弹层检测（等级根据 totalEnergy 重新算，这里只做缓存对比）
}
export const STORAGE_KEY_COMPANION_STATE = 'companion_state_v1';

// 小轻名字
export const COMPANION_DEFAULT_NAME = '小轻';
export const COMPANION_NAME_MAX_LEN = 8;

// ---------------- 成长配置（集中，不要散落硬编码） ----------------
export interface GrowthLevel {
  level: number;        // 1~7
  name: string;         // 阶段名：初遇 / 发芽 / ...
  title: string;        // 对应称号，达到即解锁
  visualStage: 1 | 2 | 3 | 4;  // 4 个视觉阶段
  requiredEnergy: number;      // 到达此等级所需"累计轻能量"（Lv.1 = 0 起步）
}

export const GROWTH_CONFIG: GrowthLevel[] = [
  { level: 1, name: '初遇',     title: '🌱 开始行动', visualStage: 1, requiredEnergy: 0 },
  { level: 2, name: '发芽',     title: '👟 小步出发', visualStage: 2, requiredEnergy: 100 },
  { level: 3, name: '出发',     title: '🌿 渐渐习惯', visualStage: 2, requiredEnergy: 250 },
  { level: 4, name: '成长',     title: '⭐ 坚持的人', visualStage: 3, requiredEnergy: 500 },
  { level: 5, name: '坚持',     title: '🌙 稳稳向前', visualStage: 3, requiredEnergy: 900 },
  { level: 6, name: '闪光',     title: '✨ 闪闪发光', visualStage: 4, requiredEnergy: 1400 },
  { level: 7, name: '轻旅完成', title: '🏕️ 轻旅完成', visualStage: 4, requiredEnergy: 2000 },
];

// 每日3任务对应文案（温和、非压力）
export const COMPANION_DAILY_MSGS: Record<'0' | '1' | '2' | '3', string[]> = {
  '0': [
    '小轻刚醒来。\n今天先完成一件小事就好。',
    '新的一天开始啦，\n先做一件小事吧。',
  ],
  '1': [
    '已经开始啦。\n再完成一点点就很好。',
    '有进展了，\n慢慢来不着急。',
  ],
  '2': [
    '今天已经完成两件事。\n离全部完成只差一步。',
    '就快完成啦，\n再完成一件就好。',
  ],
  '3': [
    '今天的三件小事都完成了 ✨\n小轻也获得了新的能量。',
    '今天的你超棒 ✨\n小轻和你一起加油。',
  ],
};

// ---------------- 特别任务（日期固定生成，不要真正随机） ----------------
export const SPECIAL_TASK_POOL: string[] = [
  '任选一餐多加一种蔬菜',
  '饭后散步10分钟',
  '今天不喝含糖饮料',
  '吃饭时慢一点',
  '任选一餐拍下来记录',
  '今天提前10分钟停止刷手机准备睡觉',
];

/** 特别任务：同一天、同一个日期 -> 稳定得到同一内容（不跳过时无记录，跳过用另一个 key） */
export const SPECIAL_TASK_AMOUNT = 30;
export const STORAGE_KEY_SPECIAL_TASK_SKIPPED_PREFIX = 'special_task_skipped_v1_';  // + date
export const STORAGE_KEY_COMPANION_INTRO_SHOWN = 'companion_intro_shown_v1';   // 旧用户首次欢迎
export const STORAGE_KEY_COMPANION_WELCOME_GIVEN = 'companion_welcome_v1_given';  // 旧用户 +50 一次性发放（防重）

// ---------------- 旅程站点（28天计划 5 个里程碑） ----------------
export interface JourneyStop {
  planDay: 1 | 7 | 14 | 21 | 28;
  name: string;          // 站点名：初遇 / 森林入口 / 湖边 / 星光营地 / 山顶
  hint: string;          // 提示文案
}
export const JOURNEY_STOPS: JourneyStop[] = [
  { planDay: 1,  name: '初遇',     hint: '小轻和你一起开始' },
  { planDay: 7,  name: '森林入口', hint: '一周，一起迈出了第一步' },
  { planDay: 14, name: '湖边',     hint: '坚持的感觉慢慢出现了' },
  { planDay: 21, name: '星光营地', hint: '已经走了大半个旅程' },
  { planDay: 28, name: '山顶',     hint: '28天轻旅完成' },
];

// ---------------- 养成埋点事件（新增，最小） ----------------
export const COMPANION_USAGE_EVENTS = {
  COMPANION_CREATED:       'companion_created',         // 首次创建伙伴（含旧用户升级欢迎）
  ENERGY_EARNED:           'energy_earned',              // 每次获得轻能量（记录 amount + source，不记录内容）
  COMPANION_LEVEL_UP:      'companion_level_up',         // 升级（记录 newLevel + energyTotal）
  SPECIAL_TASK_COMPLETED:  'special_task_completed',     // 用户主动完成特别任务（不记录具体任务内容）
  JOURNEY_VIEWED:          'journey_viewed',             // 查看旅程地图页
} as const;
// 追加到 UsageEventName 是危险的（全局枚举会改动），这里不混进 UsageEventName，仅在 usageService 新增包装函数接受这 5 个事件名即可。
export type CompanionEventName =
  | 'companion_created'
  | 'energy_earned'
  | 'companion_level_up'
  | 'special_task_completed'
  | 'journey_viewed';

// V12：养成数据开发测试页专用（仅开发环境按钮，正式版隐藏按钮容器）
export const DEV_COMPANION_META = {
  ENERGY_STEP_20:  20,
  ENERGY_STEP_100: 100,
} as const;

// =========================================================================
// V12.1：小轻情绪 + 角色视觉 + 旅程收藏卡
// =========================================================================

// ---------------- 情绪（只有正/中性，不做生气/悲伤/饥饿/生病） ----------------
export type CompanionMood =
  | 'neutral'     // 平静
  | 'happy'       // 开心（任务完成、升级、3/3 仪式感）
  | 'encouraging'; // 鼓励（0/3 当天，欢迎回归昨天没完成的日子）

export type CompanionVisualStage =
  | 'seed'      // Lv.1：一颗准备发芽的小种子 / 小蛋
  | 'baby'      // Lv.2 - Lv.3：小轻正式出现，一片叶子
  | 'growing'   // Lv.4 - Lv.5：身体修长 + 小背包，"旅行中"
  | 'grown';    // Lv.6 - Lv.7：完整形态，披肩 / 小旅行包，"旅程完成"

/** 把旧 visualStage:1|2|3|4 映射到新的文字枚举，保持兼容 */
export const VISUAL_STAGE_NUMBER_TO_KEY: Record<1 | 2 | 3 | 4, CompanionVisualStage> = {
  1: 'seed',
  2: 'baby',
  3: 'growing',
  4: 'grown',
};

// ---------------- 角色素材路径常量（实际 PNG/WebP/SVG 目录，需求第25条先建目录，用统一 imageKey 映射） ----------------
/**
 * 角色素材统一目录。每个阶段 3 张 = 12 张（seed/baby/growing/grown）×（neutral/happy/encouraging）
 * 命名：companion_{stage}_{mood}.webp  或 .png 或 .svg
 * 实际图片由美术提供后直接替换文件，不需要改业务代码。
 */
export const COMPANION_ASSET_DIR = '/assets/companion';

/** 旅程收藏卡素材统一目录，5 张（day1 / day7 / day14 / day21 / day28） */
export const JOURNEY_CARD_ASSET_DIR = '/assets/journey';

// ---------------- 旅程收藏卡 ----------------
export interface JourneyCard {
  id: string;                    // 静态 id，例如 'day1'
  dayRequired: 1 | 7 | 14 | 21 | 28;
  title: string;                 // 🌱 初遇
  shortTitle: string;            // 初遇（用于小卡片）
  description: string;           // 我们从这里开始。
  extraLine?: string;            // 详情页底部额外一句（"有些改变很小..."）
  imageKey: string;              // 'day1' / 'day7' / ... 由 companionAssets resolve 实际路径
  emoji: string;                 // 无图时代价占位：🌱 🌲 💧 🌙 ⛰️
}

export interface UnlockedJourneyCardState {
  id: string;           // 对应 JourneyCard.id
  unlockedAt: string;   // ISO 字符串，首次到达那天解锁
  planDayWhenUnlocked: number; // 解锁时所处的 planDay
}

export const STORAGE_KEY_JOURNEY_CARDS_UNLOCKED_V1 = 'journey_cards_unlocked_v1';

export const JOURNEY_CARDS: JourneyCard[] = [
  {
    id: 'day1',
    dayRequired: 1,
    title: '🌱 初遇',
    shortTitle: '初遇',
    description: '我们从这里开始。',
    extraLine: '出发本身，就是一件值得记住的小事。',
    imageKey: 'day1',
    emoji: '🌱',
  },
  {
    id: 'day7',
    dayRequired: 7,
    title: '🌲 森林入口',
    shortTitle: '森林入口',
    description: '已经一起走了7天。',
    extraLine: '有些改变很小，但它们正在慢慢积累。',
    imageKey: 'day7',
    emoji: '🌲',
  },
  {
    id: 'day14',
    dayRequired: 14,
    title: '💧 湖边',
    shortTitle: '湖边',
    description: '慢慢走，也已经走了很远。',
    extraLine: '习惯开始变得轻松。',
    imageKey: 'day14',
    emoji: '💧',
  },
  {
    id: 'day21',
    dayRequired: 21,
    title: '🌙 星光营地',
    shortTitle: '星光营地',
    description: '坚持开始变成习惯。',
    extraLine: '你已经走了比想象中更远的路。',
    imageKey: 'day21',
    emoji: '🌙',
  },
  {
    id: 'day28',
    dayRequired: 28,
    title: '⛰️ 山顶',
    shortTitle: '山顶',
    description: '这一段轻旅完成了。',
    extraLine: '谢谢你陪小轻走到这里。',
    imageKey: 'day28',
    emoji: '⛰️',
  },
];

// ---------------- 养成埋点（V12.1 追加 3 个最小） ----------------
export const COMPANION_USAGE_EVENTS_EX = {
  COMPANION_TAPPED:        'companion_tapped',          // 首页点击小轻（有 interactionCooldown，不记录每一次疯狂点击）
  JOURNEY_CARD_UNLOCKED:   'journey_card_unlocked',     // 旅程卡解锁（记录 cardId + planDay）
  JOURNEY_CARD_VIEWED:     'journey_card_viewed',       // 在旅程页或首页查看卡详情（记录 cardId）
} as const;
export type CompanionEventNameV2 =
  | CompanionEventName
  | 'companion_tapped'
  | 'journey_card_unlocked'
  | 'journey_card_viewed';

// =========================================================================
// V13：小轻世界（只从真实业务数据派生，不保存视觉完成态）
// =========================================================================

export type WorldElementType = 'plant' | 'path' | 'water';
export type WorldLevel = 0 | 1 | 2 | 3 | 4;

export interface WorldUnlock {
  type: WorldElementType;
  nextLevel: WorldLevel;
  targetDays: number;
  remainingDays: number;
  text: string;
}

export interface WorldJourneyLandmark {
  visible: boolean;
  dayRequired: 7 | 14 | 21 | 28;
  title: string;
  emoji: string;
  hint: string;
}

/**
 * 小轻世界的完整派生状态。
 * 注意：这个对象不长期写入 Storage；每次都从 MealRecord / DailyRecord / UserPlan 重算。
 */
export interface WorldState {
  plantLevel: WorldLevel;
  pathLevel: WorldLevel;
  waterLevel: WorldLevel;

  mealActiveDays: number;
  exerciseGoalDays: number;
  waterGoalDays: number;

  todayMealCompleted: boolean;
  todayExerciseCompleted: boolean;
  todayWaterCompleted: boolean;
  todayAllCompleted: boolean;
  todayCompletedCount: 0 | 1 | 2 | 3;

  nextUnlock?: WorldUnlock;
  journeyLandmark: WorldJourneyLandmark;
  message: string;
}

/** 仅用于避免重复播放动画，不是业务完成态。 */
export interface WorldUiState {
  lastSeenPlantLevel: WorldLevel;
  lastSeenPathLevel: WorldLevel;
  lastSeenWaterLevel: WorldLevel;
  lastAllCompleteAnimationDate?: string;
}

export const STORAGE_KEY_WORLD_UI_STATE = 'world_ui_state_v1';

export type WorldTransitionKind =
  | ''
  | 'plant'
  | 'path'
  | 'water'
  | 'all'
  | 'plant-level'
  | 'path-level'
  | 'water-level';

export interface WorldTransition {
  kind: WorldTransitionKind;
  sequence: number;
  message: string;
  durationMs: number;
}
