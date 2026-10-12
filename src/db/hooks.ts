import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db, uid } from './db';
import type { LogRow, PlannedKind, PlannedRow, TaskRow } from './db';
import type { LogCategory } from '../core/logs';
import { normalizeRoutine } from '../core/routine';
import type { RoutineConfig } from '../core/routine';
import { planDay } from '../core/planner';
import type { ClassSlot, DayPlan, RecurringEvent } from '../core/types';
import { isoWeekday } from '../core/time';
import type { SchedTask, Suggestion } from '../core/scheduler';
import type { BlockStatus } from '../core/stats';

export function useRoutine(): RoutineConfig {
  const row = useLiveQuery(() => db.settings.get('routine'), []);
  return useMemo(() => normalizeRoutine((row?.value as Partial<RoutineConfig>) ?? null), [row]);
}

export interface Builder {
  routine: RoutineConfig;
  classes: ClassSlot[];
  events: RecurringEvent[];
  holidays: Set<string>;
  plan: (day: string) => DayPlan;
  isHoliday: (day: string) => boolean;
  classesOn: (day: string) => ClassSlot[];
  /** 課表科目（不含早自習），依每週節數多到少 */
  subjects: string[];
}

/** 把課表、自建時段、停課日、作息組合起來，可算出任一天的 48 格。 */
export function useBuilder(): Builder {
  const routine = useRoutine();
  const periods = useLiveQuery(() => db.periods.toArray(), []) ?? [];
  const eventRows = useLiveQuery(() => db.events.toArray(), []) ?? [];
  const overrides = useLiveQuery(() => db.overrides.toArray(), []) ?? [];

  return useMemo(() => {
    const classes: ClassSlot[] = periods.map((p) => ({
      weekday: p.weekday, period: p.period, start: p.start, end: p.end, subject: p.subject, teacher: p.teacher,
    }));
    const events: RecurringEvent[] = eventRows
      .filter((e) => e.active)
      .map((e) => ({ id: e.id, title: e.title, kind: e.kind, weekdays: e.weekdays, date: e.date, start: e.start, end: e.end }));
    const holidays = new Set(overrides.filter((o) => o.holiday).map((o) => o.day));
    const cache = new Map<string, DayPlan>();
    const plan = (day: string) => {
      let p = cache.get(day);
      if (!p) {
        p = planDay(day, classes, events, holidays.has(day), routine);
        cache.set(day, p);
      }
      return p;
    };
    const counts: Record<string, number> = {};
    for (const c of classes) if (c.period > 0) counts[c.subject] = (counts[c.subject] ?? 0) + 1;
    const subjects = Object.entries(counts)
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], 'zh-Hant'))
      .map(([s]) => s);
    return {
      routine, classes, events, holidays, plan, subjects,
      isHoliday: (day: string) => holidays.has(day),
      classesOn: (day: string) =>
        holidays.has(day) ? [] : classes.filter((c) => c.weekday === isoWeekday(day)).sort((a, b) => a.period - b.period),
    };
  }, [routine, periods, eventRows, overrides]);
}

export const usePlanned = () => useLiveQuery(() => db.planned.toArray(), []) ?? [];
export const useTasks = () => useLiveQuery(() => db.tasks.orderBy('createdAt').toArray(), []) ?? [];

// ---------- 安排（PlannedRow）操作 ----------

export function occupiedMap(rows: PlannedRow[]): Record<string, Record<number, string>> {
  const map: Record<string, Record<number, string>> = {};
  for (const r of rows) (map[r.day] ??= {})[r.index] = r.title;
  return map;
}

export function blocksOn(day: string, rows: PlannedRow[]): Map<number, PlannedRow> {
  const m = new Map<number, PlannedRow>();
  for (const r of rows) if (r.day === day) m.set(r.index, r);
  return m;
}

export const scheduledCount = (task: TaskRow, rows: PlannedRow[]) =>
  rows.filter((r) => r.taskId === task.id && r.status !== 'skipped').length;

export const doneCount = (task: TaskRow, rows: PlannedRow[]) =>
  rows.filter((r) => r.taskId === task.id && r.status === 'done').length;

export function schedTasks(tasks: TaskRow[], rows: PlannedRow[]): SchedTask[] {
  return tasks
    .filter((t) => !t.done)
    .map((t) => ({
      id: t.id,
      title: t.title,
      subject: t.subject || undefined,
      remaining: Math.max(0, t.blocks - scheduledCount(t, rows)),
      due: t.due,
      priority: t.priority,
      maxPerDay: t.kind === 'exam' ? 2 : null,
    }));
}

const newBlock = (day: string, index: number, title: string, subject: string, kind: PlannedKind, taskId: string | null): PlannedRow => ({
  id: uid(), day, index, title, subject, kind, taskId, status: 'planned', updatedAt: Date.now(),
});

/** 寫入安排；同一天同一格已有內容的會略過（避免重複點擊存成兩筆）。回傳實際寫入筆數。 */
async function insertBlocks(rows: PlannedRow[]): Promise<number> {
  return db.transaction('rw', db.planned, async () => {
    const fresh: PlannedRow[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const k = `${r.day}#${r.index}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const exists = await db.planned.where('[day+index]').equals([r.day, r.index]).count();
      if (!exists) fresh.push(r);
    }
    if (fresh.length) await db.planned.bulkAdd(fresh);
    return fresh.length;
  });
}

export const acceptSuggestions = (list: Suggestion[]) =>
  insertBlocks(list.map((s) => newBlock(s.day, s.index, s.title, s.subject ?? '', s.kind === 'review' ? 'review' : 'task', s.taskId ?? null)));

export const assignBlocks = (day: string, indices: number[], title: string, subject: string, kind: PlannedKind, taskId: string | null) =>
  insertBlocks(indices.map((i) => newBlock(day, i, title, subject, kind, taskId)));

/** 移動安排；已打卡自動產生的記錄一起移動（目標格已有記錄時則刪除舊位置的自動記錄）。 */
export async function moveBlock(id: string, day: string, index: number) {
  return db.transaction('rw', db.planned, db.logs, async () => {
    const row = await db.planned.get(id);
    if (!row) return false;
    const clash = await db.planned.where('[day+index]').equals([day, index]).first();
    if (clash && clash.id !== id) return false;
    await db.planned.update(id, { day, index, updatedAt: Date.now() });
    const auto = await db.logs.where('[day+index]').equals([row.day, row.index]).first();
    if (auto?.source === 'plan') {
      const target = await db.logs.where('[day+index]').equals([day, index]).first();
      if (target) await db.logs.delete(auto.id);
      else await db.logs.update(auto.id, { day, index, updatedAt: Date.now() });
    }
    return true;
  });
}

/** 刪除安排；它打卡產生的自動記錄一起刪除（手動記錄保留）。 */
export async function deleteBlock(id: string) {
  await db.transaction('rw', db.planned, db.logs, async () => {
    const row = await db.planned.get(id);
    if (!row) return;
    await db.planned.delete(id);
    const auto = await db.logs.where('[day+index]').equals([row.day, row.index]).first();
    if (auto?.source === 'plan') await db.logs.delete(auto.id);
  });
}

/** 排程打卡要轉成哪一種記錄。 */
function categoryForPlanned(row: PlannedRow, task?: TaskRow): LogCategory {
  if (row.kind === 'task') return task && task.kind !== 'exam' ? 'homework' : 'study';
  if (row.kind === 'review') return 'study';
  return row.subject ? 'study' : 'chores';
}

/**
 * 打卡；完成或部分完成時自動記成一筆「記錄」（該格已有手動記錄則不覆蓋），改回未做時移除自動記錄。
 * 任務的完成格數達到預估格數時自動標記完成，改回未完成時也會跟著恢復。
 */
export async function setStatus(row: PlannedRow, status: BlockStatus) {
  const prev = row.status;
  await db.transaction('rw', db.planned, db.tasks, db.logs, async () => {
    await db.planned.update(row.id, { status, updatedAt: Date.now() });
    const existing = await db.logs.where('[day+index]').equals([row.day, row.index]).first();
    if (status === 'done' || status === 'partial') {
      if (!existing) {
        const task = row.taskId ? await db.tasks.get(row.taskId) : undefined;
        await db.logs.add({
          id: uid(), day: row.day, index: row.index, category: categoryForPlanned(row, task), subject: row.subject,
          label: '', note: row.title, source: 'plan', updatedAt: Date.now(),
        });
      }
    } else if (existing?.source === 'plan') {
      await db.logs.delete(existing.id);
    }
    if (!row.taskId) return;
    const task = await db.tasks.get(row.taskId);
    if (!task) return;
    const done = await db.planned.where('taskId').equals(row.taskId).filter((r) => r.status === 'done').count();
    if (done >= task.blocks && !task.done) await db.tasks.update(task.id, { done: true });
    else if (done < task.blocks && task.done && prev === 'done') await db.tasks.update(task.id, { done: false });
  });
}

// ---------- 記錄（LogRow） ----------

export const useLogs = () => useLiveQuery(() => db.logs.toArray(), []) ?? [];
/** 記錄是否已從資料庫載入（載入前不顯示「還沒記錄」等提示，避免畫面閃一下）。 */
export function useLogsState() {
  const q = useLiveQuery(() => db.logs.toArray(), []);
  return { logs: q ?? [], loaded: q !== undefined };
}
/** 作息設定是否已載入。 */
export const useRoutineLoaded = () => useLiveQuery(() => db.settings.get('routine').then(() => true), []) === true;

export function logsOn(day: string, rows: LogRow[]): Map<number, LogRow> {
  const m = new Map<number, LogRow>();
  for (const r of rows) if (r.day === day) m.set(r.index, r);
  return m;
}

/** 把同一個內容記到 day 的 indices 這幾格；該格原本的記錄會被取代。 */
export async function saveLogs(day: string, indices: number[], entry: { category: LogCategory; subject?: string; label?: string; note?: string }) {
  await db.transaction('rw', db.logs, async () => {
    for (const index of [...new Set(indices)]) {
      const old = await db.logs.where('[day+index]').equals([day, index]).first();
      const row: LogRow = {
        id: old?.id ?? uid(), day, index, category: entry.category, subject: entry.subject ?? '',
        label: entry.label?.trim() ?? '', note: entry.note?.trim() ?? '', source: 'manual', updatedAt: Date.now(),
      };
      await db.logs.put(row);
    }
  });
}

export const deleteLog = (id: string) => db.logs.delete(id);
