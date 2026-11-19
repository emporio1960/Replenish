import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash } from 'lucide-react';
import type { Store } from '../types';
import { storeCategoryOrder } from '../lib/categories';
import { formatDate, formatTime } from '../lib/dates';
import { parseNumber, plural } from '../lib/format';
import { deviceNotificationState, requestDeviceNotifications } from '../lib/notify';
import { addStore, deleteStore, forgetCategoryRule, moveAisle, renameStore, updateSettings } from '../state/actions';
import { useStore } from '../state/store';
import { CategoryIcon, Field, Segmented, Toggle } from '../components/ui';

function StoreCard({ store }: { store: Store }) {
  const { data, apply, openModal, toast } = useStore();
  const order = storeCategoryOrder(store, data.categories);
  const used = data.items.filter((i) => i.storeId === store.id).length;
  return (
    <li className="card store-card">
      <div className="form-row align-end">
        <Field label="Store name">
          <input value={store.name} maxLength={40} onChange={(e) => e.target.value.trim() && apply((d) => renameStore(d, store.id, e.target.value))} />
        </Field>
        <button
          type="button"
          className="icon-btn"
          aria-label={`Delete ${store.name}`}
          onClick={() =>
            openModal({
              type: 'confirm',
              title: `Delete ${store.name}?`,
              body: used ? `${plural(used, 'item')} assigned to this store will be set to any store.` : 'No items are assigned to this store.',
              confirmLabel: 'Delete store',
              danger: true,
              onConfirm: () => { apply((d) => deleteStore(d, store.id)); toast(`Deleted ${store.name}`); },
            })
          }
        >
          <Trash size={17} />
        </button>
      </div>
      <details className="why">
        <summary>Aisle order</summary>
        <p>Put the categories in the order you walk this store. Shopping Mode follows it.</p>
        <ol className="aisles">
          {order.map((c, i) => (
            <li key={c.id}>
              <CategoryIcon category={c} size={26} />
              <span>{c.name}</span>
              <button type="button" className="icon-btn" aria-label={`Move ${c.name} earlier`} disabled={i === 0} onClick={() => apply((d) => moveAisle(d, store.id, c.id, -1))}>
                <ArrowUp size={17} />
              </button>
              <button type="button" className="icon-btn" aria-label={`Move ${c.name} later`} disabled={i === order.length - 1} onClick={() => apply((d) => moveAisle(d, store.id, c.id, 1))}>
                <ArrowDown size={17} />
              </button>
            </li>
          ))}
        </ol>
      </details>
    </li>
  );
}

export function StoresSettings() {
  const { data, apply, toast } = useStore();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  function create() {
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter a store name.');
    if (data.stores.some((s) => s.name.trim().toLowerCase() === trimmed.toLowerCase())) return setError('A store with this name already exists.');
    apply((d) => addStore(d, trimmed));
    setName('');
    setError('');
    toast(`Added ${trimmed}`);
  }
  return (
    <>
      {data.stores.length > 0 && <ul className="cards">{data.stores.map((s) => <StoreCard key={s.id} store={s} />)}</ul>}
      <form className="card add-category" onSubmit={(e) => { e.preventDefault(); create(); }}>
        <Field label="New store" error={error} hint="Assign items to a store, then pick the store in Shopping Mode.">
          <input value={name} maxLength={40} placeholder="Such as Supermarket or Chemist" onChange={(e) => { setName(e.target.value); setError(''); }} />
        </Field>
        <button type="submit" className="btn"><Plus size={16} aria-hidden="true" /> Add store</button>
      </form>
    </>
  );
}

function AmountInput({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  const [text, setText] = useState(value !== null ? String(value) : '');
  const [error, setError] = useState('');
  // Follow outside changes such as importing a backup or clearing data.
  useEffect(() => {
    setText((t) => (parseNumber(t) === (value ?? undefined) ? t : value !== null ? String(value) : ''));
  }, [value]);
  return (
    <Field label={label} error={error}>
      <input
        value={text}
        inputMode="decimal"
        placeholder="No limit"
        onChange={(e) => {
          setText(e.target.value);
          const n = parseNumber(e.target.value);
          if (n === undefined) { setError(''); onChange(null); }
          else if (Number.isNaN(n) || n <= 0) setError('Enter an amount above zero, or leave it empty.');
          else { setError(''); onChange(n); }
        }}
      />
    </Field>
  );
}

export function SpendingBudgetSettings() {
  const { data, apply } = useStore();
  const sb = data.settings.spendingBudget;
  const set = (patch: Partial<typeof sb>) => apply((d) => updateSettings(d, { spendingBudget: { ...d.settings.spendingBudget, ...patch } }));
  const setCategory = (id: string, amount: number | null) => {
    const next = { ...sb.byCategory };
    if (amount === null) delete next[id];
    else next[id] = amount;
    set({ byCategory: next });
  };
  const count = Object.keys(sb.byCategory).length;
  return (
    <div className="card settings">
      <div className="setting">
        <span className="setting-label">Budget period</span>
        <Segmented
          label="Budget period"
          value={sb.period}
          onChange={(period) => set({ period })}
          options={[{ value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }]}
        />
      </div>
      <div className="setting setting-block">
        <AmountInput label={`Overall ${sb.period}ly limit (${data.settings.currency})`} value={sb.total} onChange={(total) => set({ total })} />
      </div>
      <details className="why setting-block">
        <summary>Limits by category{count ? ` (${count} set)` : ''}</summary>
        <div className="budget-grid">
          {data.categories.map((c) => (
            <AmountInput key={c.id} label={c.name} value={sb.byCategory[c.id] ?? null} onChange={(v) => setCategory(c.id, v)} />
          ))}
        </div>
      </details>
      <p className="fine">Compared with what you actually spend, from purchase history. See progress under Analytics.</p>
    </div>
  );
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export function AppSettings() {
  const { data, apply, toast } = useStore();
  const s = data.settings;
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(
    () => (window as unknown as { __installPrompt?: InstallPromptEvent }).__installPrompt ?? null,
  );
  useEffect(() => {
    const onPrompt = (e: Event) => setPrompt(e as InstallPromptEvent);
    window.addEventListener('replenish:installable', onPrompt);
    return () => window.removeEventListener('replenish:installable', onPrompt);
  }, []);
  const installed =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const state = deviceNotificationState();

  async function toggleDevice(on: boolean) {
    if (!on) return apply((d) => updateSettings(d, { deviceNotifications: false }));
    if (await requestDeviceNotifications()) {
      apply((d) => updateSettings(d, { deviceNotifications: true }));
      toast('Device notifications are on');
    } else {
      toast(state === 'unsupported' ? 'This browser does not support notifications here' : 'Notifications are blocked for this site in your browser settings');
    }
  }

  return (
    <div className="card settings">
      <div className="setting">
        <span className="setting-label">
          Install on this device
          <span className="toggle-desc">
            {installed
              ? 'Replenish is installed and opens like an app. It works offline.'
              : 'On iPhone or iPad, open this page in Safari, tap Share, then Add to Home Screen. In Chrome or Edge, choose Install app from the browser menu. Once installed it works offline.'}
          </span>
        </span>
        {!installed && prompt && (
          <button type="button" className="btn" onClick={() => void prompt.prompt().then(() => setPrompt(null))}>Install</button>
        )}
      </div>
      <Toggle
        label="Device notifications"
        description={
          state === 'unsupported'
            ? 'Not available in this browser. On iPhone, install the app to your Home Screen first.'
            : 'Shows new alerts as system notifications and a badge on the app icon. They appear when you open or return to the app; alerts while the app is closed need a server, which Replenish does not have.'
        }
        checked={s.deviceNotifications && state === 'granted'}
        onChange={(v) => void toggleDevice(v)}
      />
      <Toggle
        label="Look up unknown barcodes online"
        description="Sends the barcode number to Open Food Facts, a free public product database, to suggest a name. Off by default: without it you name each new barcode once."
        checked={s.barcodeLookup}
        onChange={(barcodeLookup) => apply((d) => updateSettings(d, { barcodeLookup }))}
      />
    </div>
  );
}

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

export function SyncSettings() {
  const { sync, data, toast } = useStore();
  const [token, setToken] = useState('');
  const [syncId, setSyncId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { dateFormat, time24 } = data.settings;

  async function connect() {
    setBusy(true);
    setError('');
    const problem = await sync.connect(token, syncId);
    setBusy(false);
    if (problem) setError(problem);
    else {
      setToken('');
      setSyncId('');
      toast('Sync is on for this device');
    }
  }

  if (sync.status === 'off') {
    return (
      <div className="card settings">
        <div className="setting-block sync-intro">
          <p>
            Keep Replenish in step across your own devices. Your data is saved as a private file (a secret gist) in
            your GitHub account, and each device signs in with an access token.
          </p>
          <ol className="steps">
            <li>
              Open <a href={TOKEN_URL} target="_blank" rel="noreferrer">GitHub's new token page</a> and give the token a name such as Replenish.
            </li>
            <li>Under Account permissions, set <strong>Gists</strong> to <strong>Read and write</strong>. Nothing else is needed.</li>
            <li>Choose an expiry, generate the token, copy it and paste it here.</li>
            <li>Repeat the paste on each device, using the same token or a new one.</li>
          </ol>
        </div>
        <form className="setting-block form" onSubmit={(e) => { e.preventDefault(); void connect(); }}>
          <Field label="GitHub access token" error={error}>
            <input
              type="password"
              value={token}
              autoComplete="off"
              spellCheck={false}
              placeholder="github_pat_…"
              onChange={(e) => { setToken(e.target.value); setError(''); }}
            />
          </Field>
          <details className="why">
            <summary>Have a Sync ID from another device?</summary>
            <p>Normally Replenish finds your sync file by itself. If it does not, copy the Sync ID shown on your first device and paste it here.</p>
            <Field label="Sync ID (optional)">
              <input value={syncId} autoComplete="off" spellCheck={false} onChange={(e) => setSyncId(e.target.value)} />
            </Field>
          </details>
          <button type="submit" className="btn btn-primary" disabled={busy || !token.trim()}>
            {busy ? 'Connecting…' : 'Turn on sync'}
          </button>
          <p className="fine">
            The token is stored only in this browser and is never included in backups. It can only reach your gists,
            and you can revoke it on GitHub at any time.
          </p>
        </form>
      </div>
    );
  }

  const when = sync.lastSyncedAt
    ? `${formatDate(sync.lastSyncedAt, dateFormat)} at ${formatTime(sync.lastSyncedAt, time24)}`
    : 'Not yet';
  return (
    <div className="card settings">
      {sync.status === 'conflict' && (
        <div className="setting-block conflict" role="alert">
          <strong>This device and another device have both changed since they last synced.</strong>
          <p>Choose which copy to keep. Combining keeps everything from both, so something you deleted on one device may come back.</p>
          <div className="row-wrap">
            <button type="button" className="btn btn-primary" onClick={() => sync.resolve('combine')}>Combine both</button>
            <button type="button" className="btn" onClick={() => sync.resolve('mine')}>Keep this device's</button>
            <button type="button" className="btn" onClick={() => sync.resolve('theirs')}>Use the other device's</button>
          </div>
        </div>
      )}
      {sync.status === 'error' && <p className="banner" role="alert">{sync.error} Your changes are safe on this device and will sync when this is fixed.</p>}
      <dl className="facts">
        <div><dt>GitHub account</dt><dd>{sync.account || 'Connected'}</dd></div>
        <div>
          <dt>Status</dt>
          <dd>
            {sync.status === 'syncing' ? 'Syncing…' : sync.status === 'conflict' ? 'Waiting for your choice' : sync.status === 'error' ? 'Not syncing' : 'Up to date'}
          </dd>
        </div>
        <div><dt>Last synced</dt><dd>{when}</dd></div>
        <div><dt>Sync ID</dt><dd className="mono">{sync.gistId}</dd></div>
      </dl>
      <div className="setting">
        <span className="setting-label">
          Syncs automatically
          <span className="toggle-desc">When you open the app, return to it, and a few seconds after each change.</span>
        </span>
        <div className="row-wrap">
          <button type="button" className="btn" disabled={sync.status === 'syncing' || sync.status === 'conflict'} onClick={sync.syncNow}>Sync now</button>
          <button
            type="button"
            className="btn btn-quiet danger-text"
            onClick={() => { sync.disconnect(); toast('Sync is off for this device. Your data stays here and in GitHub.'); }}
          >
            Turn off
          </button>
        </div>
      </div>
    </div>
  );
}

export function CategorySmartSettings() {
  const { data, apply, toast } = useStore();
  const s = data.settings;
  const rules = Object.entries(data.categoryRules).sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <div className="card settings">
      <p className="fine">
        New items are filed under a category automatically from their name. This happens on your device and works offline.
        Anything not recognised goes to your default category.
      </p>
      <Toggle
        label="Remember my category changes"
        description="When you move an item to a different category, file that product the same way next time."
        checked={s.rememberCategories}
        onChange={(rememberCategories) => apply((d) => updateSettings(d, { rememberCategories }))}
      />
      <Toggle
        label="Show empty categories on the list"
        checked={s.showEmptyCategories}
        onChange={(showEmptyCategories) => apply((d) => updateSettings(d, { showEmptyCategories }))}
      />
      <details className="why">
        <summary>Your category rules ({rules.length})</summary>
        {rules.length === 0 ? (
          <p>None yet. Change an item's category and Replenish remembers it here.</p>
        ) : (
          <ul className="rule-list">
            {rules.map(([key, categoryId]) => {
              const category = data.categories.find((c) => c.id === categoryId);
              if (!category) return null;
              return (
                <li key={key}>
                  <span>{key}</span>
                  <CategoryIcon category={category} size={24} />
                  <span>{category.name}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Forget the rule for ${key}`}
                    onClick={() => { apply((d) => forgetCategoryRule(d, key)); toast(`Forgot the rule for ${key}`); }}
                  >
                    <Trash size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </details>
    </div>
  );
}
