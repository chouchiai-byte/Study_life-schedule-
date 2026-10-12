import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanText, findDate } from './ocr';
import { buildIcs } from './ics';
import { db, exportBackup, exportTimetable, importBackup, importTimetable, seedIfNeeded } from '../db/db';
import { sampleTimetable } from '../core/fixtures';
import { addDays, todayKey } from '../core/time';
import { assignBlocks, setStatus } from '../db/hooks';

describe('文字辨識後處理', () => {
  it('去掉中文字之間的空白', () => {
    expect(cleanText('數 學 講 義  第 一 章\n\n\n\nHello world')).toBe('數學講義第一章\n\nHello world');
    expect(cleanText('本校訂於 10 月 28 日舉辦 , 費用 350 元')).toBe('本校訂於10月28日舉辦，費用350元');
    expect(cleanText('Return by Oct. 20, 2026')).toBe('Return by Oct. 20, 2026');
  });
  it('找出今天以後最早的日期', () => {
    const today = '2026-10-12';
    expect(findDate('請於 10/20 前繳回回條', today)).toBe('2026-10-20');
    expect(findDate('繳費期限：10月25日；活動 11月3日', today)).toBe('2026-10-25');
    expect(findDate('115年11月5日舉行', today)).toBe('2026-11-05');
    expect(findDate('2026/12/01 截止', today)).toBe('2026-12-01');
    expect(findDate('上次是 9/1，這次 1/8', today)).toBe('2027-01-08');
    expect(findDate('沒有日期，時間 19:30', today)).toBeNull();
  });
});

describe('資料庫、行事曆匯出、備份', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it('第一次開啟不帶入任何課表（程式中沒有學校資料）；課表檔可匯入、匯出', async () => {
    await seedIfNeeded();
    expect(await db.periods.count()).toBe(0);
    const file = JSON.stringify({ app: 'halfblock-timetable', version: 1, periods: [...sampleTimetable(), { weekday: 9, period: 1, start: 1, end: 2, subject: 'x' }] });
    expect(await importTimetable(file)).toBe(45);
    expect(await db.periods.count()).toBe(45);
    const again = await exportTimetable();
    await db.periods.clear();
    expect(await importTimetable(again)).toBe(45);
    await expect(importTimetable('{"app":"halfblock"}')).rejects.toThrow('不是半時格的課表檔');
  });

  it('連續同一內容合併成一個行事曆事件，含 5 分鐘前提醒', async () => {
    const t = addDays(todayKey(), 1);
    const base = { subject: '數學', kind: 'review' as const, taskId: null, status: 'planned' as const, updatedAt: 0 };
    await db.planned.bulkAdd([
      { ...base, id: 'a', day: t, index: 38, title: '複習：數學' },
      { ...base, id: 'b', day: t, index: 39, title: '複習：數學' },
      { ...base, id: 'c', day: t, index: 41, title: '英文單字' },
    ]);
    const { text, count } = await buildIcs(7);
    expect(count).toBe(2);
    const d = t.replace(/-/g, '');
    expect(text).toContain(`DTSTART:${d}T190000`);
    expect(text).toContain(`DTEND:${d}T200000`);
    expect(text).toContain('TRIGGER:-PT5M');
    expect(text.startsWith('BEGIN:VCALENDAR')).toBe(true);
  });

  it('備份後還原，資料完全一致', async () => {
    await db.periods.bulkAdd(sampleTimetable());
    await db.tasks.add({ id: 't1', title: '國文作業', subject: '國語文', kind: 'homework', due: null, blocks: 2, priority: 1, done: false, notes: '', remindAt: null, createdAt: 1 });
    const json = await exportBackup();
    await Promise.all(db.tables.map((t) => t.clear()));
    expect(await db.tasks.count()).toBe(0);
    await importBackup(json);
    expect(await db.periods.count()).toBe(45);
    expect((await db.tasks.get('t1'))?.title).toBe('國文作業');
    await expect(importBackup('{"foo":1}')).rejects.toThrow('不是半時格的備份檔');
  });

  it('重複點擊不會存成兩筆', async () => {
    const d = todayKey();
    await Promise.all([assignBlocks(d, [40, 41], '複習：數學', '數學', 'review', null), assignBlocks(d, [40], '複習：數學', '數學', 'review', null)]);
    expect(await db.planned.where('[day+index]').equals([d, 40]).count()).toBe(1);
    expect(await db.planned.count()).toBe(2);
  });

  it('打卡改回未做時，任務恢復未完成', async () => {
    await db.tasks.add({ id: 'hw', title: '作業', subject: '', kind: 'homework', due: null, blocks: 1, priority: 1, done: false, notes: '', remindAt: null, createdAt: 1 });
    await assignBlocks(todayKey(), [40], '作業', '', 'task', 'hw');
    const row = (await db.planned.toArray())[0];
    await setStatus(row, 'done');
    expect((await db.tasks.get('hw'))?.done).toBe(true);
    await setStatus({ ...row, status: 'done' }, 'skipped');
    expect((await db.tasks.get('hw'))?.done).toBe(false);
  });

  it('刪光課表後不會自動帶回', async () => {
    await db.periods.bulkAdd(sampleTimetable());
    await db.periods.clear();
    await seedIfNeeded();
    expect(await db.periods.count()).toBe(0);
  });
});
