import type { BlockKind } from '../core/types';

/** 每種格子的底色（CSS 變數，深淺色模式各自定義於 styles.css）。 */
export const kindBg = (k: BlockKind) => `var(--k-${k})`;

export const KIND_ICON: Record<BlockKind, string> = {
  sleep: '🌙',
  flexible: '🛏️',
  school: '🏫',
  commute: '🚌',
  meal: '🍱',
  personal: '🚿',
  course: '📘',
  event: '⭐',
  free: '＋',
};

const PALETTE = ['#3b82f6', '#16a34a', '#f97316', '#9333ea', '#db2777', '#0d9488', '#a16207', '#4f46e5', '#0891b2', '#059669', '#dc2626'];

/** 依科目給固定顏色，同一科在每個畫面都同色。 */
export function subjectColor(subject: string): string {
  if (!subject) return 'var(--accent)';
  if (subject === '國語文') return '#dc2626';
  if (subject === '英語文') return '#2563eb';
  if (subject === '數學') return '#16a34a';
  let sum = 0;
  for (const ch of subject) sum += ch.codePointAt(0) ?? 0;
  return PALETTE[sum % PALETTE.length];
}
