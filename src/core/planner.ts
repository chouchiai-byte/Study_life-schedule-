import { BLOCKS_PER_DAY, MIN_PER_DAY, isoWeekday, overlap } from './time';
import { KIND_INFO, segmentBlocks } from './types';
import type { BlockKind, ClassSlot, DayBlock, DayPlan, RecurringEvent, TimeSegment } from './types';
import type { RoutineConfig } from './routine';

export function occursOn(ev: RecurringEvent, day: string): boolean {
  if (ev.date) return ev.date === day;
  return ev.weekdays.includes(isoWeekday(day));
}

export function isSchoolDay(day: string, classes: ClassSlot[], holiday: boolean): boolean {
  if (holiday) return false;
  const wd = isoWeekday(day);
  return classes.some((c) => c.weekday === wd);
}

/** 當天所有時段（尚未換算成格） */
export function segmentsFor(
  day: string,
  classes: ClassSlot[],
  events: RecurringEvent[],
  holiday: boolean,
  r: RoutineConfig,
): TimeSegment[] {
  const out: TimeSegment[] = [];
  const add = (id: string, title: string, kind: BlockKind, start: number, end: number) => {
    const s = Math.max(0, start);
    const e = Math.min(MIN_PER_DAY, end);
    if (e > s) out.push({ id, title, kind, start: s, end: e });
  };
  const wd = isoWeekday(day);
  const todays = classes.filter((c) => c.weekday === wd);

  if (!holiday && todays.length) {
    const schoolStart = Math.min(r.schoolStart, ...todays.map((c) => c.start));
    const schoolEnd = Math.max(r.schoolEnd, ...todays.map((c) => c.end));
    add('sleep-am', '睡眠', 'sleep', 0, r.wake);
    add('prep', '起床準備', 'personal', r.wake, r.leaveHome);
    add('commute-am', '上學通勤', 'commute', r.leaveHome, schoolStart);
    add('school', '在校', 'school', schoolStart, schoolEnd);
    add('commute-pm', '放學通勤', 'commute', schoolEnd, schoolEnd + r.commuteMinutes);
  } else {
    add('sleep-am', '睡眠', 'sleep', 0, r.weekendWake);
    add('breakfast', '早餐', 'meal', r.weekendWake, r.weekendWake + r.weekendBreakfastMinutes);
    add('lunch', '午餐', 'meal', r.lunchStart, r.lunchStart + r.lunchMinutes);
  }
  add('dinner', '晚餐', 'meal', r.dinnerStart, r.dinnerStart + r.dinnerMinutes);
  add('bath', '盥洗', 'personal', r.bathStart, r.bathStart + r.bathMinutes);
  add('bedtime-flex', '彈性就寢', 'flexible', r.bedtimeEarliest, r.bedtimeLatest);
  add('sleep-pm', '睡眠', 'sleep', r.bedtimeLatest, MIN_PER_DAY);

  for (const ev of events) {
    if (occursOn(ev, day)) add(ev.id, ev.title, ev.kind, ev.start, ev.end);
  }
  return out;
}

/** 當天 48 格：每一格由佔用達 15 分鐘的時段中優先度最高者決定，沒有時段即為可支配格。 */
export function planDay(
  day: string,
  classes: ClassSlot[],
  events: RecurringEvent[],
  holiday: boolean,
  routine: RoutineConfig,
): DayPlan {
  const segs = segmentsFor(day, classes, events, holiday, routine);
  const covered = segs.map((s) => new Set(segmentBlocks(s)));
  const blocks: DayBlock[] = [];
  for (let i = 0; i < BLOCKS_PER_DAY; i++) {
    let best: { seg: TimeSegment; ov: number } | null = null;
    segs.forEach((seg, n) => {
      if (!covered[n].has(i)) return;
      const ov = overlap(i, seg.start, seg.end);
      const p = KIND_INFO[seg.kind].priority;
      if (!best) best = { seg, ov };
      else {
        const bp = KIND_INFO[best.seg.kind].priority;
        if (p > bp || (p === bp && ov > best.ov)) best = { seg, ov };
      }
    });
    const b = best as { seg: TimeSegment; ov: number } | null;
    blocks.push(
      b
        ? { index: i, kind: b.seg.kind, title: b.seg.title, segmentId: b.seg.id }
        : { index: i, kind: 'free', title: '可支配', segmentId: null },
    );
  }
  return { day, isSchoolDay: isSchoolDay(day, classes, holiday), blocks, segments: segs };
}
