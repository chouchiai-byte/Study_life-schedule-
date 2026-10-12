import { BLOCKS_PER_DAY, blocksCovering } from './time';
import { isFixed } from './types';
import type { DayBlock, DayPlan } from './types';

/** 新時段佔用的格中，已經是固定格（上課、通勤、補習…）的部分。 */
export function conflicts(start: number, end: number, plan: DayPlan, ignoreSegmentId?: string): DayBlock[] {
  return blocksCovering(start, end)
    .map((i) => plan.blocks[i])
    .filter((b) => isFixed(b.kind) && (!ignoreSegmentId || b.segmentId !== ignoreSegmentId));
}

const usable = (plan: DayPlan, i: number, occupied: Set<number>, allowFlexible: boolean) => {
  const k = plan.blocks[i].kind;
  return (k === 'free' || (allowFlexible && k === 'flexible')) && !occupied.has(i);
};

/** 距離 near 最近、長度 length 的連續空格起點。 */
export function nearestFreeRun(
  length: number,
  near: number,
  plan: DayPlan,
  occupied: Set<number> = new Set(),
  allowFlexible = false,
): number | null {
  if (length <= 0) return null;
  let best: number | null = null;
  for (let s = 0; s + length <= BLOCKS_PER_DAY; s++) {
    let ok = true;
    for (let i = s; i < s + length; i++) if (!usable(plan, i, occupied, allowFlexible)) ok = false;
    if (!ok) continue;
    if (best === null || Math.abs(s - near) < Math.abs(best - near)) best = s;
  }
  return best;
}

/** 從 start 起最多 count 格中連續可用的格（遇到不可用就停）。 */
export function consecutiveFree(
  start: number,
  count: number,
  plan: DayPlan,
  occupied: Set<number>,
  allowFlexible = true,
): number[] {
  const out: number[] = [];
  for (let i = start; out.length < count && i < BLOCKS_PER_DAY; i++) {
    if (!usable(plan, i, occupied, allowFlexible)) break;
    out.push(i);
  }
  return out;
}
