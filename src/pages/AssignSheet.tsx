import { useState } from 'react';
import { TASK_KIND_ICON, TASK_KIND_NAME } from '../db/db';
import type { PlannedKind, TaskRow } from '../db/db';
import type { Builder } from '../db/hooks';
import { assignBlocks, blocksOn, scheduledCount, usePlanned, useTasks } from '../db/hooks';
import { consecutiveFree } from '../core/conflict';
import { REVIEW_PREFIX } from '../core/scheduler';
import { dayTitle, dueText, rangeLabelN } from '../core/time';
import { BlockCountRow, Section, Sheet } from '../ui/components';
import { subjectColor } from '../ui/colors';

/** 點空格後：選任務、複習科目或自訂內容放進去，可一次放連續數格。 */
export function AssignSheet(props: { day: string; index: number; builder: Builder; onClose: () => void }) {
  const { day, index, builder } = props;
  const planned = usePlanned();
  const tasks = useTasks();
  const [count, setCount] = useState(1);
  const [custom, setCustom] = useState('');
  const [customSubject, setCustomSubject] = useState('');

  const plan = builder.plan(day);
  const occupied = new Set(blocksOn(day, planned).keys());
  const indices = consecutiveFree(index, count, plan, occupied);
  const slots = indices.length ? indices : [index];

  const open = tasks
    .filter((t) => !t.done)
    .sort((a, b) => (a.due ?? '9999') .localeCompare(b.due ?? '9999') || b.priority - a.priority);
  const todays = new Set(builder.classesOn(day).map((c) => c.subject));
  const subjects = [...builder.subjects.filter((s) => todays.has(s)), ...builder.subjects.filter((s) => !todays.has(s))];

  const place = async (title: string, subject: string, kind: PlannedKind, taskId: string | null) => {
    await assignBlocks(day, slots, title, subject, kind, taskId);
    props.onClose();
  };

  const detail = (t: TaskRow) =>
    [TASK_KIND_NAME[t.kind], t.subject, t.due ? dueText(t.due) : '', `已排 ${scheduledCount(t, planned)}/${t.blocks} 格`]
      .filter(Boolean)
      .join(' · ');

  return (
    <Sheet title="安排這一格" onClose={props.onClose}>
      <Section title="時間">
        <div className="row">
          <span className="grow">{dayTitle(day)}</span>
          <span className="value">{rangeLabelN(index, Math.max(indices.length, 1))}</span>
        </div>
        <BlockCountRow label="連續格數" value={count} onChange={setCount} max={6} />
        {indices.length < count && (
          <div className="row small warn">後面只有 {indices.length} 格連續空格，只會放入這 {indices.length} 格。</div>
        )}
        {plan.blocks[index].kind === 'flexible' && (
          <div className="row small" style={{ color: 'var(--teal)' }}>這是彈性就寢格，安排後可能會晚睡。</div>
        )}
      </Section>

      {open.length > 0 && (
        <Section title="未完成任務">
          {open.map((t) => (
            <button key={t.id} className="row" onClick={() => place(t.title, t.subject, 'task', t.id)}>
              <span>{TASK_KIND_ICON[t.kind]}</span>
              <span className="grow">
                <div>{t.title}</div>
                <div className="sub">{detail(t)}</div>
              </span>
            </button>
          ))}
        </Section>
      )}

      <Section title="複習科目" footer="今天有上的科目排在前面">
        {subjects.map((s) => (
          <button key={s} className="row" onClick={() => place(REVIEW_PREFIX + s, s, 'review', null)}>
            <span className="bar" style={{ background: subjectColor(s) }} />
            <span className="grow">{REVIEW_PREFIX + s}</span>
            {todays.has(s) && <span className="small muted">今天有課</span>}
          </button>
        ))}
      </Section>

      <Section title="自訂內容">
        <div className="row">
          <input className="full" type="text" placeholder="例如：整理書包、休息、運動" value={custom} onChange={(e) => setCustom(e.target.value)} />
        </div>
        <div className="row">
          <span className="label">科目</span>
          <select value={customSubject} onChange={(e) => setCustomSubject(e.target.value)}>
            <option value="">不指定</option>
            {builder.subjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button className="row" disabled={!custom.trim()} style={{ color: custom.trim() ? 'var(--accent)' : 'var(--text-2)', justifyContent: 'center' }}
          onClick={() => place(custom.trim(), customSubject, 'custom', null)}>
          放入
        </button>
      </Section>
    </Sheet>
  );
}
