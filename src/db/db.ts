import Dexie, { type EntityTable } from 'dexie';
import type { BlockStatus } from '../core/stats';
import type { LogCategory } from '../core/logs';
import { isCategory } from '../core/logs';
import type { RoutineConfig } from '../core/routine';
import { parseTimetableFile } from '../core/timetable';
import type { TimetableFile } from '../core/timetable';
import { normalizeRoutine } from '../core/routine';

// 所有資料都存在這支手機瀏覽器的 IndexedDB，不上傳。

export interface PeriodRow {
  id?: number;
  weekday: number;
  period: number;
  start: number;
  end: number;
  subject: string;
  teacher: string;
}

export type TaskKind = 'homework' | 'quiz' | 'exam' | 'project' | 'other';
export const TASK_KIND_NAME: Record<TaskKind, string> = {
  homework: '作業',
  quiz: '小考',
  exam: '段考',
  project: '報告',
  other: '其他',
};
export const TASK_KIND_ICON: Record<TaskKind, string> = {
  homework: '✏️',
  quiz: '📝',
  exam: '🎓',
  project: '📄',
  other: '📌',
};

export interface TaskRow {
  id: string;
  title: string;
  subject: string;
  kind: TaskKind;
  due: string | null; // YYYY-MM-DD
  blocks: number; // 預估格數
  priority: number; // 0 低 1 一般 2 重要
  done: boolean;
  notes: string;
  remindAt: string | null; // YYYY-MM-DDTHH:MM
  createdAt: number;
}

export type PlannedKind = 'task' | 'review' | 'custom';

export interface PlannedRow {
  id: string;
  day: string;
  index: number;
  title: string;
  subject: string;
  kind: PlannedKind;
  taskId: string | null;
  status: BlockStatus;
  updatedAt: number;
}

export interface EventRow {
  id: string;
  title: string;
  kind: 'course' | 'event';
  weekdays: number[]; // 空陣列 = 單次
  date: string | null;
  start: number;
  end: number;
  location: string;
  teacher: string;
  active: boolean;
}

export interface MemoRow {
  id: string;
  text: string;
  pinnedDay: string | null;
  done: boolean;
  createdAt: number;
}

export interface NoteRow {
  id: string;
  title: string;
  body: string;
  subject: string;
  source: 'manual' | 'scan';
  images: string[]; // data URL（JPEG）
  createdAt: number;
  updatedAt: number;
}

export type RepeatRule = 'none' | 'daily' | 'weekly';
export const REPEAT_NAME: Record<RepeatRule, string> = { none: '不重複', daily: '每天', weekly: '每週' };

export interface ReminderRow {
  id: string;
  title: string;
  at: string; // YYYY-MM-DDTHH:MM
  repeat: RepeatRule;
  enabled: boolean;
  notes: string;
}

export interface OverrideRow {
  day: string;
  holiday: boolean;
  note: string;
}

export type LogSource = 'manual' | 'plan';

/** 實際記錄：某一天某一格做了什麼。 */
export interface LogRow {
  id: string;
  day: string;
  index: number;
  category: LogCategory;
  subject: string;
  label: string; // 自訂休閒名稱
  note: string;
  source: LogSource; // 手動記錄，或由排程打卡自動轉入
  updatedAt: number;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export class HalfBlockDB extends Dexie {
  periods!: EntityTable<PeriodRow, 'id'>;
  tasks!: EntityTable<TaskRow, 'id'>;
  planned!: EntityTable<PlannedRow, 'id'>;
  events!: EntityTable<EventRow, 'id'>;
  memos!: EntityTable<MemoRow, 'id'>;
  notes!: EntityTable<NoteRow, 'id'>;
  reminders!: EntityTable<ReminderRow, 'id'>;
  overrides!: EntityTable<OverrideRow, 'day'>;
  settings!: EntityTable<SettingRow, 'key'>;
  logs!: EntityTable<LogRow, 'id'>;

  constructor() {
    super('halfblock');
    this.version(1).stores({
      periods: '++id, weekday',
      tasks: 'id, due, createdAt',
      planned: 'id, day, taskId, [day+index]',
      events: 'id',
      memos: 'id, pinnedDay, createdAt',
      notes: 'id, updatedAt',
      reminders: 'id, at',
      overrides: 'day',
      settings: 'key',
    });
    // 第 2 版：新增「記錄」資料表（記錄模式）
    this.version(2).stores({
      logs: 'id, day, [day+index], updatedAt',
    });
  }
}

export const db = new HalfBlockDB();

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** 第一次開啟：課表不放在程式裡（保護個資），由使用者匯入課表檔或手動建立。這裡只記錄已完成初始化。 */
export async function seedIfNeeded() {
  if (!(await db.settings.get('seeded'))) await db.settings.put({ key: 'seeded', value: true });
}

/** 匯入課表檔：取代目前的學校課表。回傳匯入的節數。 */
export async function importTimetable(json: string): Promise<number> {
  const file = parseTimetableFile(json);
  await db.transaction('rw', db.periods, async () => {
    await db.periods.clear();
    await db.periods.bulkAdd(file.periods);
  });
  return file.periods.length;
}

/** 匯出目前課表成課表檔（換手機、或給其他人用同一份課表）。 */
export async function exportTimetable(name = '我的課表'): Promise<string> {
  const periods = (await db.periods.toArray()).map(({ weekday, period, start, end, subject, teacher }) => ({ weekday, period, start, end, subject, teacher }));
  const file: TimetableFile = { app: 'halfblock-timetable', version: 1, name, periods };
  return JSON.stringify(file, null, 1);
}

export const clearTimetable = () => db.periods.clear();

export async function saveRoutine(r: RoutineConfig) {
  await db.settings.put({ key: 'routine', value: r });
}

/** 只修改部分作息設定：以資料庫中最新的值為準，連續快速修改也不會互相覆蓋。 */
export async function updateRoutine(patch: Partial<RoutineConfig>) {
  await db.transaction('rw', db.settings, async () => {
    const cur = normalizeRoutine((await db.settings.get('routine'))?.value as Partial<RoutineConfig>);
    await db.settings.put({ key: 'routine', value: { ...cur, ...patch } });
  });
}

/** 要求瀏覽器盡量不要清除本站資料。 */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    /* 不支援時略過 */
  }
}

// ---------- 備份與還原 ----------

const TABLES = ['periods', 'tasks', 'planned', 'events', 'memos', 'notes', 'reminders', 'overrides', 'settings', 'logs'] as const;
const BACKUP_VERSION = 2;

export async function exportBackup(): Promise<string> {
  const data: Record<string, unknown[]> = {};
  for (const t of TABLES) data[t] = await db.table(t).toArray();
  return JSON.stringify({ app: 'halfblock', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data });
}

export async function importBackup(json: string) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('這不是半時格的備份檔');
  }
  if (parsed?.app !== 'halfblock' || !parsed.data) throw new Error('這不是半時格的備份檔');
  if (typeof parsed.version === 'number' && parsed.version > BACKUP_VERSION) throw new Error('備份檔來自較新版本，請先更新 App');
  // 整份取代：任何一步失敗都會整批復原，原資料不會遺失
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      let rows = parsed.data[t];
      // 舊版（v1）備份沒有「記錄」：保留目前的記錄，不清空
      if (!Array.isArray(rows) && t === 'logs') continue;
      await db.table(t).clear();
      if (t === 'logs' && Array.isArray(rows)) rows = rows.filter((r: { category?: unknown }) => isCategory(r?.category));
      if (Array.isArray(rows) && rows.length) await db.table(t).bulkAdd(rows);
    }
    await db.settings.put({ key: 'seeded', value: true });
  });
}
