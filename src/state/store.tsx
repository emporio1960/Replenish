import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AppData, Recipe, RecurringPurchase, ShoppingItem, ViewId } from '../types';
import { notifyDevice } from '../lib/notify';
import { today as todayNow } from '../lib/dates';
import { buildAlerts, type Alert } from '../lib/insights';
import { buildRecommendations, type Recommendation } from '../lib/replenishment';
import { loadData, saveData } from '../lib/storage';
import { uid } from '../lib/format';
import { processDue, type ItemInput, type RecurringInput } from './actions';
import { useSync, type SyncApi } from './useSync';

export type ModalState =
  | { type: 'item'; item?: ShoppingItem; itemId?: string; preset?: Partial<ItemInput> }
  | { type: 'itemActions'; itemId: string }
  | { type: 'defer'; itemId: string }
  | { type: 'snooze'; recurringId: string }
  | { type: 'recurring'; recurring?: RecurringPurchase; preset?: Partial<RecurringInput>; linkItemId?: string }
  | { type: 'confirm'; title: string; body: string; confirmLabel: string; danger?: boolean; onConfirm: () => void }
  | { type: 'adjust'; productKey: string }
  | { type: 'price'; historyId: string }
  | { type: 'paste' }
  | { type: 'recipe'; recipe?: Recipe }
  | { type: 'product'; productKey: string }
  | { type: 'scan' }
  | { type: 'alerts' }
  | { type: 'more' };

export interface Toast {
  id: string;
  message: string;
  action?: { label: string; run: () => void };
}

interface StoreValue {
  data: AppData;
  today: string;
  recs: Recommendation[];
  alerts: Alert[];
  /** Applies a pure change from state/actions.ts. Saving happens automatically. */
  apply: (fn: (d: AppData) => AppData) => void;
  view: ViewId;
  go: (view: ViewId) => void;
  modal: ModalState | null;
  openModal: (m: ModalState) => void;
  closeModal: () => void;
  toasts: Toast[];
  toast: (message: string, action?: Toast['action']) => void;
  dismissToast: (id: string) => void;
  saveFailed: boolean;
  sync: SyncApi;
}

const StoreContext = createContext<StoreValue | null>(null);

const VIEWS: ViewId[] = [
  'dashboard', 'list', 'deferred', 'recurring', 'suggestions', 'meals', 'history', 'analytics', 'settings', 'shop',
];

/** The view named in the address bar (#/list), or null when there is none. */
function viewFromHash(): ViewId | null {
  const name = window.location.hash.replace(/^#\/?/, '');
  return VIEWS.includes(name as ViewId) ? (name as ViewId) : null;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(() => processDue(loadData(), new Date()));
  const [today, setToday] = useState(todayNow);
  const [view, setView] = useState<ViewId>(() => viewFromHash() ?? 'dashboard');
  const [modal, setModal] = useState<ModalState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [saveFailed, setSaveFailed] = useState(false);
  const timers = useRef(new Map<string, number>());

  const sync = useSync(data, setData);

  const apply = useCallback((fn: (d: AppData) => AppData) => setData((d) => fn(d)), []);

  // Automatic saving: every change is written straight to storage.
  useEffect(() => {
    setSaveFailed(!saveData(data));
  }, [data]);

  // Keep "today" current and return deferred items when their date arrives,
  // including when the app has been left open overnight or in the background.
  useEffect(() => {
    const tick = () => {
      setToday(todayNow());
      setData((d) => processDue(d, new Date()));
    };
    const interval = window.setInterval(tick, 60_000);
    const onVisible = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', tick);
    };
  }, []);

  // Settings changes (such as switching on auto-add) take effect immediately.
  const autoAdd = data.settings.autoAddRecurring;
  useEffect(() => {
    if (autoAdd) setData((d) => processDue(d, new Date()));
  }, [autoAdd]);

  useEffect(() => {
    // Give the first screen an address too, so Back always lands on a named view.
    if (!viewFromHash()) {
      try {
        window.history.replaceState(null, '', '#/dashboard');
      } catch {
        /* some embedded hosts do not allow it; navigation still works */
      }
    }
    const onHash = () => {
      const next = viewFromHash();
      if (!next) return;
      setView(next);
      setModal(null);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((next: ViewId) => {
    setModal(null);
    // State is the source of truth; the address is kept in step where the host allows it.
    setView(next);
    if (viewFromHash() !== next) {
      try {
        window.location.hash = `/${next}`;
      } catch {
        /* ignore */
      }
    }
    window.scrollTo({ top: 0 });
  }, []);

  const theme = data.settings.theme;
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const set = () => {
      const dark = theme === 'dark' || (theme === 'system' && Boolean(media?.matches));
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? '#17141a' : '#f3f1f4');
    };
    set();
    media?.addEventListener?.('change', set);
    return () => media?.removeEventListener?.('change', set);
  }, [theme]);

  const dismissToast = useCallback((id: string) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, action?: Toast['action']) => {
      const id = uid();
      setToasts((t) => [...t.slice(-2), { id, message, action }]);
      timers.current.set(id, window.setTimeout(() => dismissToast(id), action ? 6000 : 3500));
    },
    [dismissToast],
  );

  const recs = useMemo(() => buildRecommendations(data, today), [data, today]);
  const alerts = useMemo(() => buildAlerts(data, today, recs), [data, today, recs]);
  const closeModal = useCallback(() => setModal(null), []);

  const deviceNotifications = data.settings.deviceNotifications;
  useEffect(() => {
    notifyDevice(alerts, deviceNotifications, today);
  }, [alerts, deviceNotifications, today]);

  const value = useMemo<StoreValue>(
    () => ({
      data, today, recs, alerts, apply, view, go,
      modal, openModal: setModal, closeModal,
      toasts, toast, dismissToast, saveFailed, sync,
    }),
    [data, today, recs, alerts, apply, view, go, modal, closeModal, toasts, toast, dismissToast, saveFailed, sync],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
