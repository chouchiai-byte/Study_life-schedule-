import { useEffect, useRef, useState } from 'react';
import { db } from '../db/db';
import { setStatus } from '../db/hooks';
import { ActionSheet, Chip, Sheet } from '../ui/components';
import { subjectColor } from '../ui/colors';
import { notify } from '../services/notify';

export interface FocusTarget {
  title: string;
  subject: string;
  plannedId?: string;
}

type Phase = 'focus' | 'rest';
const MINUTES: Record<Phase, number> = { focus: 25, rest: 5 };
const COLOR: Record<Phase, string> = { focus: '#dc2626', rest: '#16a34a' };

/** 專注計時：25 分鐘專注＋5 分鐘休息。以結束時間點計算，切到背景回來仍準確；計時中保持螢幕不熄滅。 */
export function FocusTimer(props: { target: FocusTarget; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>('focus');
  const [endAt, setEndAt] = useState<number | null>(null);
  const [paused, setPaused] = useState(MINUTES.focus * 60 * 1000);
  const [now, setNow] = useState(Date.now());
  const [rounds, setRounds] = useState(0);
  const [ask, setAsk] = useState<'phase' | 'close' | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);

  const remaining = endAt ? Math.max(0, endAt - now) : paused;
  const total = MINUTES[phase] * 60 * 1000;
  const progress = 1 - remaining / total;

  // 計時中保持螢幕常亮
  useEffect(() => {
    const lock = async () => {
      try {
        if ('wakeLock' in navigator && endAt) wakeLock.current = await navigator.wakeLock.request('screen');
      } catch {
        /* 不支援時略過 */
      }
    };
    if (endAt) lock();
    else wakeLock.current?.release().catch(() => {});
    const onVis = () => {
      if (document.visibilityState === 'visible' && endAt) lock();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [endAt]);

  useEffect(() => () => { wakeLock.current?.release().catch(() => {}); }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (endAt && now >= endAt) {
      const wasFocus = phase === 'focus';
      setEndAt(null);
      notify(wasFocus ? '專注時間結束' : '休息結束', wasFocus ? '休息 5 分鐘吧！' : '準備開始下一輪專注。');
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      if (wasFocus) {
        setRounds((r) => r + 1);
        reset('rest');
        if (props.target.plannedId) setAsk('phase');
      } else {
        reset('focus');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  const reset = (p: Phase) => {
    setPhase(p);
    setEndAt(null);
    setPaused(MINUTES[p] * 60 * 1000);
  };

  const toggle = () => {
    if (endAt) {
      setPaused(Math.max(0, endAt - Date.now()));
      setEndAt(null);
    } else {
      setEndAt(Date.now() + paused);
      setNow(Date.now());
    }
  };

  const close = async () => {
    if (rounds > 0 && props.target.plannedId) {
      const row = await db.planned.get(props.target.plannedId);
      if (row && row.status === 'planned') {
        setAsk('close');
        return;
      }
    }
    props.onClose();
  };

  const checkIn = async (status: 'done' | 'partial') => {
    const row = props.target.plannedId ? await db.planned.get(props.target.plannedId) : undefined;
    if (row) await setStatus(row, status);
  };

  const sec = Math.ceil(remaining / 1000);
  const clock = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  const R = 116;
  const C = 2 * Math.PI * R;

  return (
    <Sheet title="專注計時" onClose={close} full>
      <div className="focus">
        <div className="center">
          <div style={{ fontSize: 22, fontWeight: 700 }}>{props.target.title}</div>
          {props.target.subject && <div style={{ marginTop: 6 }}><Chip text={props.target.subject} color={subjectColor(props.target.subject)} /></div>}
        </div>

        <div className="ring">
          <svg width="260" height="260">
            <circle cx="130" cy="130" r={R} fill="none" stroke={COLOR[phase]} strokeOpacity="0.15" strokeWidth="18" />
            <circle cx="130" cy="130" r={R} fill="none" stroke={COLOR[phase]} strokeWidth="18" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - progress)} style={{ transition: 'stroke-dashoffset 0.5s linear' }} />
          </svg>
          <div className="mid">
            <div style={{ color: COLOR[phase], fontWeight: 650 }}>{phase === 'focus' ? '專注' : '休息'}</div>
            <div className="clock">{clock}</div>
            <div className="small muted">已完成 {rounds} 輪</div>
          </div>
        </div>

        <div className="btn-row" style={{ width: '100%', maxWidth: 360 }}>
          <button className="btn" style={{ background: COLOR[phase] }} onClick={toggle}>{endAt ? '暫停' : '開始'}</button>
          <button className="btn plain" onClick={() => reset(phase)}>重設</button>
          <button className="btn plain" onClick={() => reset(phase === 'focus' ? 'rest' : 'focus')}>{phase === 'focus' ? '跳到休息' : '跳到專注'}</button>
        </div>
        <div className="small muted center">一格 30 分鐘 = 專注 25 分鐘＋休息 5 分鐘<br />計時中螢幕不會自動熄滅；請保持 App 開啟</div>
      </div>

      {ask && (
        <ActionSheet
          title="這一格完成了嗎？"
          onClose={() => { const wasClose = ask === 'close'; setAsk(null); if (wasClose) props.onClose(); }}
          actions={[
            { label: '✅ 完成', onClick: () => checkIn('done') },
            { label: '◐ 部分完成', onClick: () => checkIn('partial') },
          ]}
        />
      )}
    </Sheet>
  );
}
