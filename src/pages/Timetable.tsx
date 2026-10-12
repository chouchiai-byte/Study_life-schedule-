import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { clearTimetable, db, exportTimetable, importTimetable, uid } from '../db/db';
import { FileReady } from '../ui/FileReady';
import type { ReadyFile } from '../ui/FileReady';
import type { EventRow, PeriodRow } from '../db/db';
import { useBuilder } from '../db/hooks';
import { PERIOD_TIMES, periodName } from '../core/timetable';
import { WEEKDAY_NAMES, addDays, dayTitle, isoWeekday, startMinute, timeLabel, todayKey } from '../core/time';
import { planDay } from '../core/planner';
import { conflicts, nearestFreeRun } from '../core/conflict';
import { KIND_INFO } from '../core/types';
import { Chip, Section, Sheet, TimeSelect, Toggle, TopBar, useConfirm, useToast } from '../ui/components';
import { subjectColor } from '../ui/colors';

type Tab = 'school' | 'custom' | 'holiday';

export function Timetable() {
  const [tab, setTab] = useState<Tab>('school');
  return (
    <>
      <TopBar title="課表" />
      <div className="page">
        <div className="seg">
          <button className={tab === 'school' ? 'on' : ''} onClick={() => setTab('school')}>學校課表</button>
          <button className={tab === 'custom' ? 'on' : ''} onClick={() => setTab('custom')}>課程與時段</button>
          <button className={tab === 'holiday' ? 'on' : ''} onClick={() => setTab('holiday')}>停課日</button>
        </div>
        {tab === 'school' && <SchoolTimetable />}
        {tab === 'custom' && <CustomEvents />}
        {tab === 'holiday' && <Holidays />}
      </div>
    </>
  );
}

// ---------------- 學校課表 ----------------

function SchoolTimetable() {
  const periods = useLiveQuery(() => db.periods.toArray(), []) ?? [];
  const [edit, setEdit] = useState<PeriodRow | { weekday: number; period: number } | null>(null);
  const ask = useConfirm();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState<ReadyFile | null>(null);
  const loaded = periods.length > 0;

  const doImport = async (file: File) => {
    if (loaded && !(await ask('匯入課表檔會取代目前的課表，確定嗎？', '匯入'))) return;
    try {
      const n = await importTimetable(await file.text());
      toast(`已匯入 ${n} 節課`);
    } catch (e) {
      toast('匯入失敗', e instanceof Error ? e.message : String(e), '⚠️');
    }
  };
  const doExport = async () => {
    const text = await exportTimetable();
    setReady({ blob: new Blob([text], { type: 'application/json' }), name: '半時格_課表.json', hint: '換手機時可再匯入' });
  };
  const find = (w: number, p: number) => periods.find((x) => x.weekday === w && x.period === p);

  return (
    <>
      {!loaded && (
        <Section pad>
          <div style={{ fontWeight: 650, marginBottom: 4 }}>還沒有課表</div>
          <div className="small muted" style={{ marginBottom: 10 }}>匯入家長給你的課表檔（.json），或直接點下方格子一節一節建立。</div>
          <button className="btn" onClick={() => fileRef.current?.click()}>📥 匯入課表檔</button>
        </Section>
      )}
      <div className="tt">
        <div />
        {[1, 2, 3, 4, 5].map((w) => <div key={w} className="h">{WEEKDAY_NAMES[w]}</div>)}
        {PERIOD_TIMES.map((pt) => (
          <PeriodRowCells key={pt.period} pt={pt} find={find} onEdit={setEdit} />
        ))}
      </div>
      <Section footer="點格子可修改科目、老師或時間。課表只存在這支手機裡。">
        <button className="row" style={{ color: 'var(--accent)', justifyContent: 'center' }} onClick={() => fileRef.current?.click()}>📥 匯入課表檔</button>
        {loaded && <button className="row" style={{ color: 'var(--accent)', justifyContent: 'center' }} onClick={doExport}>📤 匯出課表檔</button>}
        {loaded && (
          <button className="row danger" style={{ justifyContent: 'center' }}
            onClick={async () => { if (await ask('清空整份學校課表？', '清空')) clearTimetable(); }}>清空課表</button>
        )}
      </Section>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ''; }} />
      {ready && <FileReady file={ready} onClose={() => setReady(null)} />}
      {edit && <PeriodEditor value={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function PeriodRowCells(props: {
  pt: { period: number; start: number; end: number };
  find: (w: number, p: number) => PeriodRow | undefined;
  onEdit: (v: PeriodRow | { weekday: number; period: number }) => void;
}) {
  const { pt } = props;
  return (
    <>
      {pt.period === 5 && <div className="lunch">午餐・午休 12:00–13:30</div>}
      <div className="p">
        <b style={{ color: 'var(--text)' }}>{pt.period === 0 ? '早' : pt.period}</b>
        <span>{timeLabel(pt.start)}</span>
      </div>
      {[1, 2, 3, 4, 5].map((w) => {
        const cell = props.find(w, pt.period);
        return (
          <button key={w} onClick={() => props.onEdit(cell ?? { weekday: w, period: pt.period })}
            style={{ borderTop: cell && cell.period > 0 ? `3px solid ${subjectColor(cell.subject)}` : undefined }}>
            {cell ? cell.subject : <span className="muted">＋</span>}
            {cell?.teacher && <span className="tch">{cell.teacher}</span>}
          </button>
        );
      })}
    </>
  );
}

function PeriodEditor(props: { value: PeriodRow | { weekday: number; period: number }; onClose: () => void }) {
  const existing = 'subject' in props.value ? (props.value as PeriodRow) : null;
  const pt = PERIOD_TIMES.find((p) => p.period === props.value.period) ?? PERIOD_TIMES[1];
  const [subject, setSubject] = useState(existing?.subject ?? '');
  const [teacher, setTeacher] = useState(existing?.teacher ?? '');
  const [start, setStart] = useState(existing?.start ?? pt.start);
  const [end, setEnd] = useState(existing?.end ?? pt.end);

  const save = async () => {
    const row = { weekday: props.value.weekday, period: props.value.period, subject: subject.trim(), teacher: teacher.trim(), start, end };
    if (existing?.id) await db.periods.update(existing.id, row);
    else await db.periods.add(row);
    props.onClose();
  };
  const remove = async () => {
    if (existing?.id) await db.periods.delete(existing.id);
    props.onClose();
  };

  return (
    <Sheet title={`週${WEEKDAY_NAMES[props.value.weekday]} ${periodName(props.value.period)}`} onClose={props.onClose} onDone={save} doneDisabled={!subject.trim()}>
      <Section>
        <div className="row"><span className="label">科目</span><input type="text" value={subject} placeholder="例如：數學" onChange={(e) => setSubject(e.target.value)} /></div>
        <div className="row"><span className="label">老師</span><input type="text" value={teacher} placeholder="可留白" onChange={(e) => setTeacher(e.target.value)} /></div>
        <div className="row"><span className="label">開始</span><TimeSelect value={start} onChange={setStart} min={420} max={1200} step={5} /></div>
        <div className="row"><span className="label">結束</span><TimeSelect value={end} onChange={setEnd} min={420} max={1200} step={5} /></div>
      </Section>
      {existing && (
        <Section footer="刪除後這一節變成空堂（若整天沒課，當天會視為假日作息）。">
          <button className="row danger" style={{ justifyContent: 'center' }} onClick={remove}>刪除這一節</button>
        </Section>
      )}
    </Sheet>
  );
}

// ---------------- 自建課程與時段 ----------------

function eventText(e: EventRow) {
  const time = `${timeLabel(e.start)}–${timeLabel(e.end)}`;
  if (e.date) return `${dayTitle(e.date, false)} ${time}`;
  return `每週${e.weekdays.slice().sort().map((w) => WEEKDAY_NAMES[w]).join('、')} ${time}`;
}

function CustomEvents() {
  const events = useLiveQuery(() => db.events.toArray(), []) ?? [];
  const [edit, setEdit] = useState<EventRow | 'new' | null>(null);
  return (
    <>
      <Section title="自建課程與時段" footer="例如週六數學補習、週日複習課、社團、家庭聚會。新增後當天的可支配格會自動扣除。"
        extra={<button className="text-btn" style={{ padding: 0, fontSize: 14 }} onClick={() => setEdit('new')}>＋ 新增</button>}>
        {events.length === 0 && <div className="empty">還沒有自建課程或時段</div>}
        {events.map((e) => (
          <div key={e.id} className="row tap" onClick={() => setEdit(e)} style={{ opacity: e.active ? 1 : 0.5 }}>
            <span style={{ fontSize: 20 }}>{e.kind === 'course' ? '📘' : '⭐'}</span>
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{e.title} <Chip text={KIND_INFO[e.kind].name} color={e.kind === 'course' ? '#9333ea' : '#db2777'} /></div>
              <div className="sub">{eventText(e)}{e.location ? `・${e.location}` : ''}{e.active ? '' : '・已停用'}</div>
            </div>
          </div>
        ))}
      </Section>
      {edit && <EventEditor event={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function EventEditor(props: { event: EventRow | null; onClose: () => void }) {
  const builder = useBuilder();
  const e = props.event;
  const [title, setTitle] = useState(e?.title ?? '');
  const [kind, setKind] = useState<EventRow['kind']>(e?.kind ?? 'course');
  const [repeat, setRepeat] = useState<'weekly' | 'once'>(e?.date ? 'once' : 'weekly');
  const [weekdays, setWeekdays] = useState<number[]>(e?.weekdays ?? [6]);
  const [date, setDate] = useState(e?.date ?? todayKey());
  const [start, setStart] = useState(e?.start ?? 540);
  const [end, setEnd] = useState(e?.end ?? 630);
  const [location, setLocation] = useState(e?.location ?? '');
  const [teacher, setTeacher] = useState(e?.teacher ?? '');
  const [active, setActive] = useState(e?.active ?? true);
  const ask = useConfirm();

  // 衝突檢查：檢查接下來會發生的那幾天（不含這個時段本身）
  const others = builder.events.filter((x) => x.id !== e?.id);
  const checkDays = repeat === 'once' ? [date] : weekdays.map((w) => {
    const t = todayKey();
    return addDays(t, (w - isoWeekday(t) + 7) % 7);
  });
  const issues = checkDays.flatMap((d) => {
    const plan = planDay(d, builder.classes, others, builder.isHoliday(d), builder.routine);
    const c = conflicts(start, end, plan);
    if (!c.length) return [];
    const names = [...new Set(c.map((b) => b.title))].join('、');
    const len = Math.max(1, Math.ceil((end - start) / 30));
    const near = nearestFreeRun(len, Math.floor(start / 30), plan);
    return [{ day: d, names, near }];
  });

  const valid = title.trim() && end > start && (repeat === 'once' || weekdays.length > 0);

  const save = async () => {
    const row: EventRow = {
      id: e?.id ?? uid(), title: title.trim(), kind, weekdays: repeat === 'weekly' ? weekdays : [],
      date: repeat === 'once' ? date : null, start, end, location: location.trim(), teacher: teacher.trim(), active,
    };
    await db.events.put(row);
    props.onClose();
  };

  const remove = async () => {
    if (e && (await ask(`刪除「${e.title}」？`, '刪除'))) {
      await db.events.delete(e.id);
      props.onClose();
    }
  };

  const toggleDay = (w: number) => setWeekdays(weekdays.includes(w) ? weekdays.filter((x) => x !== w) : [...weekdays, w].sort());

  return (
    <Sheet title={e ? '編輯課程／時段' : '新增課程／時段'} onClose={props.onClose} onDone={save} doneDisabled={!valid}>
      <Section>
        <div className="row"><input className="full" type="text" autoFocus={!e} placeholder="例如：數學補習、熱舞社" value={title} onChange={(ev) => setTitle(ev.target.value)} /></div>
        <div className="row">
          <span className="label">類型</span>
          <div className="seg" style={{ margin: 0, flex: 1 }}>
            <button className={kind === 'course' ? 'on' : ''} onClick={() => setKind('course')}>課程</button>
            <button className={kind === 'event' ? 'on' : ''} onClick={() => setKind('event')}>時段</button>
          </div>
        </div>
      </Section>

      <Section title="時間">
        <div className="row">
          <span className="label">重複</span>
          <div className="seg" style={{ margin: 0, flex: 1 }}>
            <button className={repeat === 'weekly' ? 'on' : ''} onClick={() => setRepeat('weekly')}>每週</button>
            <button className={repeat === 'once' ? 'on' : ''} onClick={() => setRepeat('once')}>單次</button>
          </div>
        </div>
        {repeat === 'weekly' ? (
          <div className="row" style={{ gap: 6 }}>
            {[1, 2, 3, 4, 5, 6, 7].map((w) => (
              <button key={w} className={weekdays.includes(w) ? 'btn' : 'btn plain'} style={{ flex: 1, padding: '8px 0' }} onClick={() => toggleDay(w)}>
                {WEEKDAY_NAMES[w]}
              </button>
            ))}
          </div>
        ) : (
          <div className="row"><span className="label">日期</span><input type="date" value={date} onChange={(ev) => ev.target.value && setDate(ev.target.value)} /></div>
        )}
        <div className="row"><span className="label">開始</span><TimeSelect value={start} onChange={setStart} min={300} max={1410} step={5} /></div>
        <div className="row"><span className="label">結束</span><TimeSelect value={end} onChange={setEnd} min={315} max={1440} step={5} /></div>
        {end <= start && <div className="row small danger">結束時間要晚於開始時間。</div>}
        {issues.map((i) => (
          <div key={i.day} className="row small warn" style={{ display: 'block' }}>
            ⚠️ {dayTitle(i.day, false)} 與「{i.names}」重疊（自建時段會優先佔用）。
            {i.near !== null && (
              <button className="text-btn small" style={{ padding: '0 4px' }} onClick={() => { const len = end - start; setStart(startMinute(i.near!)); setEnd(startMinute(i.near!) + len); }}>
                改到最近空檔 {timeLabel(startMinute(i.near))}
              </button>
            )}
          </div>
        ))}
      </Section>

      <Section title="其他（可留白）">
        <div className="row"><span className="label">地點</span><input type="text" value={location} onChange={(ev) => setLocation(ev.target.value)} /></div>
        <div className="row"><span className="label">老師</span><input type="text" value={teacher} onChange={(ev) => setTeacher(ev.target.value)} /></div>
        <label className="row"><span className="grow">啟用</span><Toggle checked={active} onChange={setActive} /></label>
      </Section>

      {e && (
        <Section>
          <button className="row danger" style={{ justifyContent: 'center' }} onClick={remove}>刪除</button>
        </Section>
      )}
    </Sheet>
  );
}

// ---------------- 停課日 ----------------

function Holidays() {
  const rows = useLiveQuery(() => db.overrides.orderBy('day').toArray(), []) ?? [];
  const [day, setDay] = useState(todayKey());
  const [note, setNote] = useState('');
  const add = async () => {
    await db.overrides.put({ day, holiday: true, note: note.trim() || '停課' });
    setNote('');
  };
  const upcoming = rows.filter((r) => r.day >= addDays(todayKey(), -7));
  return (
    <>
      <Section title="新增停課日" footer="颱風假、補假、校慶等。停課日套用週末作息，不排每日複習。">
        <div className="row"><span className="label">日期</span><input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /></div>
        <div className="row"><span className="label">說明</span><input type="text" placeholder="例如：颱風假" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <button className="row" style={{ justifyContent: 'center', color: 'var(--accent)' }} onClick={add}>加入</button>
      </Section>
      <Section title="停課日">
        {upcoming.length === 0 && <div className="empty">沒有停課日</div>}
        {upcoming.map((r) => (
          <div key={r.day} className="row">
            <span className="grow">{dayTitle(r.day, false)}<div className="sub">{r.note}</div></span>
            <button className="text-btn danger" onClick={() => db.overrides.delete(r.day)}>刪除</button>
          </div>
        ))}
      </Section>
    </>
  );
}
