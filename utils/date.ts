// utils/date.ts - 日期处理工具

/**
 * 获取今天的日期字符串 YYYY-MM-DD
 */
export function getTodayString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 格式化显示为中文友好格式，如 "8月19日"
 */
export function formatDateCN(dateStr: string): string {
  // dateStr: YYYY-MM-DD
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  return `${month}月${day}日`;
}

/**
 * 计算从 firstDate 到 today 的"第几天"
 * 今天是第一天：返回 1
 * 日期格式必须为 YYYY-MM-DD
 */
export function calculatePlanDay(firstDate: string, today: string): number {
  if (!firstDate || !today) return 1;
  const start = parseDate(firstDate);
  const end = parseDate(today);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 1;
  const diffMs = end.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  // 确保至少是第 1 天
  return diffDays >= 0 ? diffDays + 1 : 1;
}

function parseDate(dateStr: string): Date {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return new Date(NaN);
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  return new Date(y, m, d);
}

/**
 * 从鼓励文案池中随机选一条
 */
export function pickRandom<T>(arr: T[]): T {
  if (!arr || arr.length === 0) return undefined as unknown as T;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 格式化当前本地时间为 "YYYY-MM-DD HH:mm:ss"，用于 createdAt / redeemedAt
 */
export function formatDateTimeNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 生成一个简单的唯一 ID（足够用在本地 Storage 奖励 id）
 */
export function genLocalId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `r_${stamp}_${rand}`;
}

/**
 * 校验字符串是否形如 YYYY-MM-DD 的合法日期格式（仅格式，不校验真实日期范围）
 * 用于 meal/weight 存储时防止脏数据。
 */
export function isSameDayYYYYMMDD(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr || '');
}

/**
 * 包含首尾的天数差（today - startDate + 1）。
 *   与 calculatePlanDay 语义一致，也接受今天 < startDate 的情况（返回 1 兜底）。
 */
export function daysBetweenInclusive(startDate: string, today: string): number {
  return calculatePlanDay(startDate, today);
}

/** 别名：今天的 YYYY-MM-DD 字符串（services 层入口用，与 getTodayString 等价） */
export function formatDateToday(): string {
  return getTodayString();
}

/** 把 Date 对象格式化为 YYYY-MM-DD 字符串（用于生成历史日期列表等） */
export function formatDateYYYYMMDD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 按本地时区中午 12 点加减天数，避免 DST 漂移。输入输出 YYYY-MM-DD。 */
export function addDaysLocal(dateStr: string, days: number): string {
  const p = (dateStr || '').split('-');
  if (p.length !== 3) return '';
  const d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10), 12, 0, 0, 0);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + Number(days) || 0);
  return formatDateYYYYMMDD(d);
}
