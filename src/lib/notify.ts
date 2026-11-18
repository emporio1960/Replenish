import type { Alert } from './insights';

const SEEN_KEY = 'replenish:notified';

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function deviceNotificationState(): 'unsupported' | NotificationPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export async function requestDeviceNotifications(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/**
 * Shows new alerts as device notifications and keeps the app-icon badge in
 * step. This runs only while the app is open or being resumed: without a
 * server there is nothing to wake the app in the background.
 */
export function notifyDevice(alerts: Alert[], enabled: boolean, todayStr: string): void {
  try {
    const nav = navigator as BadgeNavigator;
    if (enabled && alerts.length) void nav.setAppBadge?.(alerts.length)?.catch(() => {});
    else void nav.clearAppBadge?.()?.catch(() => {});

    if (!enabled || deviceNotificationState() !== 'granted') return;
    const saved = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? '{}') as { day?: string; ids?: string[] };
    const seen = new Set(saved.day === todayStr ? saved.ids : []);
    const fresh = alerts.filter((a) => !seen.has(a.id));
    if (!fresh.length) return;
    fresh.forEach((a) => seen.add(a.id));
    window.localStorage.setItem(SEEN_KEY, JSON.stringify({ day: todayStr, ids: [...seen] }));

    const show = (title: string, body: string, tag: string) => {
      const options = { body, tag, icon: `${import.meta.env.BASE_URL}icon-192.png` };
      if (navigator.serviceWorker?.controller) {
        void navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, options)).catch(() => {});
      } else {
        new Notification(title, options);
      }
    };
    if (fresh.length <= 2) fresh.forEach((a) => show(a.title, a.body, a.id));
    else show('Replenish', `${fresh.length} things need your attention, starting with: ${fresh[0].title}.`, 'replenish-summary');
  } catch {
    /* notifications are a convenience; never let them break the app */
  }
}
