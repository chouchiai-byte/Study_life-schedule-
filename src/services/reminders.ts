import { useEffect, useRef } from 'react';
import { db } from '../db/db';
import { normalizeRoutine } from '../core/routine';
import { planDay } from '../core/planner';
import { loggableIndices } from '../core/logs';
import type { RoutineConfig } from '../core/routine';
import { addDays, dayKey, isoWeekday, minuteOfDay, parseTime, rangeLabel, startMinute, timeLabel } from '../core/time';
import { markFired, notify } from './notify';

/** 到時間了嗎：目標時間已到、且沒超過 graceMin 分鐘（App 晚一點打開仍會補提醒一次）。 */
const due = (nowMin: number, target: number, graceMin = 20) => nowMin >= target && nowMin - target <= graceMin;

/** App 開著時每 20 秒檢查一次：每格開始前 5 分鐘、提醒事項、任務提醒、睡前明日課表。 */
export function useReminderEngine() {
  const busy = useRef(false);
  useEffect(() => {
    const tick = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        await check(new Date());
      } finally {
        busy.current = false;
      }
    };
    tick();
    const t = setInterval(tick, 20000);
    const onVis = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
}

async function check(now: Date) {
  const today = dayKey(now);
  const nowMin = minuteOfDay(now);
  const routine: RoutineConfig = normalizeRoutine((await db.settings.get('routine'))?.value as Partial<RoutineConfig>);

  // 1. 每格開始前 5 分鐘（連續同一內容只提醒第一格）
  if (routine.notifyBeforeBlocks) {
    const rows = await db.planned.where('day').equals(today).toArray();
    const byIndex = new Map(rows.map((r) => [r.index, r]));
    for (const r of rows) {
      if (r.status !== 'planned') continue;
      const prev = byIndex.get(r.index - 1);
      if (prev && prev.title === r.title) continue;
      const at = startMinute(r.index) - 5;
      if (due(nowMin, at, 5) && markFired(`block:${r.id}:${r.day}:${r.index}`)) {
        await notify(`5 分鐘後：${r.title}`, rangeLabel(r.index));
      }
    }
  }

  // 2. 提醒事項
  const reminders = await db.reminders.toArray();
  for (const rm of reminders) {
    if (!rm.enabled || !rm.at) continue;
    const [d, t] = rm.at.split('T');
    const at = parseTime(t ?? '00:00');
    const applies =
      rm.repeat === 'daily' ? d <= today :
      rm.repeat === 'weekly' ? d <= today && isoWeekday(d) === isoWeekday(today) :
      d === today;
    if (applies && due(nowMin, at) && markFired(`rem:${rm.id}:${today}`)) {
      await notify(rm.title, rm.notes || timeLabel(at));
    }
  }

  // 3. 任務提醒
  const tasks = await db.tasks.toArray();
  for (const task of tasks) {
    if (task.done || !task.remindAt) continue;
    const [d, t] = task.remindAt.split('T');
    if (d === today && due(nowMin, parseTime(t ?? '00:00')) && markFired(`task:${task.id}:${task.remindAt}`)) {
      await notify(`任務提醒：${task.title}`, task.due ? `截止 ${task.due}` : undefined);
    }
  }

  // 4. 睡前提醒明日課表與備忘
  if (routine.bedtimeSummary && due(nowMin, routine.bedtimeSummaryAt) && markFired(`bed:${today}`)) {
    const tomorrow = addDays(today, 1);
    const holiday = await db.overrides.get(tomorrow);
    const wd = isoWeekday(tomorrow);
    const periods = holiday?.holiday ? [] : (await db.periods.where('weekday').equals(wd).toArray())
      .filter((p) => p.period > 0).sort((a, b) => a.period - b.period);
    const memos = (await db.memos.where('pinnedDay').equals(tomorrow).toArray()).filter((m) => !m.done);
    const parts: string[] = [];
    parts.push(periods.length ? `明天的課：${periods.map((p) => p.subject).join('、')}` : '明天沒有學校課程');
    if (memos.length) parts.push(`備忘：${memos.map((m) => m.text).join('；')}`);
    // 像飲食 App 提醒記錄晚餐：今晚已過但還沒記錄的格（不針對休閒或滑手機做任何提醒）
    const holidayToday = (await db.overrides.get(today))?.holiday ?? false;
    const todayClasses = holidayToday ? [] : (await db.periods.where('weekday').equals(isoWeekday(today)).toArray());
    const plan = planDay(today, todayClasses.map((p) => ({ weekday: p.weekday, period: p.period, start: p.start, end: p.end, subject: p.subject, teacher: p.teacher })),
      (await db.events.toArray()).filter((e) => e.active).map((e) => ({ id: e.id, title: e.title, kind: e.kind, weekdays: e.weekdays, date: e.date, start: e.start, end: e.end })),
      holidayToday, routine);
    const logged = new Set((await db.logs.where('day').equals(today).toArray()).map((l) => l.index));
    const nowIdx = Math.floor(nowMin / 30);
    const missing = loggableIndices(plan).filter((i) => i < nowIdx && !logged.has(i)).length;
    if (missing > 0) parts.push(`今天還有 ${missing} 格沒記錄，花 1 分鐘補記吧`);
    await notify('睡前提醒：準備明天', parts.join('\n'));
  }
}
