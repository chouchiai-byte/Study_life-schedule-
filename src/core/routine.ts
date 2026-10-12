/** 作息設定（單位：一天中的第幾分鐘）。預設值依 2026/10/12 確認的實際作息。 */
export interface RoutineConfig {
  // 上學日
  wake: number;
  leaveHome: number;
  schoolStart: number;
  schoolEnd: number;
  commuteMinutes: number;
  // 每天共通
  dinnerStart: number;
  dinnerMinutes: number;
  bathStart: number;
  bathMinutes: number;
  bedtimeEarliest: number;
  bedtimeLatest: number;
  // 週末與停課日
  weekendWake: number;
  weekendBreakfastMinutes: number;
  lunchStart: number;
  lunchMinutes: number;
  // 排程
  maxFillRatio: number;
  dailyReviewSubjects: string[];
  // 讀書目標（孩子自訂，單位：格）
  studyGoalWeekday: number;
  studyGoalWeekend: number;
  studyGoalSet: boolean;
  // 提醒
  notifyBeforeBlocks: boolean;
  bedtimeSummary: boolean;
  bedtimeSummaryAt: number;
}

export const DEFAULT_ROUTINE: RoutineConfig = {
  wake: 390, // 06:30
  leaveHome: 405, // 06:45 出門
  schoolStart: 450, // 07:30 早自習
  schoolEnd: 1035, // 17:15 第 8 節結束
  commuteMinutes: 45,
  dinnerStart: 1080, // 18:00
  dinnerMinutes: 60,
  bathStart: 1290, // 21:30
  bathMinutes: 30,
  bedtimeEarliest: 1380, // 23:00 起為彈性就寢格
  bedtimeLatest: 1440, // 最晚 24:00
  weekendWake: 450, // 07:30
  weekendBreakfastMinutes: 30,
  lunchStart: 720,
  lunchMinutes: 60,
  maxFillRatio: 0.8,
  dailyReviewSubjects: ['國語文', '英語文', '數學'],
  studyGoalWeekday: 4,
  studyGoalWeekend: 6,
  studyGoalSet: false,
  notifyBeforeBlocks: true,
  bedtimeSummary: true,
  bedtimeSummaryAt: 1290, // 21:30
};

/** 舊資料缺少的欄位補上預設值。 */
export function normalizeRoutine(partial: Partial<RoutineConfig> | null | undefined): RoutineConfig {
  const out = { ...DEFAULT_ROUTINE } as Record<string, unknown>;
  if (partial) {
    for (const [k, v] of Object.entries(partial)) {
      if (k in DEFAULT_ROUTINE && v !== undefined && v !== null) out[k] = v;
    }
  }
  return out as unknown as RoutineConfig;
}

/** 當天的讀書目標格數：上學日用平日目標，假日與停課日用週末目標。 */
export const studyGoalFor = (r: RoutineConfig, isSchoolDay: boolean) => (isSchoolDay ? r.studyGoalWeekday : r.studyGoalWeekend);
