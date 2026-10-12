import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, updateRoutine } from '../db/db';
import type { LogRow, PlannedRow } from '../db/db';
import { blocksOn, deleteBlock, logsOn, moveBlock, setStatus, useBuilder, useLogsState, usePlanned, useRoutineLoaded } from '../db/hooks';
import { BLOCKS_PER_DAY, addDays, currentIndex, dayTitle, hoursText, rangeLabel, rangeLabelN, todayKey } from '../core/time';
import { freeIndices } from '../core/types';
import type { DayBlock, DayPlan } from '../core/types';
import { STATUS_NAME } from '../core/stats';
import { cat, DIARY_SECTIONS, daySummary, logTitle, nextToLog } from '../core/logs';
import { studyGoalFor } from '../core/routine';
import { ActionSheet, Section, TopBar } from '../ui/components';
import { KIND_ICON, kindBg, subjectColor } from '../ui/colors';
import { AssignSheet } from './AssignSheet';
import { SuggestionSheet } from './SuggestionSheet';
import { FocusTimer } from './FocusTimer';
import type { FocusTarget } from './FocusTimer';
import { SettingsSheet } from './Settings';
import { StatsSheet } from './Stats';
import { GoalSheet, LogSheet } from './LogSheet';

interface DayRow {
  start: number;
  count: number;
  block: DayBlock;
  planned?: PlannedRow;
  log?: LogRow;
}

/** 連續的同一固定時段合併成一列；可支配、彈性、已安排或已記錄的格各自一列。 */
function makeRows(plan: DayPlan, planned: Map<number, PlannedRow>, logs: Map<number, LogRow>, hideSleep: boolean): DayRow[] {
  const rows: DayRow[] = [];
  let i = 0;
  while (i < BLOCKS_PER_DAY) {
    const b = plan.blocks[i];
    const p = planned.get(i);
    const l = logs.get(i);
    if (p || l || b.kind === 'free' || b.kind === 'flexible') {
      rows.push({ start: i, count: 1, block: b, planned: p, log: l });
      i++;
    } else {
      let j = i + 1;
      while (j < BLOCKS_PER_DAY && plan.blocks[j].segmentId === b.segmentId && !planned.get(j) && !logs.get(j)) j++;
      if (!(hideSleep && b.kind === 'sleep')) rows.push({ start: i, count: j - i, block: b });
      i = j;
    }
  }
  return rows;
}

const STATUS_ICON = { planned: '○', done: '✅', partial: '◐', skipped: '✖️' } as const;

/** 讀書目標圓環 */
function Ring(props: { value: number; goal: number }) {
  const R = 46;
  const C = 2 * Math.PI * R;
  const pct = props.goal > 0 ? Math.min(1, props.value / props.goal) : 0;
  const reached = props.goal > 0 && props.value >= props.goal;
  return (
    <div className="ring-sm">
      <svg width="116" height="116" viewBox="0 0 116 116" aria-hidden="true">
        <circle cx="58" cy="58" r={R} fill="none" stroke="var(--accent)" strokeOpacity="0.14" strokeWidth="11" />
        <circle cx="58" cy="58" r={R} fill="none" stroke={reached ? 'var(--ok)' : 'var(--accent)'} strokeWidth="11" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - pct)} transform="rotate(-90 58 58)" style={{ transition: 'stroke-dashoffset .5s' }} />
      </svg>
      <div className="mid">
        {reached ? (
          <><div className="big ok">達標</div><div className="cap">讀書 {props.value} 格</div></>
        ) : (
          <><div className="cap" style={{ marginTop: 0, marginBottom: 2 }}>還差</div><div className="big">{Math.max(0, props.goal - props.value)}</div><div className="cap">格達標</div></>
        )}
      </div>
    </div>
  );
}

export function Today() {
  const builder = useBuilder();
  const planned = usePlanned();
  const { logs, loaded: logsLoaded } = useLogsState();
  const routineLoaded = useRoutineLoaded();
  const memos = useLiveQuery(() => db.memos.toArray(), []) ?? [];
  const [day, setDay] = useState(todayKey());
  const [now, setNow] = useState(new Date());
  const [hideSleep, setHideSleep] = useState(true);
  const [assign, setAssign] = useState<number | null>(null);
  const [logAt, setLogAt] = useState<number[] | null>(null);
  const [action, setAction] = useState<PlannedRow | null>(null);
  const [futureFree, setFutureFree] = useState<number | null>(null);
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const [sheet, setSheet] = useState<'suggest' | 'settings' | 'stats' | 'goal' | null>(null);

  // 每 30 秒更新時間；過了午夜（或隔天早上從背景回來），原本停在「今天」的畫面自動換到新的一天
  const shownToday = useRef(todayKey());
  useEffect(() => {
    const tick = () => {
      setNow(new Date());
      const t = todayKey();
      if (t !== shownToday.current) {
        const old = shownToday.current;
        shownToday.current = t;
        setDay((d) => (d === old ? t : d));
      }
    };
    const timer = setInterval(tick, 30000);
    const onVis = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const today = todayKey();
  const isToday = day === today;
  const nowIdx = currentIndex(now);
  // 「已過」的界線：今天看現在時間，過去的日子全部已過，未來的日子都還沒到
  const passIdx = isToday ? nowIdx : day < today ? BLOCKS_PER_DAY : -1;
  const plan = builder.plan(day);
  const dayPlanned = useMemo(() => blocksOn(day, planned), [day, planned]);
  const dayLogs = useMemo(() => logsOn(day, logs), [day, logs]);
  const rows = makeRows(plan, dayPlanned, dayLogs, hideSleep);
  const dayMemos = memos.filter((m) => !m.done && m.pinnedDay === day);
  const r = builder.routine;
  const goal = studyGoalFor(r, plan.isSchoolDay);
  const sum = daySummary(plan, logs, goal, isToday ? nowIdx : passIdx === BLOCKS_PER_DAY ? BLOCKS_PER_DAY : 0);

  const openLog = (indices?: number[]) => {
    if (indices) return setLogAt(indices);
    const target = nextToLog(plan, new Set(dayLogs.keys()), passIdx >= 0 ? Math.min(passIdx, BLOCKS_PER_DAY - 1) : -1);
    setLogAt(target !== null ? [target] : []);
  };

  const startFocus = () => {
    const from = isToday ? nowIdx : 0;
    const next = [...dayPlanned.keys()].sort((a, b) => a - b).find((i) => i >= from);
    const p = next !== undefined ? dayPlanned.get(next) : undefined;
    setFocus(p ? { title: p.title, subject: p.subject, plannedId: p.id } : { title: '專注時間', subject: '' });
  };

  const moveToNextFree = async (row: PlannedRow) => {
    let d = row.day;
    let after = row.index;
    for (let n = 0; n < 7; n++) {
      const taken = blocksOn(d, planned);
      const i = freeIndices(builder.plan(d)).find((x) => x > after && !taken.has(x));
      if (i !== undefined) {
        await moveBlock(row.id, d, i);
        return;
      }
      d = addDays(d, 1);
      after = -1;
    }
  };

  const tapRow = (row: DayRow) => {
    const k = row.block.kind;
    if (row.log && !row.planned) return setLogAt([row.start]);
    if (row.planned) return setAction(row.planned);
    if (k !== 'free' && k !== 'flexible') return;
    if (row.start <= passIdx) setLogAt([row.start]); // 已過或正在進行 → 記錄
    else setFutureFree(row.start); // 還沒到 → 安排或預先記錄
  };

  // 比例條：讀書／休閒／其他／未記錄／剩餘（以可支配＋彈性格為 100%）
  const bar = [
    { k: 'study', n: Math.min(sum.study, sum.budget), c: 'var(--accent)', name: '讀書' },
    { k: 'leisure', n: sum.leisure, c: 'var(--teal)', name: '休閒' },
    { k: 'other', n: sum.other, c: 'var(--text-2)', name: '其他' },
    { k: 'unlogged', n: sum.unlogged, c: 'var(--warn)', name: '未記錄' },
  ];
  const barTotal = Math.max(sum.budget, bar.reduce((a, b) => a + b.n, 0) + sum.remaining);

  return (
    <>
      <TopBar
        title={dayTitle(day)}
        left={
          <>
            <button className="icon-btn" aria-label="前一天" onClick={() => setDay(addDays(day, -1))}>‹</button>
            <button className="icon-btn" aria-label="後一天" onClick={() => setDay(addDays(day, 1))}>›</button>
          </>
        }
        right={
          <>
            {!isToday && <button className="text-btn" onClick={() => setDay(today)}>今天</button>}
            <button className="icon-btn" aria-label="週報" onClick={() => setSheet('stats')}>📊</button>
            <button className="icon-btn" aria-label="設定" onClick={() => setSheet('settings')}>⚙️</button>
          </>
        }
      />
      <div className="page">
        {routineLoaded && builder.classes.length === 0 && (
          <Section pad>
            <div style={{ fontWeight: 650, marginBottom: 4 }}>還沒有學校課表</div>
            <div className="small muted">到下方「課表」頁匯入課表檔，上學日的可支配格才會正確。</div>
          </Section>
        )}
        {routineLoaded && !r.studyGoalSet && (
          <Section pad>
            <div style={{ fontWeight: 650, marginBottom: 4 }}>先設定你的每日讀書目標</div>
            <div className="small muted" style={{ marginBottom: 10 }}>自己決定上學日、假日各想讀幾格（1 格 = 30 分鐘）。</div>
            <button className="btn" onClick={() => setSheet('goal')}>設定目標</button>
          </Section>
        )}

        <Section pad>
          <div className="summary">
            <Ring value={sum.study} goal={goal} />
            <div className="facts">
              <div><b>{sum.study}</b><span> / {goal} 格讀書</span></div>
              <div><b>{sum.remaining}</b><span> 格可支配還能用</span></div>
              {!logsLoaded ? null : sum.unlogged > 0 ? (
                <button className="text-btn" style={{ padding: 0, color: 'var(--warn)' }} onClick={() => openLog()}>
                  <b>{sum.unlogged}</b> 格還沒記錄 ›
                </button>
              ) : (
                <div className="muted small">{passIdx < 0 ? '這天還沒開始' : '已過的格都記錄了'}</div>
              )}
              {isToday && <div className="small muted">現在 {rangeLabel(nowIdx)}</div>}
            </div>
          </div>
          <div className="stack" aria-label="今天的時間分配">
            {bar.filter((b) => b.n > 0).map((b) => (
              <div key={b.k} style={{ width: `${(b.n / barTotal) * 100}%`, background: b.c, opacity: b.k === 'unlogged' ? 0.35 : 1 }} />
            ))}
          </div>
          <div className="stack-legend">
            {bar.map((b) => (
              <span key={b.k}><i style={{ background: b.c, opacity: b.k === 'unlogged' ? 0.35 : 1 }} />{b.name} {hoursText(b.n)}</span>
            ))}
          </div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn secondary" onClick={() => setSheet('suggest')}>✨ 排程建議</button>
            <button className="btn secondary" onClick={startFocus}>⏱ 專注計時</button>
          </div>
        </Section>

        {dayMemos.length > 0 && (
          <Section title="備忘">
            {dayMemos.map((m) => (
              <button key={m.id} className="row" onClick={() => db.memos.update(m.id, { done: true })}>
                <span>📌</span>
                <span className="grow">{m.text}</span>
                <span className="small muted">點一下完成</span>
              </button>
            ))}
          </Section>
        )}

        {DIARY_SECTIONS.map((sec) => {
          const secRows = rows.filter((x) => x.start >= sec.from && x.start < sec.to);
          if (!secRows.length) return null;
          const secLogs = [...dayLogs.values()].filter((l) => l.index >= sec.from && l.index < sec.to);
          const st = secLogs.filter((l) => cat(l.category).group === 'study').length;
          const le = secLogs.filter((l) => cat(l.category).group === 'leisure').length;
          return (
            <Section key={sec.id} title={sec.name}
              extra={
                <span className="small">
                  {secLogs.length ? `讀書 ${st}・休閒 ${le}` : ''}
                  {sec.id === 'morning' && (
                    <button className="text-btn" style={{ padding: '0 0 0 8px', fontSize: 13 }} onClick={() => setHideSleep(!hideSleep)}>{hideSleep ? '顯示睡眠' : '隱藏睡眠'}</button>
                  )}
                </span>
              }>
              {secRows.map((row) => {
                const isNow = isToday && nowIdx >= row.start && nowIdx < row.start + row.count;
                const isPast = row.start + row.count - 1 < passIdx && !isNow;
                const k = row.block.kind;
                const usable = k === 'free' || k === 'flexible';
                const cls = `row day-row tap${isNow ? ' now' : ''}${isPast && !row.log && !usable ? ' past' : ''}`;
                const bg = isNow || row.planned || row.log ? undefined : kindBg(k);
                return (
                  <div key={row.start} className={cls} style={{ background: bg }} onClick={() => tapRow(row)}>
                    <span className="time">{rangeLabelN(row.start, row.count)}</span>
                    {row.log ? (
                      <>
                        <span className="bar" style={{ background: row.log.subject ? subjectColor(row.log.subject) : cat(row.log.category).color }} />
                        <span className="grow">
                          <div style={{ fontWeight: 600 }}>{cat(row.log.category).icon} {logTitle(row.log)}</div>
                          {(row.log.note || row.planned) && (
                            <div className="sub">{row.planned ? `計畫：${row.planned.title}` : row.log.note}</div>
                          )}
                        </span>
                        {row.planned && <span className="status">{STATUS_ICON[row.planned.status]}</span>}
                      </>
                    ) : row.planned ? (
                      <>
                        <span className="bar" style={{ background: subjectColor(row.planned.subject) }} />
                        <span className="grow">
                          <div style={{ fontWeight: 600 }}>{row.planned.title}</div>
                          <div className="sub">計畫{row.start <= passIdx ? '・點一下打卡' : ''}</div>
                        </span>
                        <span className="status" title={STATUS_NAME[row.planned.status]}>{STATUS_ICON[row.planned.status]}</span>
                      </>
                    ) : usable ? (
                      row.start <= passIdx ? (
                        <span className="grow" style={{ color: 'var(--warn)' }}>＋ 記錄這格做了什麼</span>
                      ) : (
                        <span className="grow" style={{ color: k === 'flexible' ? 'var(--teal)' : 'var(--accent)' }}>
                          {k === 'flexible' ? '🛏️ 彈性就寢（可用）' : '＋ 可支配'}
                        </span>
                      )
                    ) : (
                      <>
                        <span className="grow muted">{KIND_ICON[k]} {row.block.title}</span>
                        {row.count > 1 && <span className="small muted">{row.count} 格</span>}
                      </>
                    )}
                    {isNow && <span className="chip now-chip">現在</span>}
                  </div>
                );
              })}
            </Section>
          );
        })}
        <div style={{ height: 70 }} />
      </div>

      <button className="fab" onClick={() => openLog()} aria-label="記錄">＋ 記錄</button>

      {logAt && <LogSheet day={day} initial={logAt} dayLogs={dayLogs} builder={builder} onClose={() => setLogAt(null)} />}
      {assign !== null && <AssignSheet day={day} index={assign} builder={builder} onClose={() => setAssign(null)} />}
      {sheet === 'suggest' && <SuggestionSheet startDay={day} builder={builder} onClose={() => setSheet(null)} />}
      {sheet === 'settings' && <SettingsSheet onClose={() => setSheet(null)} />}
      {sheet === 'stats' && <StatsSheet onClose={() => setSheet(null)} />}
      {sheet === 'goal' && (
        <GoalSheet builder={builder} onClose={() => setSheet(null)}
          onSave={(w, e) => updateRoutine({ studyGoalWeekday: w, studyGoalWeekend: e, studyGoalSet: true })} />
      )}
      {focus && <FocusTimer target={focus} onClose={() => setFocus(null)} />}
      {futureFree !== null && (
        <ActionSheet
          title={`${dayTitle(day)} ${rangeLabel(futureFree)}`}
          onClose={() => setFutureFree(null)}
          actions={[
            { label: '📅 安排讀書計畫', onClick: () => setAssign(futureFree) },
            { label: '✍️ 直接記錄', onClick: () => setLogAt([futureFree]) },
          ]}
        />
      )}
      {action && (
        <ActionSheet
          title={`${action.title}\n${dayTitle(action.day)} ${rangeLabel(action.index)}・${STATUS_NAME[action.status]}`}
          onClose={() => setAction(null)}
          actions={[
            { label: '✅ 完成', onClick: () => setStatus(action, 'done') },
            { label: '◐ 部分完成', onClick: () => setStatus(action, 'partial') },
            { label: '✖️ 未做', onClick: () => setStatus(action, 'skipped') },
            { label: '✍️ 實際做了別的事（記錄）', onClick: () => setLogAt([action.index]) },
            { label: '⏱ 開始專注', onClick: () => setFocus({ title: action.title, subject: action.subject, plannedId: action.id }) },
            { label: '移到下一個空格', onClick: () => moveToNextFree(action) },
            { label: '刪除這格安排', destructive: true, onClick: () => deleteBlock(action.id) },
          ]}
        />
      )}
    </>
  );
}
