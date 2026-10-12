import { currentIndex, dayKey, isoWeekday } from './time';
import { freeIndices } from './types';
import type { ClassSlot, DayPlan } from './types';
import type { RoutineConfig } from './routine';

export interface SchedTask {
  id: string;
  title: string;
  subject?: string;
  /** 還需要安排的格數 */
  remaining: number;
  /** 截止日；只排到截止日前一天 */
  due?: string | null;
  /** 0 低、1 一般、2 高 */
  priority: number;
  /** 每天最多幾格（段考預設 2） */
  maxPerDay?: number | null;
}

export interface Suggestion {
  day: string;
  index: number;
  title: string;
  subject?: string;
  taskId?: string;
  kind: 'review' | 'task';
}

export interface ScheduleResult {
  suggestions: Suggestion[];
  /** 排不下的任務：id → 還差幾格 */
  unplaced: Record<string, number>;
}

export const REVIEW_PREFIX = '複習：';

export function reviewSubjects(day: string, classes: ClassSlot[], routine: RoutineConfig): string[] {
  const wd = isoWeekday(day);
  const taught = new Set(classes.filter((c) => c.weekday === wd).map((c) => c.subject));
  return routine.dailyReviewSubjects.filter((s) => taught.has(s));
}

export function taskOrder(a: SchedTask, b: SchedTask): number {
  const ad = a.due ?? null;
  const bd = b.due ?? null;
  if (ad && bd && ad !== bd) return ad < bd ? -1 : 1;
  if (ad && !bd) return -1;
  if (!ad && bd) return 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
}

/**
 * 自動排程建議：
 * 1. 每天只用可支配格的 80%（可調），保留緩衝；
 * 2. 2 天內到期的任務最先排；
 * 3. 上學日依當天有上的國英數各排 1 格複習；
 * 4. 其餘任務依截止日、優先順序排入截止日前的空格。
 */
export function suggest(opts: {
  plans: DayPlan[];
  existing: Record<string, Record<number, string>>;
  classes: ClassSlot[];
  tasks: SchedTask[];
  routine: RoutineConfig;
  now?: Date;
}): ScheduleResult {
  const { routine, classes } = opts;
  const today = opts.now ? dayKey(opts.now) : null;
  const nowIdx = opts.now ? currentIndex(opts.now) : -1;

  const days = [...opts.plans]
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .map((plan) => {
      const taken = opts.existing[plan.day] ?? {};
      const free = freeIndices(plan);
      let available = free.filter((i) => taken[i] === undefined);
      if (today === plan.day) available = available.filter((i) => i > nowIdx);
      const used = free.filter((i) => taken[i] !== undefined).length;
      const budget = Math.floor(free.length * routine.maxFillRatio + 1e-9);
      const cap = Math.max(0, budget - used);
      return {
        day: plan.day,
        isSchoolDay: plan.isSchoolDay,
        available,
        capacity: Math.min(cap, available.length),
        titles: new Set(Object.values(taken)),
      };
    });

  const suggestions: Suggestion[] = [];
  const unplaced: Record<string, number> = {};

  const take = (di: number, count: number, s: Omit<Suggestion, 'day' | 'index'>) => {
    const d = days[di];
    const n = Math.min(count, d.capacity, d.available.length);
    if (n <= 0) return 0;
    const picked = d.available.splice(0, n);
    d.capacity -= n;
    d.titles.add(s.title);
    for (const index of picked) suggestions.push({ ...s, day: d.day, index });
    return n;
  };

  const placeTasks = (list: SchedTask[]) => {
    for (const t of list) {
      let rem = t.remaining;
      for (let i = 0; i < days.length && rem > 0; i++) {
        if (t.due && days[i].day >= t.due) break;
        const want = Math.min(rem, t.maxPerDay ?? rem);
        rem -= take(i, want, { title: t.title, subject: t.subject, taskId: t.id, kind: 'task' });
      }
      if (rem > 0) unplaced[t.id] = rem;
    }
  };

  const placeReviews = () => {
    days.forEach((d, i) => {
      if (!d.isSchoolDay) return;
      for (const subject of reviewSubjects(d.day, classes, routine)) {
        const title = REVIEW_PREFIX + subject;
        if (d.titles.has(title)) continue;
        if (d.capacity === 0) break;
        take(i, 1, { title, subject, kind: 'review' });
      }
    });
  };

  const ordered = opts.tasks.filter((t) => t.remaining > 0).sort(taskOrder);
  const first = days[0]?.day;
  const urgentLimit = first
    ? (() => {
        const d = new Date(first + 'T00:00:00');
        d.setDate(d.getDate() + 2);
        return dayKey(d);
      })()
    : null;
  const urgent = ordered.filter((t) => t.due && urgentLimit && t.due <= urgentLimit);
  const urgentIds = new Set(urgent.map((t) => t.id));
  const others = ordered.filter((t) => !urgentIds.has(t.id));

  placeTasks(urgent);
  placeReviews();
  placeTasks(others);

  suggestions.sort((a, b) => (a.day === b.day ? a.index - b.index : a.day < b.day ? -1 : 1));
  return { suggestions, unplaced };
}
