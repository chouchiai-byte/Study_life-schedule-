// 半時格（30 分鐘一格）時間換算與日期工具。
// 一天 48 格：第 0 格為 00:00–00:30，第 47 格為 23:30–24:00。
// 日期一律用 "YYYY-MM-DD" 字串（當地日期）表示，方便存進資料庫與比較。

export const MIN_PER_BLOCK = 30;
export const BLOCKS_PER_DAY = 48;
export const MIN_PER_DAY = 1440;
/** 佔用某一格達 15 分鐘就算佔用該格。 */
export const OCCUPY_THRESHOLD = 15;

export const indexOfMinute = (minute: number): number =>
  Math.min(Math.floor(Math.max(minute, 0) / MIN_PER_BLOCK), BLOCKS_PER_DAY - 1);

export const startMinute = (index: number) => index * MIN_PER_BLOCK;
export const endMinute = (index: number) => (index + 1) * MIN_PER_BLOCK;

export const minuteOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
export const currentIndex = (d: Date) => indexOfMinute(minuteOfDay(d));

export function overlap(block: number, start: number, end: number): number {
  const s = Math.max(start, startMinute(block));
  const e = Math.min(end, endMinute(block));
  return Math.max(0, e - s);
}

/** 時段 [start, end) 佔用的格。整段都不足 15 分鐘時，取重疊最多的一格。 */
export function blocksCovering(start: number, end: number): number[] {
  const s = Math.max(0, start);
  const e = Math.min(MIN_PER_DAY, end);
  if (e <= s) return [];
  const first = indexOfMinute(s);
  const last = indexOfMinute(e - 1);
  const all: number[] = [];
  for (let i = first; i <= last; i++) all.push(i);
  const covered = all.filter((i) => overlap(i, s, e) >= OCCUPY_THRESHOLD);
  if (covered.length) return covered;
  let best = first;
  for (const i of all) if (overlap(i, s, e) > overlap(best, s, e)) best = i;
  return [best];
}

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/** "07:30"；1440 顯示 "24:00" */
export const timeLabel = (minute: number) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
export const blockLabel = (index: number) => timeLabel(startMinute(index));
export const rangeLabel = (index: number) => `${blockLabel(index)}–${timeLabel(endMinute(index))}`;
export const rangeLabelN = (start: number, count: number) =>
  `${blockLabel(start)}–${timeLabel(endMinute(start + Math.max(count, 1) - 1))}`;
export const hoursText = (blocks: number) =>
  blocks % 2 === 0 ? `${blocks / 2} 小時` : `${Math.floor(blocks / 2)}.5 小時`;

/** "HH:MM" → 分鐘 */
export function parseTime(text: string): number {
  const [h, m] = text.split(':').map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

// ---------- 日期 ----------

export const WEEKDAY_NAMES = ['', '一', '二', '三', '四', '五', '六', '日'];

export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayKey = () => dayKey(new Date());

export function parseDay(key: string): Date {
  const [y, m, d] = key.split('-').map((x) => parseInt(x, 10));
  return new Date(y, m - 1, d);
}

export function addDays(key: string, n: number): string {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/** ISO 星期：週一 = 1 … 週日 = 7 */
export function isoWeekday(key: string): number {
  const w = parseDay(key).getDay();
  return w === 0 ? 7 : w;
}

export const mondayOf = (key: string) => addDays(key, -(isoWeekday(key) - 1));

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export const days = (from: string, count: number) => Array.from({ length: count }, (_, i) => addDays(from, i));

export const monthDay = (key: string) => {
  const [, m, d] = key.split('-').map(Number);
  return `${m}/${d}`;
};

export const weekdayName = (key: string) => WEEKDAY_NAMES[isoWeekday(key)];

/** "今天 10/12（一）" */
export function dayTitle(key: string, relative = true): string {
  const base = `${monthDay(key)}（${weekdayName(key)}）`;
  if (!relative) return base;
  const diff = daysBetween(todayKey(), key);
  if (diff === 0) return `今天 ${base}`;
  if (diff === 1) return `明天 ${base}`;
  if (diff === -1) return `昨天 ${base}`;
  return base;
}

export function dueText(due: string): string {
  const n = daysBetween(todayKey(), due);
  if (n < 0) return `逾期 ${-n} 天`;
  if (n === 0) return '今天到期';
  if (n === 1) return '明天到期';
  return `${n} 天後（${monthDay(due)}）`;
}
