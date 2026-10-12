import { blocksCovering } from './time';

export type BlockKind =
  | 'sleep' // 睡眠
  | 'flexible' // 彈性就寢格：可用，但不自動排任務
  | 'school' // 在校
  | 'commute' // 通勤
  | 'meal' // 用餐
  | 'personal' // 起床準備、盥洗
  | 'course' // 自建課程（補習、線上課、才藝）
  | 'event' // 自訂時段（社團、家庭活動）
  | 'free'; // 可支配

export const KIND_INFO: Record<BlockKind, { name: string; priority: number }> = {
  course: { name: '課程', priority: 7 },
  event: { name: '活動', priority: 7 },
  school: { name: '在校', priority: 6 },
  commute: { name: '通勤', priority: 5 },
  meal: { name: '用餐', priority: 4 },
  personal: { name: '盥洗準備', priority: 3 },
  flexible: { name: '彈性', priority: 2 },
  sleep: { name: '睡眠', priority: 1 },
  free: { name: '可支配', priority: 0 },
};

export const isFixed = (k: BlockKind) => k !== 'free' && k !== 'flexible';

export interface TimeSegment {
  id: string;
  title: string;
  kind: BlockKind;
  start: number; // 分鐘
  end: number; // 分鐘（不含）
}

export const segmentBlocks = (s: TimeSegment) => blocksCovering(s.start, s.end);

export interface DayBlock {
  index: number;
  kind: BlockKind;
  title: string;
  segmentId: string | null;
}

export interface DayPlan {
  day: string;
  isSchoolDay: boolean;
  blocks: DayBlock[];
  segments: TimeSegment[];
}

export const freeIndices = (p: DayPlan) => p.blocks.filter((b) => b.kind === 'free').map((b) => b.index);
export const flexibleIndices = (p: DayPlan) => p.blocks.filter((b) => b.kind === 'flexible').map((b) => b.index);

/** 學校課表的一節課 */
export interface ClassSlot {
  weekday: number; // 1 = 週一 … 5 = 週五
  period: number; // 0 = 早自習，1–8
  start: number;
  end: number;
  subject: string;
  teacher: string;
}

/** 自建課程或自訂時段：每週重複（weekdays）或單次（date） */
export interface RecurringEvent {
  id: string;
  title: string;
  kind: 'course' | 'event';
  weekdays: number[];
  date?: string | null;
  start: number;
  end: number;
}
