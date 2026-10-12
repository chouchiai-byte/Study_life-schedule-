import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  DndContext, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import type { PlannedRow } from '../db/db';
import { blocksOn, deleteBlock, logsOn, moveBlock, setStatus, useBuilder, useLogs, usePlanned } from '../db/hooks';
import type { LogRow } from '../db/db';
import { cat } from '../core/logs';
import { LogSheet } from './LogSheet';
import { BLOCKS_PER_DAY, addDays, blockLabel, currentIndex, dayTitle, days, monthDay, mondayOf, rangeLabel, todayKey, weekdayName } from '../core/time';
import { freeIndices, KIND_INFO } from '../core/types';
import type { BlockKind, DayPlan } from '../core/types';
import { REVIEW_PREFIX } from '../core/scheduler';
import { STATUS_NAME } from '../core/stats';
import { ActionSheet, TopBar } from '../ui/components';
import { kindBg, subjectColor } from '../ui/colors';
import { AssignSheet } from './AssignSheet';
import { SuggestionSheet } from './SuggestionSheet';

const LEGEND: BlockKind[] = ['free', 'school', 'commute', 'meal', 'course', 'event', 'flexible', 'sleep'];

/** 週格：7 天 × 48 格。長按已安排的格可拖到其他空格；也可用「移動」再點目標空格。 */
export function Week() {
  const builder = useBuilder();
  const planned = usePlanned();
  const logs = useLogs();
  const [weekStart, setWeekStart] = useState(mondayOf(todayKey()));
  const [showEarly, setShowEarly] = useState(false);
  const [assign, setAssign] = useState<{ day: string; index: number } | null>(null);
  const [action, setAction] = useState<PlannedRow | null>(null);
  const [moving, setMoving] = useState<PlannedRow | null>(null);
  const [logAt, setLogAt] = useState<{ day: string; index: number; d: number } | null>(null);
  const [suggest, setSuggest] = useState(false);
  const [now, setNow] = useState(new Date());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // 預設捲到 18:00 左右（晚上的可支配格）
    const el = scrollRef.current?.querySelector<HTMLElement>('[data-row="36"]');
    el?.scrollIntoView({ block: 'start' });
  }, []);

  const weekDays = days(weekStart, 7);
  const plans = weekDays.map((d) => builder.plan(d));
  const byDay = useMemo(() => weekDays.map((d) => blocksOn(d, planned)), [weekStart, planned]); // eslint-disable-line react-hooks/exhaustive-deps
  const logsByDay = useMemo(() => weekDays.map((d) => logsOn(d, logs)), [weekStart, logs]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalFree = plans.reduce((n, p) => n + freeIndices(p).length, 0);
  const today = todayKey();
  const nowIdx = currentIndex(now);
  const rows = Array.from({ length: BLOCKS_PER_DAY }, (_, i) => i).filter((i) => showEarly || i >= 12);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 280, tolerance: 8 } }),
  );

  const onDragEnd = async (e: DragEndEvent) => {
    const row = planned.find((p) => p.id === e.active.id);
    const target = e.over?.id ? String(e.over.id) : null;
    if (!row || !target) return;
    const [day, idx] = target.split('#');
    await moveBlock(row.id, day, Number(idx));
  };

  const tapEmpty = async (day: string, index: number) => {
    const d = weekDays.indexOf(day);
    if (!moving && d >= 0 && logsByDay[d].has(index)) {
      setLogAt({ day, index, d });
      return;
    }
    if (moving) {
      await moveBlock(moving.id, day, index);
      setMoving(null);
    } else {
      setAssign({ day, index });
    }
  };

  return (
    <>
      <TopBar
        title={`${monthDay(weekStart)}–${monthDay(addDays(weekStart, 6))}`}
        left={
          <>
            <button className="icon-btn" aria-label="上一週" onClick={() => setWeekStart(addDays(weekStart, -7))}>‹</button>
            <button className="icon-btn" aria-label="下一週" onClick={() => setWeekStart(addDays(weekStart, 7))}>›</button>
          </>
        }
        right={
          <>
            <button className="text-btn small" style={{ fontSize: 13 }} onClick={() => setShowEarly(!showEarly)}>{showEarly ? '隱藏凌晨' : '顯示凌晨'}</button>
            <button className="icon-btn" aria-label="排程建議" onClick={() => setSuggest(true)}>✨</button>
          </>
        }
      />
      {moving && (
        <div className="banner" style={{ position: 'sticky', top: 0 }}>
          <span className="grow" style={{ flex: 1 }}>移動「{moving.title}」：點一個空格放入</span>
          <button className="text-btn" onClick={() => setMoving(null)}>取消</button>
        </div>
      )}
      <div className="page" ref={scrollRef}>
        <div className="week-head">
          <div className="d" style={{ fontSize: 9.5 }}>可支配<br /><b>{totalFree}</b></div>
          {weekDays.map((d, i) => (
            <div key={d} className={d === today ? 'd today' : 'd'}>
              <b>{weekdayName(d)}</b>
              <div>{monthDay(d)}</div>
              <div className="muted" style={{ fontSize: 9.5 }}>{byDay[i].size}/{freeIndices(plans[i]).length}</div>
            </div>
          ))}
        </div>
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="week-grid">
            {rows.map((index) => (
              <Row key={index} index={index} weekDays={weekDays} plans={plans} byDay={byDay} logsByDay={logsByDay} today={today} nowIdx={nowIdx}
                moving={moving} onTapPlanned={setAction} onTapEmpty={tapEmpty} />
            ))}
          </div>
        </DndContext>
        <div className="legend">
          {LEGEND.map((k) => (
            <span key={k}><i style={{ background: k === 'free' ? 'var(--k-free)' : kindBg(k), border: k === 'free' ? '1px dashed var(--accent)' : undefined }} />{KIND_INFO[k].name}</span>
          ))}
        </div>
        <div className="section-foot" style={{ margin: '0 14px' }}>點空格安排內容；長按彩色格可拖到其他空格。上方數字為「已安排／可支配」格數。</div>
      </div>

      {logAt && <LogSheet day={logAt.day} initial={[logAt.index]} dayLogs={logsByDay[logAt.d]} builder={builder} onClose={() => setLogAt(null)} />}
      {assign && <AssignSheet day={assign.day} index={assign.index} builder={builder} onClose={() => setAssign(null)} />}
      {suggest && <SuggestionSheet startDay={weekStart} builder={builder} onClose={() => setSuggest(false)} />}
      {action && (
        <ActionSheet
          title={`${action.title}\n${dayTitle(action.day)} ${rangeLabel(action.index)}・${STATUS_NAME[action.status]}`}
          onClose={() => setAction(null)}
          actions={[
            { label: '✅ 完成', onClick: () => setStatus(action, 'done') },
            { label: '◐ 部分完成', onClick: () => setStatus(action, 'partial') },
            { label: '✖️ 未做', onClick: () => setStatus(action, 'skipped') },
            { label: '移動到其他格', onClick: () => setMoving(action) },
            { label: '刪除這格安排', destructive: true, onClick: () => deleteBlock(action.id) },
          ]}
        />
      )}
    </>
  );
}

function Row(props: {
  index: number;
  weekDays: string[];
  plans: DayPlan[];
  byDay: Map<number, PlannedRow>[];
  logsByDay: Map<number, LogRow>[];
  today: string;
  nowIdx: number;
  moving: PlannedRow | null;
  onTapPlanned: (p: PlannedRow) => void;
  onTapEmpty: (day: string, index: number) => void;
}) {
  const { index } = props;
  return (
    <>
      <div className="t" data-row={index}>{index % 2 === 0 ? blockLabel(index) : ''}</div>
      {props.weekDays.map((day, d) => {
        const isNow = day === props.today && props.nowIdx === index;
        const p = props.byDay[d].get(index);
        if (p) return <PlannedCell key={day} row={p} isNow={isNow} moving={props.moving?.id === p.id} onTap={() => props.onTapPlanned(p)} />;
        const kind = props.plans[d].blocks[index].kind;
        const log = props.logsByDay[d].get(index);
        return <EmptyCell key={day} day={day} index={index} kind={kind} isNow={isNow} log={log} onTap={() => props.onTapEmpty(day, index)} />;
      })}
    </>
  );
}

function PlannedCell(props: { row: PlannedRow; isNow: boolean; moving: boolean; onTap: () => void }) {
  const { row } = props;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: row.id });
  const style: CSSProperties = {
    background: subjectColor(row.subject),
    opacity: row.status === 'skipped' ? 0.35 : isDragging ? 0.85 : 1,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    zIndex: isDragging ? 10 : undefined,
    boxShadow: isDragging ? '0 6px 16px rgba(0,0,0,.3)' : undefined,
  };
  const label = row.title.replace(REVIEW_PREFIX, '').slice(0, 3);
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} onClick={props.onTap}
      className={`cell planned${props.isNow ? ' now' : ''}${props.moving ? ' moving' : ''}`} style={style}>
      {label}
      {row.status === 'done' && <span className="tick">✓</span>}
    </div>
  );
}

function EmptyCell(props: { day: string; index: number; kind: BlockKind; isNow: boolean; log?: LogRow; onTap: () => void }) {
  const usable = props.kind === 'free' || props.kind === 'flexible';
  const { setNodeRef, isOver } = useDroppable({ id: `${props.day}#${props.index}`, disabled: !usable });
  return (
    <div ref={setNodeRef} onClick={usable || props.log ? props.onTap : undefined}
      className={`cell${usable ? ' usable' : ''}${props.isNow ? ' now' : ''}${isOver && usable ? ' drop-over' : ''}`}
      style={props.log
        ? { background: `color-mix(in srgb, ${cat(props.log.category).color} 30%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }
        : { background: props.kind === 'free' ? 'var(--k-free)' : kindBg(props.kind), border: props.kind === 'free' ? '1px dashed color-mix(in srgb, var(--accent) 35%, transparent)' : undefined }}>
      {props.log ? cat(props.log.category).icon : null}
    </div>
  );
}
