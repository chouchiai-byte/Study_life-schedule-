import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { daySummary, frequentCategories, logStreak, logTitle, nextToLog, parentReport, totals } from './logs';
import type { LogEntry } from './logs';
import { planDay } from './planner';
import { DEFAULT_ROUTINE, studyGoalFor } from './routine';
import { sampleTimetable as defaultTimetable } from './fixtures';
import { db } from '../db/db';
import { assignBlocks, deleteBlock, moveBlock, saveLogs, setStatus } from '../db/hooks';
import { exportBackup, importBackup } from '../db/db';

const MON = '2026-10-12';
const plan = planDay(MON, defaultTimetable(), [], false, DEFAULT_ROUTINE);
const log = (index: number, category: LogEntry['category'], extra: Partial<LogEntry> = {}): LogEntry => ({ day: MON, index, category, ...extra });

describe('記錄模式', () => {
  it('上學日預算＝7 格可支配＋2 格彈性', () => {
    const s = daySummary(plan, [], 4, 0);
    expect(s.budget).toBe(9);
    expect(s.remaining).toBe(9);
    expect(s.unlogged).toBe(0);
  });

  it('現在 20:10：已過的空格算未記錄，休閒與讀書分開統計', () => {
    const logs = [log(38, 'study', { subject: '數學' }), log(39, 'phone'), log(30, 'phone')]; // 30 = 在校時間也能記
    const s = daySummary(plan, logs, 4, 40);
    expect(s.study).toBe(1);
    expect(s.leisure).toBe(2);
    expect(s.unlogged).toBe(0); // 38、39 已記，40 是現在
    expect(s.remaining).toBe(7); // 40、41、42、44、45 與彈性格 46、47
  });

  it('預設選最近一個還沒記錄的格', () => {
    expect(nextToLog(plan, new Set(), 41)).toBe(41);
    expect(nextToLog(plan, new Set([41]), 41)).toBe(40);
    expect(nextToLog(plan, new Set(), 20)).toBeNull(); // 上課時間沒有要記的格
  });

  it('名稱顯示', () => {
    expect(logTitle(log(38, 'study', { subject: '數學' }))).toBe('讀書・數學');
    expect(logTitle(log(38, 'leisure', { label: '彈吉他' }))).toBe('彈吉他');
    expect(logTitle(log(38, 'dog'))).toBe('擼狗');
  });

  it('連續記錄天數：今天還沒記不算中斷', () => {
    expect(logStreak(new Set(['2026-10-10', '2026-10-11']), MON)).toBe(2);
    expect(logStreak(new Set(['2026-10-10', '2026-10-11', MON]), MON)).toBe(3);
    expect(logStreak(new Set(['2026-10-10']), MON)).toBe(0);
  });

  it('總計、常用類別、家長週報只含總數', () => {
    const logs = [
      log(38, 'study', { subject: '數學' }), log(39, 'study', { subject: '數學' }), log(40, 'homework', { subject: '英語文' }),
      log(41, 'dog'), log(42, 'phone'), log(44, 'phone'), log(45, 'leisure', { label: '彈吉他' }), log(46, 'chores'),
    ];
    const t = totals(logs);
    expect([t.study, t.leisure, t.other]).toEqual([3, 4, 1]);
    expect(t.bySubject).toEqual({ 數學: 2, 英語文: 1 });
    expect(t.byLabel).toEqual({ 彈吉他: 1 });
    expect(frequentCategories(logs).slice(0, 2)).toEqual(['study', 'phone']);
    const text = parentReport({ from: MON, to: '2026-10-18', totals: t, goalTotal: 32, completeness: 0.8, streak: 5 });
    expect(parentReport({ from: MON, to: MON, totals: t, goalTotal: 4, completeness: null, streak: 0 })).toContain('記錄完整度：—');
    expect(text).toContain('讀書：1.5 小時（目標 16 小時）');
    expect(text).toContain('休閒：2 小時');
    expect(text).not.toContain('滑手機');
    expect(text).not.toContain('彈吉他');
  });

  it('讀書目標：上學日與假日分開', () => {
    expect(studyGoalFor({ ...DEFAULT_ROUTINE, studyGoalWeekday: 3, studyGoalWeekend: 8 }, true)).toBe(3);
    expect(studyGoalFor({ ...DEFAULT_ROUTINE, studyGoalWeekday: 3, studyGoalWeekend: 8 }, false)).toBe(8);
  });
});

describe('記錄資料表', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it('同一格重記會取代，不會變兩筆', async () => {
    await saveLogs(MON, [40, 41], { category: 'phone' });
    await saveLogs(MON, [41], { category: 'dog' });
    expect(await db.logs.count()).toBe(2);
    expect((await db.logs.where('[day+index]').equals([MON, 41]).first())?.category).toBe('dog');
  });

  it('排程打卡完成自動轉成記錄，改回未做時移除；手動記錄不被覆蓋', async () => {
    await db.tasks.add({ id: 'hw', title: '數學講義', subject: '數學', kind: 'homework', due: null, blocks: 2, priority: 1, done: false, notes: '', remindAt: null, createdAt: 1 });
    await assignBlocks(MON, [38, 39], '數學講義', '數學', 'task', 'hw');
    const [a, b] = (await db.planned.toArray()).sort((x, y) => x.index - y.index);
    await setStatus(a, 'done');
    const auto = await db.logs.where('[day+index]').equals([MON, 38]).first();
    expect(auto?.category).toBe('homework');
    expect(auto?.subject).toBe('數學');
    expect(auto?.source).toBe('plan');
    await setStatus({ ...a, status: 'done' }, 'skipped');
    expect(await db.logs.count()).toBe(0);

    await saveLogs(MON, [39], { category: 'phone' });
    await setStatus(b, 'done');
    expect((await db.logs.where('[day+index]').equals([MON, 39]).first())?.category).toBe('phone');
  });

  it('移動或刪除已打卡的格，自動記錄跟著移動或刪除；手動記錄不動', async () => {
    await assignBlocks(MON, [38], '複習：數學', '數學', 'review', null);
    const row = (await db.planned.toArray())[0];
    await setStatus(row, 'done');
    await moveBlock(row.id, MON, 41);
    expect((await db.logs.toArray()).map((l) => l.index)).toEqual([41]);
    await saveLogs(MON, [44], { category: 'dog' });
    await deleteBlock(row.id);
    expect((await db.logs.toArray()).map((l) => l.category)).toEqual(['dog']);
  });

  it('還原舊版（沒有記錄）的備份不會清空記錄；不認得的類別會被略過', async () => {
    await saveLogs(MON, [40], { category: 'phone' });
    const v1 = JSON.stringify({ app: 'halfblock', version: 1, data: { tasks: [], settings: [] } });
    await importBackup(v1);
    expect(await db.logs.count()).toBe(1);
    const json = JSON.parse(await exportBackup());
    json.data.logs.push({ ...json.data.logs[0], id: 'bad', index: 41, category: 'xyz' });
    await importBackup(JSON.stringify(json));
    expect((await db.logs.toArray()).map((l) => l.index)).toEqual([40]);
  });
});
