import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { hoursText, timeLabel } from '../core/time';

export function TopBar(props: { title: string; left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="side">{props.left}</div>
      <h1>{props.title}</h1>
      <div className="side right">{props.right}</div>
    </header>
  );
}

export function Section(props: { title?: ReactNode; extra?: ReactNode; footer?: ReactNode; children: ReactNode; pad?: boolean }) {
  return (
    <section className="section">
      {(props.title || props.extra) && (
        <div className="section-head">
          <span>{props.title}</span>
          {props.extra}
        </div>
      )}
      <div className={props.pad ? 'card pad' : 'card'}>{props.children}</div>
      {props.footer && <div className="section-foot">{props.footer}</div>}
    </section>
  );
}

export function Chip(props: { text: string; color?: string }) {
  const c = props.color ?? 'var(--accent)';
  return (
    <span className="chip" style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>
      {props.text}
    </span>
  );
}

/** 底部彈出面板（新增、編輯用）。 */
export function Sheet(props: {
  title: string;
  onClose: () => void;
  onDone?: () => void;
  doneText?: string;
  doneDisabled?: boolean;
  full?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div className="overlay" onClick={props.onClose}>
      <div className={props.full ? 'sheet full' : 'sheet'} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div className="side">
            <button className="text-btn" onClick={props.onClose}>
              {props.onDone ? '取消' : '關閉'}
            </button>
          </div>
          <h2>{props.title}</h2>
          <div className="side right">
            {props.onDone && (
              <button className="text-btn bold" disabled={props.doneDisabled} onClick={props.onDone}>
                {props.doneText ?? '儲存'}
              </button>
            )}
          </div>
        </div>
        <div className="sheet-body">{props.children}</div>
      </div>
    </div>
  );
}

export interface Action {
  label: string;
  onClick: () => void;
  destructive?: boolean;
}

/** iOS 風格的動作選單。 */
export function ActionSheet(props: { title?: string; actions: Action[]; onClose: () => void }) {
  return (
    <div className="actions" onClick={props.onClose}>
      <div className="group" onClick={(e) => e.stopPropagation()}>
        {props.title && <div className="title">{props.title}</div>}
        {props.actions.map((a) => (
          <button
            key={a.label}
            className={a.destructive ? 'destructive' : ''}
            onClick={() => {
              props.onClose();
              a.onClick();
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
      <div className="group">
        <button className="cancel" onClick={props.onClose}>
          取消
        </button>
      </div>
    </div>
  );
}

/** 以分鐘數表示的時間選擇（下拉選單）。 */
export function TimeSelect(props: { value: number; onChange: (m: number) => void; min?: number; max?: number; step?: number }) {
  const { min = 0, max = 1440, step = 15 } = props;
  const opts: number[] = [];
  for (let m = min; m <= max; m += step) opts.push(m);
  if (!opts.includes(props.value)) opts.push(props.value);
  opts.sort((a, b) => a - b);
  return (
    <select value={props.value} onChange={(e) => props.onChange(Number(e.target.value))}>
      {opts.map((m) => (
        <option key={m} value={m}>
          {timeLabel(m)}
        </option>
      ))}
    </select>
  );
}

export function Stepper(props: { value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number }) {
  const { min = 0, max = 99, step = 1 } = props;
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <button className="btn plain" style={{ padding: '4px 12px' }} disabled={props.value <= min} onClick={() => props.onChange(Math.max(min, props.value - step))}>
        −
      </button>
      <button className="btn plain" style={{ padding: '4px 12px' }} disabled={props.value >= max} onClick={() => props.onChange(Math.min(max, props.value + step))}>
        ＋
      </button>
    </span>
  );
}

/** 格數選擇列：1 格 = 30 分鐘。 */
export function BlockCountRow(props: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <div className="row">
      <div className="grow">
        {props.label}
        <div className="sub">
          {props.value} 格（{hoursText(props.value)}）
        </div>
      </div>
      <Stepper value={props.value} onChange={props.onChange} min={props.min ?? 1} max={props.max ?? 20} />
    </div>
  );
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <span className={props.checked ? 'switch on' : 'switch'} role="switch" aria-checked={props.checked}
      onClick={(e) => { e.preventDefault(); props.onChange(!props.checked); }}>
      <span className="knob" />
    </span>
  );
}

export function Progress(props: { value: number; max: number; color?: string }) {
  const pct = props.max <= 0 ? 0 : Math.min(100, (props.value / props.max) * 100);
  return (
    <div className="progress">
      <div style={{ width: `${pct}%`, background: props.color ?? 'var(--accent)' }} />
    </div>
  );
}

// ---------- 提示訊息（App 內提醒也用這個顯示） ----------

interface ToastMsg {
  id: number;
  title: string;
  body?: string;
  icon: string;
}

const ToastCtx = createContext<(title: string, body?: string, icon?: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider(props: { children: ReactNode }) {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const show = useCallback((title: string, body?: string, icon = '✅') => {
    const id = Date.now();
    setMsg({ id, title, body, icon });
    setTimeout(() => setMsg((m) => (m?.id === id ? null : m)), body ? 6000 : 2600);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {props.children}
      {msg && (
        <div className="toast" onClick={() => setMsg(null)}>
          <span style={{ fontSize: 20 }}>{msg.icon}</span>
          <div>
            <b>{msg.title}</b>
            {msg.body && <span className="small muted">{msg.body}</span>}
          </div>
        </div>
      )}
    </ToastCtx.Provider>
  );
}

// ---------- 確認對話框（App 內建，取代瀏覽器的 confirm） ----------

type AskFn = (message: string, okLabel?: string) => Promise<boolean>;
const ConfirmCtx = createContext<AskFn>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider(props: { children: ReactNode }) {
  const [req, setReq] = useState<{ message: string; ok: string; resolve: (v: boolean) => void } | null>(null);
  const ask = useCallback<AskFn>(
    (message, okLabel = '確定') => new Promise<boolean>((resolve) => setReq({ message, ok: okLabel, resolve })),
    [],
  );
  const done = (v: boolean) => {
    req?.resolve(v);
    setReq(null);
  };
  return (
    <ConfirmCtx.Provider value={ask}>
      {props.children}
      {req && (
        <div className="actions" style={{ zIndex: 150 }} onClick={() => done(false)}>
          <div className="group" onClick={(e) => e.stopPropagation()}>
            <div className="title">{req.message}</div>
            <button className="destructive" onClick={() => done(true)}>{req.ok}</button>
          </div>
          <div className="group">
            <button className="cancel" onClick={(e) => { e.stopPropagation(); done(false); }}>取消</button>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}
