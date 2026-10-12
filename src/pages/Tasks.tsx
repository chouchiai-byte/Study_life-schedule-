import { useState } from 'react';
import { db, TASK_KIND_ICON, TASK_KIND_NAME, uid } from '../db/db';
import type { TaskKind, TaskRow } from '../db/db';
import { doneCount, scheduledCount, useBuilder, usePlanned, useTasks } from '../db/hooks';
import { addDays, daysBetween, dueText, monthDay, todayKey, weekdayName } from '../core/time';
import { BlockCountRow, Chip, Progress, Section, Sheet, Toggle, TopBar, useConfirm, useToast } from '../ui/components';
import { subjectColor } from '../ui/colors';
import { buildIcs } from '../services/ics';
import { FileReady } from '../ui/FileReady';
import type { ReadyFile } from '../ui/FileReady';

/** 任務清單：作業、小考、段考（自建日期）、報告。依截止日分組。 */
export function Tasks() {
  const tasks = useTasks();
  const planned = usePlanned();
  const toast = useToast();
  const [editing, setEditing] = useState<TaskRow | 'new' | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [ready, setReady] = useState<ReadyFile | null>(null);
  const today = todayKey();
  const dd = (t: TaskRow) => (t.due ? daysBetween(today, t.due) : Infinity);

  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done).sort((a, b) => b.createdAt - a.createdAt);
  const exams = open.filter((t) => t.kind === 'exam' && t.due).sort((a, b) => (a.due! < b.due! ? -1 : 1));
  const sorter = (a: TaskRow, b: TaskRow) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || b.priority - a.priority;
  const groups: [string, TaskRow[], string][] = [
    ['逾期', open.filter((t) => dd(t) < 0), 'var(--danger)'],
    ['今天到期', open.filter((t) => dd(t) === 0), 'var(--warn)'],
    ['明天到期', open.filter((t) => dd(t) === 1), 'var(--warn)'],
    ['本週', open.filter((t) => dd(t) >= 2 && dd(t) <= 7), ''],
    ['之後', open.filter((t) => t.due && dd(t) > 7), ''],
    ['沒有截止日', open.filter((t) => !t.due), ''],
  ];

  const toggleDone = (t: TaskRow) => db.tasks.update(t.id, { done: !t.done });

  const exportIcs = async () => {
    const { text, count } = await buildIcs(7);
    if (count === 0) {
      toast('沒有可匯出的內容', '先在「今天」或「週格」安排時段，或新增提醒事項。', 'ℹ️');
      return;
    }
    setReady({ blob: new Blob([text], { type: 'text/calendar;charset=utf-8' }), name: `半時格_${today}.ics`, hint: `共 ${count} 個事件；開啟後選「全部加入」行事曆` });
  };

  const row = (t: TaskRow) => {
    const sched = scheduledCount(t, planned);
    const fin = doneCount(t, planned);
    return (
      <div key={t.id} className="row tap" onClick={() => setEditing(t)}>
        <button className="icon-btn" style={{ fontSize: 22, color: t.done ? 'var(--ok)' : 'var(--text-2)' }}
          onClick={(e) => { e.stopPropagation(); toggleDone(t); }} aria-label="完成">
          {t.done ? '●' : '○'}
        </button>
        <div className="grow">
          <div style={{ fontWeight: 600, textDecoration: t.done ? 'line-through' : undefined }}>
            {t.title} {t.priority === 2 && <Chip text="重要" color="var(--danger)" />}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '3px 0 5px' }}>
            <Chip text={`${TASK_KIND_ICON[t.kind]} ${TASK_KIND_NAME[t.kind]}`} color="var(--text-2)" />
            {t.subject && <Chip text={t.subject} color={subjectColor(t.subject)} />}
            {t.due && <span className={`small ${dd(t) < 0 ? 'danger' : 'muted'}`}>{dueText(t.due)}</span>}
          </div>
          <Progress value={Math.min(fin, t.blocks)} max={t.blocks} color={subjectColor(t.subject)} />
          <div className="sub">預估 {t.blocks} 格・已安排 {sched} 格・完成 {fin} 格</div>
        </div>
      </div>
    );
  };

  return (
    <>
      <TopBar
        title="任務"
        left={<button className="text-btn small" style={{ fontSize: 13 }} onClick={exportIcs}>📅 匯出行事曆</button>}
        right={<button className="icon-btn" style={{ fontSize: 26 }} aria-label="新增任務" onClick={() => setEditing('new')}>＋</button>}
      />
      <div className="page">
        {exams.length > 0 && (
          <Section title="段考倒數">
            {exams.map((t) => {
              const n = dd(t);
              return (
                <div key={t.id} className="row tap" onClick={() => setEditing(t)}>
                  <span style={{ fontSize: 22 }}>🎓</span>
                  <div className="grow">
                    <div style={{ fontWeight: 650 }}>{t.title}</div>
                    <div className="sub">{monthDay(t.due!)}（{weekdayName(t.due!)}）</div>
                  </div>
                  <div className="center">
                    <div style={{ fontSize: 26, fontWeight: 750, color: n < 0 ? 'var(--text-2)' : '#9333ea' }}>{n < 0 ? '已考' : n === 0 ? '今天' : n}</div>
                    {n > 0 && <div className="small muted">天</div>}
                  </div>
                </div>
              );
            })}
          </Section>
        )}

        {groups.map(([title, list, color]) =>
          list.length ? (
            <Section key={title} title={<span style={{ color: color || undefined }}>{title}</span>}>
              {[...list].sort(sorter).map(row)}
            </Section>
          ) : null,
        )}

        {open.length === 0 && (
          <Section>
            <div className="empty">
              <div className="big">✅</div>
              目前沒有未完成任務<br />點右上角 ＋ 新增作業、小考或段考
            </div>
          </Section>
        )}

        {done.length > 0 && (
          <Section title={<button className="text-btn" style={{ padding: 0, fontSize: 13 }} onClick={() => setShowDone(!showDone)}>{showDone ? '▾' : '▸'} 已完成（{done.length}）</button>}>
            {showDone ? done.map(row) : <div className="row small muted">點上方標題展開</div>}
          </Section>
        )}
        <div className="section-foot" style={{ margin: '10px 20px' }}>
          「匯出行事曆」會把未來 7 天的安排與提醒做成行事曆檔，在 iPhone 打開後加入行事曆，App 關閉時也會準時提醒。建議每週匯出一次。
        </div>
      </div>
      {editing && <TaskEditor task={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {ready && <FileReady file={ready} onClose={() => setReady(null)} />}
    </>
  );
}

/** 新增或編輯任務。 */
export function TaskEditor(props: { task: TaskRow | null; onClose: () => void; preset?: Partial<TaskRow> }) {
  const builder = useBuilder();
  const ask = useConfirm();
  const t = props.task;
  const init = { ...props.preset, ...t };
  const [title, setTitle] = useState(init.title ?? '');
  const [kind, setKind] = useState<TaskKind>(init.kind ?? 'homework');
  const [subject, setSubject] = useState(init.subject ?? '');
  const [hasDue, setHasDue] = useState(t ? !!t.due : true);
  const [due, setDue] = useState(init.due ?? addDays(todayKey(), 1));
  const [blocks, setBlocks] = useState(init.blocks ?? 2);
  const [priority, setPriority] = useState(init.priority ?? 1);
  const [notes, setNotes] = useState(init.notes ?? '');
  const [remind, setRemind] = useState(!!init.remindAt);
  const [remindAt, setRemindAt] = useState(init.remindAt ?? `${todayKey()}T20:00`);
  const isExam = kind === 'exam';

  const changeKind = (k: TaskKind) => {
    setKind(k);
    if (k === 'exam' && !t) {
      setBlocks(8);
      setPriority(2);
    }
  };

  const save = async () => {
    const data = {
      title: title.trim(), kind, subject, due: hasDue ? due : null, blocks, priority, notes,
      remindAt: remind ? remindAt : null,
    };
    if (t) await db.tasks.update(t.id, data);
    else await db.tasks.add({ ...data, id: uid(), done: false, createdAt: Date.now() });
    props.onClose();
  };

  const remove = async () => {
    if (!t || !(await ask(`刪除「${t.title}」？尚未打卡的安排也會一併刪除。`, '刪除'))) return;
    await db.planned.where('taskId').equals(t.id).filter((p) => p.status === 'planned').delete();
    await db.tasks.delete(t.id);
    props.onClose();
  };

  const subjects = builder.subjects.includes(subject) || !subject ? builder.subjects : [...builder.subjects, subject];

  return (
    <Sheet title={t ? '編輯任務' : '新增任務'} onClose={props.onClose} onDone={save} doneDisabled={!title.trim()}>
      <Section>
        <div className="row">
          <input className="full" type="text" autoFocus={!t} placeholder={isExam ? '例如：第一次段考' : '例如：數學講義 p.20–25'} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="row">
          <span className="label">類型</span>
          <select value={kind} onChange={(e) => changeKind(e.target.value as TaskKind)}>
            {(Object.keys(TASK_KIND_NAME) as TaskKind[]).map((k) => <option key={k} value={k}>{TASK_KIND_ICON[k]} {TASK_KIND_NAME[k]}</option>)}
          </select>
        </div>
        <div className="row">
          <span className="label">科目</span>
          <select value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">不指定</option>
            {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </Section>

      <Section footer={isExam ? '段考日期自行建立，排程會在考前每天最多排 2 格複習。' : '排程只會排到截止日的前一天。'}>
        <label className="row"><span className="grow">{isExam ? '考試日期' : '截止日'}</span><Toggle checked={hasDue} onChange={setHasDue} /></label>
        {hasDue && (
          <div className="row"><span className="label">日期</span><input type="date" value={due} onChange={(e) => e.target.value && setDue(e.target.value)} /></div>
        )}
      </Section>

      <Section title="時間與優先">
        <BlockCountRow label={isExam ? '總複習格數' : '預估格數'} value={blocks} onChange={setBlocks} max={40} />
        <div className="row">
          <span className="label">優先順序</span>
          <div className="seg" style={{ margin: 0, flex: 1 }}>
            {['低', '一般', '重要'].map((name, i) => (
              <button key={name} className={priority === i ? 'on' : ''} onClick={() => setPriority(i)}>{name}</button>
            ))}
          </div>
        </div>
      </Section>

      <Section title="提醒">
        <label className="row"><span className="grow">設定提醒</span><Toggle checked={remind} onChange={setRemind} /></label>
        {remind && (
          <div className="row"><span className="label">時間</span><input type="datetime-local" value={remindAt} onChange={(e) => e.target.value && setRemindAt(e.target.value)} /></div>
        )}
      </Section>

      <Section title="備註">
        <div className="row"><textarea className="full" rows={3} placeholder="範圍、注意事項" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </Section>

      {t && (
        <Section>
          <button className="row" style={{ justifyContent: 'center', color: 'var(--accent)' }} onClick={async () => { await db.tasks.update(t.id, { done: !t.done }); props.onClose(); }}>
            {t.done ? '標記為未完成' : '標記為完成'}
          </button>
          <button className="row danger" style={{ justifyContent: 'center' }} onClick={remove}>刪除任務</button>
        </Section>
      )}
    </Sheet>
  );
}
