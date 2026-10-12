/** 節次時間（分鐘）。0 = 早自習 */
export const PERIOD_TIMES: { period: number; start: number; end: number }[] = [
  { period: 0, start: 450, end: 480 }, // 07:30–08:00 早自習
  { period: 1, start: 490, end: 540 }, // 08:10–09:00
  { period: 2, start: 550, end: 600 },
  { period: 3, start: 610, end: 660 },
  { period: 4, start: 670, end: 720 },
  { period: 5, start: 810, end: 860 }, // 13:30–14:20
  { period: 6, start: 870, end: 920 },
  { period: 7, start: 930, end: 980 },
  { period: 8, start: 990, end: 1035 }, // 16:30–17:15
];

export const periodName = (p: number) => (p === 0 ? '早自習' : `第${p}節`);

export interface TimetableFile {
  app: 'halfblock-timetable';
  version: number;
  name?: string;
  periods: { weekday: number; period: number; start: number; end: number; subject: string; teacher: string }[];
}

/** 檢查並讀取課表檔（半時格課表 JSON）。格式不對時丟出說明錯誤。 */
export function parseTimetableFile(json: string): TimetableFile {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('這不是課表檔');
  }
  const f = data as TimetableFile;
  if (f?.app !== 'halfblock-timetable' || !Array.isArray(f.periods)) throw new Error('這不是半時格的課表檔');
  const ok = (n: unknown, lo: number, hi: number) => typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi;
  const periods = f.periods.filter(
    (p) => ok(p?.weekday, 1, 7) && ok(p?.period, 0, 12) && ok(p?.start, 0, 1440) && ok(p?.end, 0, 1440) && p.end > p.start && typeof p.subject === 'string' && p.subject.trim(),
  ).map((p) => ({ weekday: p.weekday, period: p.period, start: p.start, end: p.end, subject: p.subject.trim(), teacher: typeof p.teacher === 'string' ? p.teacher.trim() : '' }));
  if (!periods.length) throw new Error('課表檔裡沒有可用的課程');
  return { app: 'halfblock-timetable', version: 1, name: typeof f.name === 'string' ? f.name : undefined, periods };
}
