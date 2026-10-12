import { useEffect, useState } from 'react';
import { requestPersistence, seedIfNeeded } from './db/db';
import { ConfirmProvider, ToastProvider, useToast } from './ui/components';
import { setToastHandler } from './services/notify';
import { useReminderEngine } from './services/reminders';
import { Today } from './pages/Today';
import { Week } from './pages/Week';
import { Tasks } from './pages/Tasks';
import { Timetable } from './pages/Timetable';
import { Notebook } from './pages/Notebook';

type Tab = 'today' | 'week' | 'tasks' | 'timetable' | 'notes';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: '今天', icon: '☀️' },
  { id: 'week', label: '週格', icon: '🗓️' },
  { id: 'tasks', label: '任務', icon: '✅' },
  { id: 'timetable', label: '課表', icon: '🏫' },
  { id: 'notes', label: '筆記', icon: '📒' },
];

function Shell() {
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem('tab') as Tab) || 'today');
  const [ready, setReady] = useState(false);
  const toast = useToast();

  useEffect(() => {
    seedIfNeeded().catch(() => {}).finally(() => setReady(true));
    requestPersistence();
    setToastHandler(toast);
  }, [toast]);

  useReminderEngine();

  const go = (t: Tab) => {
    setTab(t);
    try {
      sessionStorage.setItem('tab', t);
    } catch {
      /* 略過 */
    }
  };

  if (!ready) return <div className="empty" style={{ paddingTop: 120 }}>載入中…</div>;

  return (
    <div className="app">
      {import.meta.env.MODE === 'single' && (
        <div className="preview-note">
          預覽版：可試用排程、任務、課表與筆記。資料只存在這個預覽頁；拍照辨識、匯出檔案與提醒通知請在正式網站使用。
        </div>
      )}
      {tab === 'today' && <Today />}
      {tab === 'week' && <Week />}
      {tab === 'tasks' && <Tasks />}
      {tab === 'timetable' && <Timetable />}
      {tab === 'notes' && <Notebook />}
      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => go(t.id)}>
            <span className="ic">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <Shell />
      </ConfirmProvider>
    </ToastProvider>
  );
}
