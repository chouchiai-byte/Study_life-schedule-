import { db } from '../db/db';
import { addDays, endMinute, parseTime, startMinute, todayKey } from '../core/time';

// 匯出行事曆檔（.ics）：交給 iPhone 行事曆在背景提醒（App 關閉也會響、Apple Watch 也收得到）。

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** 當地時間（浮動時間，跟隨手機時區） */
function local(day: string, minute: number): string {
  let d = day;
  let m = minute;
  if (m >= 1440) {
    d = addDays(day, 1);
    m -= 1440;
  }
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${d.replace(/-/g, '')}T${hh}${mm}00`;
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function event(lines: string[], o: { uid: string; start: string; end: string; summary: string; desc?: string; rrule?: string; alarmMin: number }) {
  lines.push(
    'BEGIN:VEVENT',
    `UID:${o.uid}@halfblock`,
    `DTSTAMP:${stamp()}`,
    `DTSTART:${o.start}`,
    `DTEND:${o.end}`,
    `SUMMARY:${esc(o.summary)}`,
  );
  if (o.desc) lines.push(`DESCRIPTION:${esc(o.desc)}`);
  if (o.rrule) lines.push(`RRULE:${o.rrule}`);
  lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(o.summary)}`, `TRIGGER:-PT${o.alarmMin}M`, 'END:VALARM', 'END:VEVENT');
}

/** 未來 days 天的安排（連續同一內容合併成一個事件）＋提醒事項＋任務提醒。 */
export async function buildIcs(days = 7): Promise<{ text: string; count: number }> {
  const from = todayKey();
  const to = addDays(from, days - 1);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HalfBlock//ZH-TW', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:半時格'];
  let count = 0;

  const rows = (await db.planned.where('day').between(from, to, true, true).toArray())
    .filter((r) => r.status === 'planned')
    .sort((a, b) => (a.day === b.day ? a.index - b.index : a.day < b.day ? -1 : 1));
  for (let i = 0; i < rows.length; ) {
    const r = rows[i];
    let j = i + 1;
    while (j < rows.length && rows[j].day === r.day && rows[j].index === rows[j - 1].index + 1 && rows[j].title === r.title) j++;
    event(lines, {
      uid: `plan-${r.id}`,
      start: local(r.day, startMinute(r.index)),
      end: local(r.day, endMinute(rows[j - 1].index)),
      summary: r.title,
      desc: r.subject ? `科目：${r.subject}` : '半時格安排',
      alarmMin: 5,
    });
    count++;
    i = j;
  }

  for (const rm of await db.reminders.toArray()) {
    if (!rm.enabled || !rm.at) continue;
    const [d, t] = rm.at.split('T');
    const m = parseTime(t ?? '00:00');
    event(lines, {
      uid: `rem-${rm.id}`,
      start: local(d, m),
      end: local(d, m + 15),
      summary: rm.title,
      desc: rm.notes,
      rrule: rm.repeat === 'daily' ? 'FREQ=DAILY' : rm.repeat === 'weekly' ? 'FREQ=WEEKLY' : undefined,
      alarmMin: 0,
    });
    count++;
  }

  for (const task of await db.tasks.toArray()) {
    if (task.done || !task.remindAt || task.remindAt.slice(0, 10) < from) continue;
    const [d, t] = task.remindAt.split('T');
    const m = parseTime(t ?? '00:00');
    event(lines, {
      uid: `task-${task.id}`,
      start: local(d, m),
      end: local(d, m + 15),
      summary: `任務：${task.title}`,
      desc: task.due ? `截止 ${task.due}` : undefined,
      alarmMin: 0,
    });
    count++;
  }

  lines.push('END:VCALENDAR');
  return { text: lines.join('\r\n') + '\r\n', count };
}
