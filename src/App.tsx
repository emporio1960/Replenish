import { Bell, Ellipsis, ShoppingCart } from 'lucide-react';
import { ModalHost, Toasts } from './components/Modals';
import { NAV, PRIMARY_NAV, SECONDARY_NAV } from './components/nav';
import { StoreProvider, useStore } from './state/store';
import { Analytics } from './views/Analytics';
import { Dashboard } from './views/Dashboard';
import { Deferred } from './views/Deferred';
import { History } from './views/History';
import { Recurring } from './views/Recurring';
import { Settings } from './views/Settings';
import { ShoppingList } from './views/ShoppingList';
import { ShoppingMode } from './views/ShoppingMode';
import { Suggestions } from './views/Suggestions';
import type { ViewId } from './types';

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      <path
        d="M22.5 16a6.5 6.5 0 1 1-2.2-4.9"
        fill="none" stroke="var(--accent-ink)" strokeWidth="2.6" strokeLinecap="round"
      />
      <path d="M21.2 6.8v4.9h-4.9" fill="none" stroke="var(--accent-ink)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="16" r="2.2" fill="var(--accent-ink)" />
    </svg>
  );
}

const VIEW: Record<Exclude<ViewId, 'shop'>, () => React.JSX.Element> = {
  dashboard: Dashboard,
  list: ShoppingList,
  deferred: Deferred,
  recurring: Recurring,
  suggestions: Suggestions,
  history: History,
  analytics: Analytics,
  settings: Settings,
};

function Shell() {
  const { view, go, data, today, alerts, openModal, saveFailed } = useStore();

  if (view === 'shop') {
    return (
      <>
        <main className="shop-main"><ShoppingMode /></main>
        <ModalHost />
        <Toasts />
      </>
    );
  }

  const View = VIEW[view];
  const badge: Partial<Record<ViewId, number>> = {
    list: data.items.filter((i) => i.status === 'active').length,
    deferred: data.items.filter((i) => i.status === 'deferred').length,
    recurring: data.recurring.filter((r) => !r.paused && r.nextDue <= today).length,
  };
  const inMore = SECONDARY_NAV.some((n) => n.id === view);
  const canShop = data.items.some((i) => i.status !== 'deferred');

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <aside className="sidebar">
        <div className="brand"><Logo /> Replenish</div>
        <nav aria-label="Sections">
          {NAV.map((n) => (
            <button key={n.id} type="button" className="nav-link" aria-current={view === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
              <n.icon size={19} aria-hidden="true" />
              <span>{n.label}</span>
              {badge[n.id] ? <span className="nav-badge">{badge[n.id]}</span> : null}
            </button>
          ))}
        </nav>
        <button type="button" className="btn btn-primary sidebar-shop" onClick={() => go('shop')} disabled={!canShop}>
          <ShoppingCart size={17} aria-hidden="true" /> Shopping Mode
        </button>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="brand brand-mobile"><Logo /> Replenish</div>
          <button
            type="button"
            className="icon-btn bell"
            aria-label={alerts.length ? `Notifications, ${alerts.length} new` : 'Notifications'}
            onClick={() => openModal({ type: 'alerts' })}
          >
            <Bell size={20} />
            {alerts.length > 0 && <span className="bell-dot">{alerts.length}</span>}
          </button>
        </header>
        {saveFailed && (
          <p className="banner" role="alert">
            Changes are not being saved in this browser (storage is full or blocked). Export a backup from Settings.
          </p>
        )}
        <main id="main" tabIndex={-1} key={view}>
          <View />
        </main>
      </div>

      <nav className="tabbar" aria-label="Sections">
        {PRIMARY_NAV.map((n) => (
          <button key={n.id} type="button" className="tab" aria-current={view === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
            <span className="tab-icon">
              <n.icon size={21} aria-hidden="true" />
              {badge[n.id] ? <span className="tab-badge">{badge[n.id]}</span> : null}
            </span>
            {n.short}
          </button>
        ))}
        <button type="button" className="tab" aria-current={inMore ? 'page' : undefined} onClick={() => openModal({ type: 'more' })}>
          <span className="tab-icon"><Ellipsis size={21} aria-hidden="true" /></span>
          More
        </button>
      </nav>

      <ModalHost />
      <Toasts />
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
