import { useMemo, useState } from 'react';
import type { Builder } from '../db/hooks';
import { deleteLog, saveLogs, useLogs } from '../db/hooks';
import type { LogRow } from '../db/db';
import { CATEGORY, frequentCategories, loggableIndices } from '../core/logs';
import type { LogCategory } from '../core/logs';
import { addDays, blockLabel, currentIndex, dayTitle, rangeLabel, todayKey } from '../core/time';
import { Section, Sheet, useToast } from '../ui/components';
import { subjectColor } from '../ui/colors';

/**
 * 快速記錄：選格（可多選）→ 點類別 →（讀書再點科目）→ 完成。
 * 像飲食 App 記錄一餐一樣，3 秒內完成。
 */
export function LogSheet(props: { day: string; initial: number[]; dayLogs: Map<number, LogRow>; builder: Builder; onClose: () => void }) {
  const { day, builder } = props;
  const logs = useLogs();
  const toast = useToast();
  const plan = builder.plan(day);
  // 當天已記錄的內容由呼叫的畫面傳入（已載入），編輯舊記錄時才能正確帶入原本內容
  const dayLogs = props.dayLogs;

  // 編輯單一已記錄的格時，帶入原本的內容
  const editing = props.initial.length === 1 ? dayLogs.get(props.initial[0]) : undefined;
  const [selected, setSelected] = useState<number[]>(props.initial);
  const [category, setCategory] = useState<LogCategory | null>(editing?.category ?? null);
  const [subject, setSubject] = useState(editing?.subject ?? '');
  const [label, setLabel] = useState(editing?.label ?? '');
  const [note, setNote] = useState(editing?.note ?? '');

  const today = todayKey();
  const lastIndex = day === today ? currentIndex(new Date()) : day < today ? 47 : -1;
  // 可選的格：需要記錄且時間已到的格＋已記錄過的格＋一開始帶入的格，最近的排前面
  const choices = useMemo(() => {
    const set = new Set<number>([...loggableIndices(plan).filter((i) => i <= lastIndex), ...dayLogs.keys(), ...props.initial]);
    return [...set].sort((a, b) => b - a);
  }, [plan, lastIndex, dayLogs, props.initial]);

  const recent = logs.filter((l) => l.day >= addDays(today, -14));
  const order = frequentCategories(recent);
  const recentLabels = [...new Set(recent.filter((l) => l.category === 'leisure' && l.label).map((l) => l.label))].slice(0, 6);
  const todays = new Set(builder.classesOn(day).map((c) => c.subject));
  const subjects = [...builder.subjects.filter((s) => todays.has(s)), ...builder.subjects.filter((s) => !todays.has(s))];

  const toggle = (i: number) => setSelected(selected.includes(i) ? selected.filter((x) => x !== i) : [...selected, i]);
  const info = category ? CATEGORY[category] : null;
  const ready = selected.length > 0 && category !== null && (!info?.customLabel || label.trim().length > 0);

  const save = async () => {
    if (!category) return;
    await saveLogs(day, selected, { category, subject: info?.needsSubject ? subject : '', label: info?.customLabel ? label : '', note });
    toast(`已記錄 ${selected.length} 格`);
    props.onClose();
  };

  const remove = async () => {
    if (editing) await deleteLog(editing.id);
    props.onClose();
  };

  return (
    <Sheet title="記錄" onClose={props.onClose} onDone={save} doneText="完成" doneDisabled={!ready}>
      <Section title={`${dayTitle(day)}・選擇時間（可多選）`} footer={selected.length ? `已選 ${selected.length} 格：${[...selected].sort((a, b) => a - b).map(blockLabel).join('、')}` : '點選要記錄的格'}>
        <div className="chips">
          {choices.map((i) => {
            const on = selected.includes(i);
            const done = dayLogs.has(i);
            return (
              <button key={i} className={on ? 'pick on' : 'pick'} onClick={() => toggle(i)} title={rangeLabel(i)}>
                {blockLabel(i)}{done && !on ? ' ✓' : ''}
              </button>
            );
          })}
          {choices.length === 0 && <span className="muted small">這天沒有需要記錄的格</span>}
        </div>
      </Section>

      <Section title="做了什麼">
        <div className="cat-grid">
          {order.map((c) => (
            <button key={c} className={category === c ? 'cat on' : 'cat'} style={{ ['--c' as string]: CATEGORY[c].color }} onClick={() => setCategory(c)}>
              <span className="ic">{CATEGORY[c].icon}</span>
              {CATEGORY[c].name}
            </button>
          ))}
        </div>
      </Section>

      {info?.needsSubject && (
        <Section title="科目（可不選）">
          <div className="chips">
            {subjects.map((s) => (
              <button key={s} className={subject === s ? 'pick on' : 'pick'} style={subject === s ? { background: subjectColor(s), borderColor: subjectColor(s) } : undefined}
                onClick={() => setSubject(subject === s ? '' : s)}>
                {s}
              </button>
            ))}
          </div>
        </Section>
      )}

      {info?.customLabel && (
        <Section title="休閒名稱">
          <div className="row"><input id="log-label" className="full" type="text" placeholder="例如：彈吉他、追劇、畫畫" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
          {recentLabels.length > 0 && (
            <div className="chips" style={{ padding: '0 14px 12px' }}>
              {recentLabels.map((l) => <button key={l} className={label === l ? 'pick on' : 'pick'} onClick={() => setLabel(l)}>{l}</button>)}
            </div>
          )}
        </Section>
      )}

      <Section title="備註（可留白）">
        <div className="row"><input id="log-note" className="full" type="text" placeholder="例如：講義 p.20–25" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </Section>

      {editing && (
        <Section>
          <button className="row danger" style={{ justifyContent: 'center' }} onClick={remove}>刪除這筆記錄</button>
        </Section>
      )}
    </Sheet>
  );
}

/** 孩子自訂每日讀書目標。 */
export function GoalSheet(props: { builder: Builder; onClose: () => void; onSave: (weekday: number, weekend: number) => void }) {
  const r = props.builder.routine;
  const [weekday, setWeekday] = useState(r.studyGoalWeekday);
  const [weekend, setWeekend] = useState(r.studyGoalWeekend);
  const today = todayKey();
  // 找本週的一個上學日與一個假日，顯示可用格數作參考
  const week = Array.from({ length: 7 }, (_, i) => props.builder.plan(addDays(today, i)));
  const school = week.find((p) => p.isSchoolDay);
  const off = week.find((p) => !p.isSchoolDay);
  const cap = (p?: typeof school) => (p ? loggableIndices(p).length : 0);
  const row = (label: string, v: number, set: (n: number) => void, max: number) => (
    <div className="row">
      <div className="grow">
        {label}
        <div className="sub">{v} 格 = {v / 2} 小時{max ? `（可用最多 ${max} 格）` : ''}</div>
      </div>
      <span style={{ display: 'inline-flex', gap: 6 }}>
        <button className="btn plain" style={{ padding: '4px 12px' }} disabled={v <= 0} onClick={() => set(Math.max(0, v - 1))}>−</button>
        <button className="btn plain" style={{ padding: '4px 12px' }} disabled={v >= 20} onClick={() => set(Math.min(20, v + 1))}>＋</button>
      </span>
    </div>
  );
  return (
    <Sheet title="每日讀書目標" onClose={props.onClose} onDone={() => { props.onSave(weekday, weekend); props.onClose(); }} doneText="儲存">
      <div className="section-foot" style={{ margin: '14px 20px 0' }}>
        自己決定每天想讀幾格（1 格 = 30 分鐘）。讀書、作業、補習課程都算。目標隨時可以在設定裡改。
      </div>
      <Section>
        {row('上學日', weekday, setWeekday, cap(school))}
        {row('假日與停課日', weekend, setWeekend, cap(off))}
      </Section>
    </Sheet>
  );
}
