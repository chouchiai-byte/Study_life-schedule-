// 提醒：App 開著時，到時間就跳出通知（已允許通知時用系統通知，否則用 App 內提示）。

export type PermState = 'granted' | 'denied' | 'default' | 'unsupported';

export function notificationStatus(): PermState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as PermState;
}

export async function askPermission(): Promise<PermState> {
  if (notificationStatus() === 'unsupported') return 'unsupported';
  try {
    return (await Notification.requestPermission()) as PermState;
  } catch {
    return notificationStatus();
  }
}

let toastHandler: ((title: string, body?: string, icon?: string) => void) | null = null;
export const setToastHandler = (fn: (title: string, body?: string, icon?: string) => void) => {
  toastHandler = fn;
};

export async function notify(title: string, body?: string) {
  toastHandler?.(title, body, '⏰');
  if (notificationStatus() !== 'granted') return;
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) {
      await reg.showNotification(title, { body, icon: 'icon-192.png', badge: 'icon-192.png', tag: title });
    } else {
      new Notification(title, { body });
    }
  } catch {
    /* 系統不允許時，至少已有 App 內提示 */
  }
}

// ---------- 避免同一提醒重複跳出 ----------

const FIRED_KEY = 'halfblock.fired';

function loadFired(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(FIRED_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/** 第一次觸發回傳 true；同一 key 已觸發過回傳 false。 */
export function markFired(key: string): boolean {
  const fired = loadFired();
  if (fired[key]) return false;
  fired[key] = Date.now();
  // 只保留 3 天內的紀錄
  const cutoff = Date.now() - 3 * 86400000;
  for (const [k, t] of Object.entries(fired)) if (t < cutoff) delete fired[k];
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify(fired));
  } catch {
    /* 無法寫入時略過 */
  }
  return true;
}
