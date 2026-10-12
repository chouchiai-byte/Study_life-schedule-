// 記錄模式（比照飲食控制 App）：每 30 分鐘做了什麼隨手記一筆。
// 讀書類算進讀書格；休閒類（休息、滑手機、擼狗、運動、其他休閒）照實記錄，不扣分、不提醒。

import { addDays, BLOCKS_PER_DAY } from './time';
import type { DayPlan } from './types';

export type LogCategory = 'study' | 'homework' | 'course' | 'rest' | 'phone' | 'dog' | 'sport' | 'leisure' | 'chores';
export type LogGroup = 'study' | 'leisure' | 'other';

export interface CategoryInfo {
  name: string;
  icon: string;
  color: string;
  group: LogGroup;
  /** 需要再選科目 */
  needsSubject?: boolean;
  /** 可自訂名稱（例如彈吉他、追劇） */
  customLabel?: boolean;
}

export const CATEGORY: Record<LogCategory, CategoryInfo> = {
  study: { name: '讀書', icon: '📖', color: '#2563eb', group: 'study', needsSubject: true },
  homework: { name: '作業', icon: '✏️', color: '#4f46e5', group: 'study', needsSubject: true },
  course: { name: '課程', icon: '📘', color: '#9333ea', group: 'study' },
  rest: { name: '休息', icon: '😌', color: '#0d9488', group: 'leisure' },
  phone: { name: '滑手機', icon: '📱', color: '#64748b', group: 'leisure' },
  dog: { name: '擼狗', icon: '🐶', color: '#d97706', group: 'leisure' },
  sport: { name: '運動', icon: '🏃', color: '#16a34a', group: 'leisure' },
  leisure: { name: '其他休閒', icon: '🎸', color: '#db2777', group: 'leisure', customLabel: true },
  chores: { name: '家事雜事', icon: '🧺', color: '#94a3b8', group: 'other' },
};

/** 讀取類別資訊；遇到不認得的類別（例如損壞的備份）當成「家事雜事」，畫面不會壞掉。 */
export const cat = (c: string): CategoryInfo => (CATEGORY as Record<string, CategoryInfo>)[c] ?? CATEGORY.chores;
export const isCategory = (c: unknown): c is LogCategory => typeof c === 'string' && c in CATEGORY;

export const CATEGORY_ORDER: LogCategory[] = ['study', 'homework', 'course', 'rest', 'phone', 'dog', 'sport', 'leisure', 'chores'];

export const GROUP_NAME: Record<LogGroup, string> = { study: '讀書', leisure: '休閒', other: '其他' };

export interface LogEntry {
  day: string;
  index: number;
  category: LogCategory;
  subject?: string;
  label?: string;
}

/** 這一筆記錄要顯示的名稱，例如「讀書・數學」「彈吉他」。 */
export function logTitle(e: Pick<LogEntry, 'category' | 'subject' | 'label'>): string {
  const c = cat(e.category);
  if (c.customLabel && e.label) return e.label;
  if (e.subject) return `${c.name}・${e.subject}`;
  return c.name;
}

/** 需要記錄的格：可支配格與彈性格（上課、通勤、睡覺等固定格不用記）。 */
export const loggableIndices = (plan: DayPlan) =>
  plan.blocks.filter((b) => b.kind === 'free' || b.kind === 'flexible').map((b) => b.index);

/** 時間日記分段（像早餐／午餐／晚餐／點心）。 */
export const DIARY_SECTIONS = [
  { id: 'morning', name: '上午', from: 0, to: 24 },
  { id: 'afternoon', name: '下午', from: 24, to: 36 },
  { id: 'evening', name: '晚間', from: 36, to: 44 },
  { id: 'night', name: '睡前', from: 44, to: BLOCKS_PER_DAY },
] as const;

export interface DaySummary {
  /** 今天的讀書目標（格） */
  goal: number;
  /** 已記錄的讀書格（含課程、作業） */
  study: number;
  leisure: number;
  other: number;
  /** 需要記錄、時間已過、但還沒記錄的格 */
  unlogged: number;
  /** 可支配格＋彈性格（今天的「預算」） */
  budget: number;
  /** 還沒過、也還沒記錄的可支配格 */
  remaining: number;
}

/**
 * 每日摘要。nowIndex：今天傳目前格序；過去的日子傳 48（全部已過）；未來的日子傳 -1。
 * 讀書、休閒等以「記錄」計算，任何格都可以記（例如通勤時滑手機也可記）。
 */
export function daySummary(plan: DayPlan, logs: LogEntry[], goal: number, nowIndex: number): DaySummary {
  const dayLogs = logs.filter((l) => l.day === plan.day);
  const byIndex = new Map(dayLogs.map((l) => [l.index, l]));
  const count = (g: LogGroup) => dayLogs.filter((l) => cat(l.category).group === g).length;
  const loggable = loggableIndices(plan);
  return {
    goal,
    study: count('study'),
    leisure: count('leisure'),
    other: count('other'),
    unlogged: loggable.filter((i) => i < nowIndex && !byIndex.has(i)).length,
    budget: loggable.length,
    remaining: loggable.filter((i) => i >= nowIndex && !byIndex.has(i)).length,
  };
}

/** 快速記錄時預設選的格：最近一個已過（或正在進行）、需要記錄、還沒記錄的格。 */
export function nextToLog(plan: DayPlan, logged: Set<number>, nowIndex: number): number | null {
  const candidates = loggableIndices(plan).filter((i) => i <= nowIndex && !logged.has(i));
  return candidates.length ? candidates[candidates.length - 1] : null;
}

/** 連續記錄天數：每天至少記錄 1 格就算。今天還沒記不算中斷（可以隔天補登）。 */
export function logStreak(daysWithLogs: Set<string>, today: string): number {
  let day = daysWithLogs.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (daysWithLogs.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

export interface PeriodTotals {
  study: number;
  leisure: number;
  other: number;
  byCategory: Partial<Record<LogCategory, number>>;
  bySubject: Record<string, number>;
  /** 自訂休閒名稱的格數，例如 { 彈吉他: 3 } */
  byLabel: Record<string, number>;
}

export function totals(logs: LogEntry[]): PeriodTotals {
  const t: PeriodTotals = { study: 0, leisure: 0, other: 0, byCategory: {}, bySubject: {}, byLabel: {} };
  for (const l of logs) {
    const c = cat(l.category);
    t[c.group] += 1;
    t.byCategory[l.category] = (t.byCategory[l.category] ?? 0) + 1;
    if (c.group === 'study' && l.subject) t.bySubject[l.subject] = (t.bySubject[l.subject] ?? 0) + 1;
    if (c.customLabel && l.label) t.byLabel[l.label] = (t.byLabel[l.label] ?? 0) + 1;
  }
  return t;
}

/** 常用類別排前面：依最近的使用次數排序，沒用過的照預設順序。 */
export function frequentCategories(recent: LogEntry[]): LogCategory[] {
  const n: Partial<Record<LogCategory, number>> = {};
  for (const l of recent) n[l.category] = (n[l.category] ?? 0) + 1;
  return [...CATEGORY_ORDER].sort((a, b) => (n[b] ?? 0) - (n[a] ?? 0) || CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
}

/** 家長版週報文字：只有總時數，不含每一格的明細。 */
export function parentReport(opts: {
  from: string;
  to: string;
  totals: PeriodTotals;
  goalTotal: number;
  completeness: number | null;
  streak: number;
}): string {
  const h = (b: number) => (b % 2 === 0 ? `${b / 2}` : `${Math.floor(b / 2)}.5`);
  const t = opts.totals;
  const subjects = Object.entries(t.bySubject)
    .sort((a, b) => b[1] - a[1])
    .map(([s, b]) => `${s} ${h(b)}`)
    .join('、');
  return [
    `【半時格週報】${opts.from.slice(5).replace('-', '/')}–${opts.to.slice(5).replace('-', '/')}`,
    `讀書：${h(t.study)} 小時（目標 ${h(opts.goalTotal)} 小時）`,
    subjects ? `各科：${subjects}（小時）` : '',
    `休閒：${h(t.leisure)} 小時`,
    `其他：${h(t.other)} 小時`,
    `記錄完整度：${opts.completeness === null ? '—' : `${Math.round(opts.completeness * 100)}%`}　連續記錄 ${opts.streak} 天`,
  ]
    .filter(Boolean)
    .join('\n');
}
