import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, REPEAT_NAME, uid } from '../db/db';
import type { NoteRow, ReminderRow, RepeatRule } from '../db/db';
import { useBuilder } from '../db/hooks';
import { addDays, dayTitle, todayKey } from '../core/time';
import { Chip, Progress, Section, Sheet, Toggle, TopBar, useConfirm, useToast } from '../ui/components';
import { subjectColor } from '../ui/colors';
import { findDate, preprocess, recognize } from '../services/ocr';
import { exportHtml, exportTxt, printPdf } from '../services/exporter';
import { TaskEditor } from './Tasks';

type Tab = 'memo' | 'note' | 'reminder';

export function Notebook() {
  const [tab, setTab] = useState<Tab>('memo');
  return (
    <>
      <TopBar title="筆記" />
      <div className="page">
        <div className="seg">
          <button className={tab === 'memo' ? 'on' : ''} onClick={() => setTab('memo')}>備忘錄</button>
          <button className={tab === 'note' ? 'on' : ''} onClick={() => setTab('note')}>記事本</button>
          <button className={tab === 'reminder' ? 'on' : ''} onClick={() => setTab('reminder')}>提醒事項</button>
        </div>
        {tab === 'memo' && <Memos />}
        {tab === 'note' && <Notes />}
        {tab === 'reminder' && <Reminders />}
      </div>
    </>
  );
}

// ---------------- 備忘錄 ----------------

function Memos() {
  const memos = useLiveQuery(() => db.memos.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const [text, setText] = useState('');
  const [pin, setPin] = useState<'none' | 'today' | 'tomorrow'>('tomorrow');
  const add = async () => {
    if (!text.trim()) return;
    const pinnedDay = pin === 'today' ? todayKey() : pin === 'tomorrow' ? addDays(todayKey(), 1) : null;
    await db.memos.add({ id: uid(), text: text.trim(), pinnedDay, done: false, createdAt: Date.now() });
    setText('');
  };
  const open = memos.filter((m) => !m.done);
  const done = memos.filter((m) => m.done).slice(0, 20);
  return (
    <>
      <Section footer="釘選到某一天的備忘，會顯示在「今天」頁上方，睡前提醒也會列出明天的備忘。">
        <div className="row">
          <input className="full" type="text" placeholder="一句話記下，例如：明天帶體育服" value={text}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        </div>
        <div className="row">
          <span className="label">釘選到</span>
          <select value={pin} onChange={(e) => setPin(e.target.value as typeof pin)}>
            <option value="tomorrow">明天</option>
            <option value="today">今天</option>
            <option value="none">不釘選</option>
          </select>
        </div>
        <button className="row" style={{ justifyContent: 'center', color: 'var(--accent)' }} disabled={!text.trim()} onClick={add}>加入備忘</button>
      </Section>
      <Section title={`未完成（${open.length}）`}>
        {open.length === 0 && <div className="empty">沒有備忘</div>}
        {open.map((m) => (
          <div key={m.id} className="row">
            <button className="icon-btn" style={{ fontSize: 20, color: 'var(--text-2)' }} onClick={() => db.memos.update(m.id, { done: true })}>○</button>
            <span className="grow">{m.text}{m.pinnedDay && <div className="sub">📌 {dayTitle(m.pinnedDay)}</div>}</span>
            <button className="text-btn danger small" onClick={() => db.memos.delete(m.id)}>刪除</button>
          </div>
        ))}
      </Section>
      {done.length > 0 && (
        <Section title="已完成（最近 20 筆）">
          {done.map((m) => (
            <div key={m.id} className="row">
              <button className="icon-btn" style={{ fontSize: 20, color: 'var(--ok)' }} onClick={() => db.memos.update(m.id, { done: false })}>●</button>
              <span className="grow muted" style={{ textDecoration: 'line-through' }}>{m.text}</span>
              <button className="text-btn danger small" onClick={() => db.memos.delete(m.id)}>刪除</button>
            </div>
          ))}
        </Section>
      )}
    </>
  );
}

// ---------------- 記事本 ----------------

function Notes() {
  const notes = useLiveQuery(() => db.notes.orderBy('updatedAt').reverse().toArray(), []) ?? [];
  const [editing, setEditing] = useState<string | null>(null);
  const [scan, setScan] = useState(false);

  const create = async () => {
    const id = uid();
    await db.notes.add({ id, title: '新筆記', body: '', subject: '', source: 'manual', images: [], createdAt: Date.now(), updatedAt: Date.now() });
    setEditing(id);
  };

  return (
    <>
      <div className="btn-row" style={{ margin: '14px 14px 0' }}>
        <button className="btn" onClick={() => setScan(true)}>📷 拍照辨識</button>
        <button className="btn secondary" onClick={create}>✏️ 新增筆記</button>
      </div>
      <Section title={`筆記（${notes.length}）`}>
        {notes.length === 0 && <div className="empty"><div className="big">📒</div>拍下講義、通知單或考卷，辨識成文字筆記</div>}
        {notes.map((n) => (
          <div key={n.id} className="row tap" onClick={() => setEditing(n.id)}>
            <span style={{ fontSize: 20 }}>{n.source === 'scan' ? '📷' : '📝'}</span>
            <div className="grow">
              <div style={{ fontWeight: 600 }} className="ellipsis">{n.title}</div>
              <div className="sub ellipsis">{n.subject ? `${n.subject}・` : ''}{new Date(n.updatedAt).toLocaleDateString('zh-TW')}・{n.body.slice(0, 40) || '（空白）'}</div>
            </div>
          </div>
        ))}
      </Section>
      {scan && <ScanSheet onClose={() => setScan(false)} onCreated={(id) => { setScan(false); setEditing(id); }} />}
      {editing && <NoteEditor id={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ScanSheet(props: { onClose: () => void; onCreated: (id: string) => void }) {
  const builder = useBuilder();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [kind, setKind] = useState<'handout' | 'notice' | 'exam' | 'board'>('handout');
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState<{ p: number; label: string } | null>(null);
  // 預覽圖網址只建立一次，離開時釋放記憶體
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  const kindName = { handout: '講義', notice: '通知單', exam: '考卷', board: '黑板' }[kind];

  const run = async () => {
    if (!files.length) return;
    setBusy({ p: 0, label: '處理照片…' });
    try {
      const pre = [];
      for (const f of files) pre.push(await preprocess(f, { invert: kind === 'board' }));
      const text = await recognize(pre.map((x) => x.canvas), (p, label) => setBusy({ p, label }));
      const id = uid();
      const d = new Date();
      await db.notes.add({
        id, title: `${kindName} ${d.getMonth() + 1}/${d.getDate()}${subject ? ' ' + subject : ''}`,
        body: text, subject, source: 'scan', images: pre.map((x) => x.jpeg), createdAt: Date.now(), updatedAt: Date.now(),
      });
      props.onCreated(id);
    } catch (e) {
      setBusy(null);
      toast('辨識失敗', `${e instanceof Error ? e.message : String(e)}。第一次使用需要網路下載語言模型。`, '⚠️');
    }
  };

  return (
    <Sheet title="拍照辨識" onClose={busy ? () => {} : props.onClose}>
      <Section title="文件類型" footer={kind === 'board' ? '黑板手寫在手機內辨識效果有限，建議拍近、拍正；第二階段將加入雲端 AI 辨識手寫。' : '印刷文字辨識效果最好。照片只在手機內處理，不會上傳。'}>
        <div className="row">
          <div className="seg" style={{ margin: 0, flex: 1 }}>
            {(['handout', 'notice', 'exam', 'board'] as const).map((k) => (
              <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{{ handout: '講義', notice: '通知單', exam: '考卷', board: '黑板' }[k]}</button>
            ))}
          </div>
        </div>
        <div className="row">
          <span className="label">科目</span>
          <select value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">不指定</option>
            {builder.subjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </Section>
      <Section title={`照片（${files.length} 張）`}>
        <button className="row" style={{ justifyContent: 'center', color: 'var(--accent)' }} onClick={() => inputRef.current?.click()} disabled={!!busy}>
          📷 拍照或從相簿選擇（可多張）
        </button>
        <input ref={inputRef} type="file" accept="image/*" multiple hidden
          onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
        {files.length > 0 && (
          <div className="thumbs">
            {previews.map((src, i) => <img key={src} src={src} alt={`第 ${i + 1} 張`} />)}
          </div>
        )}
        {files.length > 0 && !busy && <button className="row danger" style={{ justifyContent: 'center' }} onClick={() => setFiles([])}>清除照片</button>}
      </Section>
      <Section pad>
        {busy ? (
          <>
            <div style={{ marginBottom: 8 }}>{busy.label}</div>
            <Progress value={busy.p} max={1} />
          </>
        ) : (
          <button className="btn" style={{ width: '100%' }} disabled={!files.length} onClick={run}>開始辨識</button>
        )}
      </Section>
    </Sheet>
  );
}

function NoteEditor(props: { id: string; onClose: () => void }) {
  const builder = useBuilder();
  const note = useLiveQuery(() => db.notes.get(props.id), [props.id]);
  const [draft, setDraft] = useState<Partial<NoteRow>>({});
  const [makeTask, setMakeTask] = useState(false);
  const ask = useConfirm();
  const pending = useRef<Partial<NoteRow> | null>(null);

  // 自動存檔：停止輸入 0.5 秒就寫入（App 被系統關掉也不會遺失）
  const flush = async () => {
    const p = pending.current;
    pending.current = null;
    if (p) await db.notes.update(props.id, { ...p, updatedAt: Date.now() });
  };
  useEffect(() => {
    if (!Object.keys(draft).length) return;
    pending.current = draft;
    const t = setTimeout(flush, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!note) return null;
  const cur: NoteRow = { ...note, ...draft };

  const save = async () => {
    await flush();
    props.onClose();
  };
  const remove = async () => {
    if (await ask(`刪除「${note.title}」？`, '刪除')) {
      pending.current = null;
      await db.notes.delete(note.id);
      props.onClose();
    }
  };
  const due = findDate(cur.body);

  return (
    <Sheet title="筆記" onClose={save} full>
      <Section>
        <div className="row"><input className="full" type="text" style={{ fontWeight: 650, fontSize: 17 }} value={cur.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></div>
        <div className="row">
          <span className="label">科目</span>
          <select value={cur.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })}>
            <option value="">不指定</option>
            {builder.subjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {cur.subject && <Chip text={cur.subject} color={subjectColor(cur.subject)} />}
        </div>
      </Section>
      <div className="section">
        {cur.source === 'scan' && <div className="section-head"><span>辨識結果（請對照原圖修正）</span></div>}
        <textarea className="note-body" value={cur.body} placeholder="寫點什麼…" onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
      </div>
      {cur.images.length > 0 && (
        <Section title={`原圖（${cur.images.length} 頁）`}>
          <div className="thumbs">
            {cur.images.map((src, i) => <a key={i} href={src} target="_blank" rel="noreferrer"><img src={src} alt={`第 ${i + 1} 頁`} /></a>)}
          </div>
        </Section>
      )}
      <Section title="匯出" footer="PDF：開啟列印畫面後，在 iPhone 選「分享 → 儲存到檔案」即可存成 PDF。">
        <div className="row" style={{ gap: 8 }}>
          <button className="btn plain" style={{ flex: 1 }} onClick={() => exportTxt(cur)}>TXT</button>
          <button className="btn plain" style={{ flex: 1 }} onClick={() => exportHtml(cur)}>HTML</button>
          <button className="btn plain" style={{ flex: 1 }} onClick={() => printPdf(cur)}>PDF</button>
        </div>
      </Section>
      <Section footer={due ? `內容中找到日期 ${dayTitle(due, false)}，會預填為截止日。` : '例如通知單的繳費、回條期限，或考卷訂正。'}>
        <button className="row" style={{ justifyContent: 'center', color: 'var(--accent)' }} onClick={() => setMakeTask(true)}>📌 從這份筆記建立任務</button>
        <button className="row danger" style={{ justifyContent: 'center' }} onClick={remove}>刪除筆記</button>
      </Section>
      {makeTask && (
        <TaskEditor task={null} onClose={() => setMakeTask(false)}
          preset={{ title: cur.title, subject: cur.subject, due: due ?? undefined, notes: cur.body.slice(0, 200), kind: /考卷/.test(cur.title) ? 'other' : 'homework', blocks: 1 }} />
      )}
    </Sheet>
  );
}

// ---------------- 提醒事項 ----------------

function Reminders() {
  const rows = useLiveQuery(() => db.reminders.orderBy('at').toArray(), []) ?? [];
  const [edit, setEdit] = useState<ReminderRow | 'new' | null>(null);
  return (
    <>
      <Section title="提醒事項" extra={<button className="text-btn" style={{ padding: 0, fontSize: 14 }} onClick={() => setEdit('new')}>＋ 新增</button>}
        footer="App 開著時會準時提醒；App 關閉時的提醒，請到「任務」頁匯出行事曆。">
        {rows.length === 0 && <div className="empty">沒有提醒事項</div>}
        {rows.map((r) => (
          <div key={r.id} className="row tap" onClick={() => setEdit(r)} style={{ opacity: r.enabled ? 1 : 0.5 }}>
            <span style={{ fontSize: 20 }}>⏰</span>
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{r.title}</div>
              <div className="sub">{r.at.replace('T', ' ')}・{REPEAT_NAME[r.repeat]}{r.enabled ? '' : '・已關閉'}</div>
            </div>
          </div>
        ))}
      </Section>
      {edit && <ReminderEditor row={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function ReminderEditor(props: { row: ReminderRow | null; onClose: () => void }) {
  const r = props.row;
  const [title, setTitle] = useState(r?.title ?? '');
  const [at, setAt] = useState(r?.at ?? `${todayKey()}T21:00`);
  const [repeat, setRepeat] = useState<RepeatRule>(r?.repeat ?? 'none');
  const [enabled, setEnabled] = useState(r?.enabled ?? true);
  const [notes, setNotes] = useState(r?.notes ?? '');
  const save = async () => {
    await db.reminders.put({ id: r?.id ?? uid(), title: title.trim(), at, repeat, enabled, notes });
    props.onClose();
  };
  return (
    <Sheet title={r ? '編輯提醒' : '新增提醒'} onClose={props.onClose} onDone={save} doneDisabled={!title.trim()}>
      <Section>
        <div className="row"><input className="full" type="text" autoFocus={!r} placeholder="例如：整理明天的書包" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="row"><span className="label">時間</span><input type="datetime-local" value={at} onChange={(e) => e.target.value && setAt(e.target.value)} /></div>
        <div className="row">
          <span className="label">重複</span>
          <select value={repeat} onChange={(e) => setRepeat(e.target.value as RepeatRule)}>
            {(Object.keys(REPEAT_NAME) as RepeatRule[]).map((k) => <option key={k} value={k}>{REPEAT_NAME[k]}</option>)}
          </select>
        </div>
        <label className="row"><span className="grow">啟用</span><Toggle checked={enabled} onChange={setEnabled} /></label>
        <div className="row"><textarea className="full" rows={2} placeholder="備註（可留白）" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </Section>
      {r && (
        <Section>
          <button className="row danger" style={{ justifyContent: 'center' }} onClick={async () => { await db.reminders.delete(r.id); props.onClose(); }}>刪除提醒</button>
        </Section>
      )}
    </Sheet>
  );
}
