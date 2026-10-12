import { describe, expect, it } from 'vitest';
import {
  blockLabel, blocksCovering, hoursText, indexOfMinute, isoWeekday, mondayOf, rangeLabel, rangeLabelN, daysBetween, days,
} from './time';
import { DEFAULT_ROUTINE, normalizeRoutine } from './routine';
import { planDay } from './planner';
import { freeIndices, flexibleIndices } from './types';
import type { RecurringEvent } from './types';
import { sampleTimetable as defaultTimetable } from './fixtures';
import { reviewSubjects, suggest, taskOrder } from './scheduler';
import type { SchedTask } from './scheduler';
import { conflicts, consecutiveFree, nearestFreeRun } from './conflict';
import { computeStats, streak } from './stats';

// 2026/10/12 是週一
const D = (d: number) => `2026-10-${d < 10 ? '0' + d : d}`;
const classes = defaultTimetable();
const R = DEFAULT_ROUTINE;
const plan = (day: string, events: RecurringEvent[] = [], holiday = false, routine = R) =>
  planDay(day, classes, events, holiday, routine);
const plans = (from: number, count: number, events: RecurringEvent[] = []) =>
  days(D(from), count).map((d) => plan(d, events));

describe('格序換算', () => {
  it('index 與標籤', () => {
    expect(indexOfMinute(0)).toBe(0);
    expect(indexOfMinute(19 * 60 + 30)).toBe(39);
    expect(indexOfMinute(23 * 60 + 59)).toBe(47);
    expect(blockLabel(39)).toBe('19:30');
    expect(rangeLabel(47)).toBe('23:30–24:00');
    expect(rangeLabelN(38, 3)).toBe('19:00–20:30');
    expect(hoursText(3)).toBe('1.5 小時');
    expect(hoursText(4)).toBe('2 小時');
  });
  it('佔用 15 分鐘即算 1 格', () => {
    expect(blocksCovering(450, 1035)).toEqual(Array.from({ length: 20 }, (_, i) => 15 + i));
    expect(blocksCovering(405, 450)).toEqual([13, 14]);
    expect(blocksCovering(1150, 1160)).toEqual([38]);
    expect(blocksCovering(600, 600)).toEqual([]);
  });
  it('星期與日期', () => {
    expect(isoWeekday(D(12))).toBe(1);
    expect(isoWeekday(D(18))).toBe(7);
    expect(mondayOf(D(17))).toBe(D(12));
    expect(daysBetween(D(12), D(19))).toBe(7);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });
});

describe('每日配置', () => {
  it('課表 45 節', () => {
    expect(classes.length).toBe(45);
    const mon = classes.filter((c) => c.weekday === 1 && c.period > 0).map((c) => c.subject);
    expect(mon[0]).toBe('英語文');
    expect(mon[7]).toBe('數學');
  });
  it('上學日：7 格可支配＋2 格彈性（與企劃書一致）', () => {
    const p = plan(D(12));
    expect(p.isSchoolDay).toBe(true);
    expect(freeIndices(p)).toEqual([38, 39, 40, 41, 42, 44, 45]);
    expect(flexibleIndices(p).length).toBe(2);
    expect(p.blocks[13].kind).toBe('commute');
    expect(p.blocks[15].kind).toBe('school');
    expect(p.blocks[34].kind).toBe('school');
    expect(p.blocks[35].kind).toBe('commute');
    expect(p.blocks[36].kind).toBe('meal');
    expect(p.blocks[43].title).toBe('盥洗');
  });
  it('週末 25 格', () => {
    const p = plan(D(17));
    expect(p.isSchoolDay).toBe(false);
    expect(freeIndices(p).length).toBe(25);
  });
  it('停課日套用週末作息', () => {
    expect(freeIndices(plan(D(12), [], true)).length).toBe(25);
  });
  it('週六補習扣除可支配格', () => {
    const cram: RecurringEvent = { id: 'cram', title: '數學補習', kind: 'course', weekdays: [6], start: 540, end: 630 };
    const sat = plan(D(17), [cram]);
    expect(freeIndices(sat).length).toBe(22);
    expect(sat.blocks[18].title).toBe('數學補習');
    expect(freeIndices(plan(D(18), [cram])).length).toBe(25);
  });
  it('單次活動覆蓋在校時間', () => {
    const trip: RecurringEvent = { id: 'trip', title: '校外教學', kind: 'event', weekdays: [], date: D(14), start: 480, end: 960 };
    expect(plan(D(14), [trip]).blocks[20].title).toBe('校外教學');
    expect(plan(D(15), [trip]).blocks[20].kind).toBe('school');
  });
  it('24:00 才睡多 2 格', () => {
    const r = { ...R, bedtimeEarliest: 1440 };
    expect(freeIndices(plan(D(12), [], false, r)).length).toBe(9);
  });
});

describe('自動排程', () => {
  it('週一排國英數複習', () => {
    expect(reviewSubjects(D(12), classes, R)).toEqual(['國語文', '英語文', '數學']);
    const r = suggest({ plans: plans(12, 1), existing: {}, classes, tasks: [], routine: R });
    expect(r.suggestions.map((s) => s.title)).toEqual(['複習：國語文', '複習：英語文', '複習：數學']);
    expect(r.suggestions.map((s) => s.index)).toEqual([38, 39, 40]);
  });
  it('每天最多排 80%', () => {
    const big: SchedTask = { id: 't1', title: '專題報告', remaining: 10, priority: 1 };
    const r = suggest({ plans: plans(12, 1), existing: {}, classes, tasks: [big], routine: R });
    expect(r.suggestions.length).toBe(5);
    expect(r.unplaced.t1).toBe(8);
  });
  it('明天到期的作業優先於複習', () => {
    const hw: SchedTask = { id: 'hw', title: '數學講義', subject: '數學', remaining: 5, due: D(13), priority: 1 };
    const r = suggest({ plans: plans(12, 2), existing: {}, classes, tasks: [hw], routine: R });
    const mon = r.suggestions.filter((s) => s.day === D(12));
    expect(mon.length).toBe(5);
    expect(mon.every((s) => s.taskId === 'hw')).toBe(true);
    expect(r.unplaced.hw).toBeUndefined();
  });
  it('今天到期的任務排不進去', () => {
    const hw: SchedTask = { id: 'hw', title: '國文作業', remaining: 1, due: D(12), priority: 1 };
    expect(suggest({ plans: plans(12, 3), existing: {}, classes, tasks: [hw], routine: R }).unplaced.hw).toBe(1);
  });
  it('段考複習每天最多 2 格', () => {
    const exam: SchedTask = { id: 'ex', title: '段考複習', remaining: 6, due: D(19), priority: 2, maxPerDay: 2 };
    const r = suggest({ plans: plans(12, 7), existing: {}, classes, tasks: [exam], routine: R });
    const ex = r.suggestions.filter((s) => s.taskId === 'ex');
    expect(ex.length).toBe(6);
    const per: Record<string, number> = {};
    ex.forEach((s) => (per[s.day] = (per[s.day] ?? 0) + 1));
    expect(Object.values(per).every((n) => n <= 2)).toBe(true);
    expect(ex.every((s) => s.day < D(19))).toBe(true);
  });
  it('略過已安排的格與已過去的時間', () => {
    const now = new Date(2026, 9, 12, 19, 40);
    const r = suggest({
      plans: plans(12, 1), existing: { [D(12)]: { 38: '複習：國語文' } }, classes, tasks: [], routine: R, now,
    });
    expect(r.suggestions.map((s) => s.title)).toEqual(['複習：英語文', '複習：數學']);
    expect(r.suggestions.every((s) => s.index > 39)).toBe(true);
  });
  it('任務排序：截止日 → 優先', () => {
    const t = (id: string, due: string | null, priority: number): SchedTask => ({ id, title: id.toUpperCase(), remaining: 1, due, priority });
    const list = [t('a', D(14), 0), t('b', D(13), 0), t('c', null, 2), t('d', D(13), 2)].sort(taskOrder);
    expect(list.map((x) => x.id)).toEqual(['d', 'b', 'a', 'c']);
  });
});

describe('衝突檢查', () => {
  it('與在校、晚餐衝突', () => {
    const p = plan(D(12));
    const c = conflicts(960, 1140, p);
    expect(c.some((b) => b.kind === 'school')).toBe(true);
    expect(c.some((b) => b.kind === 'meal')).toBe(true);
    expect(conflicts(1140, 1200, p)).toEqual([]);
  });
  it('最近的連續空格', () => {
    const p = plan(D(12));
    expect(nearestFreeRun(3, 30, p)).toBe(38);
    expect(nearestFreeRun(2, 44, p)).toBe(44);
    expect(nearestFreeRun(3, 44, p, new Set([38]))).toBe(40);
    expect(nearestFreeRun(6, 40, p)).toBeNull();
    expect(consecutiveFree(41, 4, p, new Set())).toEqual([41, 42]);
  });
});

describe('統計', () => {
  it('完成率與科目時數', () => {
    const s = computeStats([
      { subject: '數學', status: 'done' },
      { subject: '數學', status: 'partial' },
      { subject: '英語文', status: 'skipped' },
      { status: 'planned' },
    ]);
    expect(s.total).toBe(4);
    expect(s.completionRate).toBeCloseTo(0.5);
    expect(s.bySubject['數學']).toBe(2);
    expect(s.bySubject['英語文']).toBeUndefined();
  });
  it('連續達成天數', () => {
    expect(streak({ [D(10)]: ['done'], [D(11)]: ['done', 'skipped'], [D(12)]: ['planned'] }, D(12))).toBe(2);
    expect(streak({}, D(12))).toBe(0);
  });
  it('舊設定補預設值', () => {
    const r = normalizeRoutine({ wake: 360 });
    expect(r.wake).toBe(360);
    expect(r.leaveHome).toBe(405);
    expect(r.dailyReviewSubjects).toEqual(['國語文', '英語文', '數學']);
  });
});
