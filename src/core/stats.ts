import { addDays } from './time';

export type BlockStatus = 'planned' | 'done' | 'partial' | 'skipped';

export const STATUS_NAME: Record<BlockStatus, string> = {
  planned: '未打卡',
  done: '完成',
  partial: '部分',
  skipped: '未做',
};

export interface WeekStats {
  planned: number;
  done: number;
  partial: number;
  skipped: number;
  total: number;
  checkedIn: number;
  /** (完成 + 部分 × 0.5) ÷ 已打卡格數 */
  completionRate: number;
  /** 完成或部分完成的格數，依科目 */
  bySubject: Record<string, number>;
}

export function computeStats(records: { subject?: string; status: BlockStatus }[]): WeekStats {
  const s = { planned: 0, done: 0, partial: 0, skipped: 0 };
  const bySubject: Record<string, number> = {};
  for (const r of records) {
    s[r.status] += 1;
    if ((r.status === 'done' || r.status === 'partial') && r.subject) {
      bySubject[r.subject] = (bySubject[r.subject] ?? 0) + 1;
    }
  }
  const checkedIn = s.done + s.partial + s.skipped;
  return {
    ...s,
    total: checkedIn + s.planned,
    checkedIn,
    completionRate: checkedIn === 0 ? 0 : (s.done + s.partial * 0.5) / checkedIn,
    bySubject,
  };
}

const achieved = (list: BlockStatus[]) => {
  const done = list.filter((x) => x === 'done').length;
  const skipped = list.filter((x) => x === 'skipped').length;
  return done > 0 && done >= skipped;
};

/** 連續達成天數：每天至少 1 格完成，且完成不少於未做。今天尚未達成時從昨天算起。 */
export function streak(byDay: Record<string, BlockStatus[]>, today: string): number {
  let day = today;
  if (!achieved(byDay[day] ?? [])) day = addDays(day, -1);
  let count = 0;
  while (achieved(byDay[day] ?? [])) {
    count++;
    day = addDays(day, -1);
  }
  return count;
}
