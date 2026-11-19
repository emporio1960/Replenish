import { useRef, useState } from 'react';
import { Check, Download, Pencil, Plus, Trash, Upload, X } from 'lucide-react';
import type { Category, DateFormat, SortKey, Theme } from '../types';
import { formatDate, formatTime } from '../lib/dates';
import { CURRENCIES, formatMoney, parseNumber, plural } from '../lib/format';
import { CURRENT_VERSION, exportJson, parseImport, STORAGE_KEY } from '../lib/storage';
import {
  addCategory, clearAll, deleteCategory, hasSample, loadSample, processDue, removeSample,
  renameCategory, updateSettings,
} from '../state/actions';
import { useStore } from '../state/store';
import { CategoryIcon, Field, PageHeader, Section, Segmented, Toggle } from '../components/ui';
import { AppSettings, CategorySmartSettings, SpendingBudgetSettings, StoresSettings, SyncSettings } from './SettingsExtras';

declare const __APP_VERSION__: string;

function CategoryRow({ category }: { category: Category }) {
  const { data, apply, openModal, toast } = useStore();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [error, setError] = useState('');
  const inUse =
    data.items.filter((i) => i.categoryId === category.id).length +
    data.recurring.filter((r) => r.categoryId === category.id).length;

  function save() {
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter a category name.');
    if (data.categories.some((c) => c.id !== category.id && c.name.toLowerCase() === trimmed.toLowerCase())) {
      return setError('Another category already has this name.');
    }
    apply((d) => renameCategory(d, category.id, trimmed));
    setEditing(false);
    setError('');
  }

  return (
    <li className="row">
      <CategoryIcon category={category} size={32} />
      {editing ? (
        <form className="row-body inline-edit" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <input value={name} maxLength={40} autoFocus aria-label={`Rename ${category.name}`} onChange={(e) => { setName(e.target.value); setError(''); }} />
          {error && <span className="field-error" role="alert">{error}</span>}
        </form>
      ) : (
        <div className="row-body">
          <span className="row-title">{category.name}</span>
          <span className="row-meta">{category.custom ? 'Custom category' : 'Built in'}{inUse ? `, ${plural(inUse, 'item')}` : ''}</span>
        </div>
      )}
      {editing ? (
        <>
          <button type="button" className="icon-btn" aria-label="Save name" onClick={save}><Check size={18} /></button>
          <button type="button" className="icon-btn" aria-label="Cancel rename" onClick={() => { setEditing(false); setName(category.name); setError(''); }}><X size={18} /></button>
        </>
      ) : (
        <>
          <button type="button" className="icon-btn" aria-label={`Rename ${category.name}`} onClick={() => setEditing(true)}><Pencil size={17} /></button>
          {category.custom && (
            <button
              type="button"
              className="icon-btn"
              aria-label={`Delete ${category.name}`}
              onClick={() =>
                openModal({
                  type: 'confirm',
                  title: `Delete ${category.name}?`,
                  body: inUse
                    ? `${plural(inUse, 'item')} in this category will move to Other. Nothing else is deleted.`
                    : 'This category is not used by any items.',
                  confirmLabel: 'Delete category',
                  danger: true,
                  onConfirm: () => { apply((d) => deleteCategory(d, category.id)); toast(`Deleted ${category.name}`); },
                })
              }
            >
              <Trash size={17} />
            </button>
          )}
        </>
      )}
    </li>
  );
}

export function Settings() {
  const { data, apply, openModal, toast, saveFailed, sync } = useStore();
  const s = data.settings;
  const set = (patch: Partial<typeof s>) => apply((d) => updateSettings(d, patch));
  const [budget, setBudget] = useState(s.budget !== null ? String(s.budget) : '');
  const [budgetError, setBudgetError] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [importError, setImportError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const sampleDay = new Date().toISOString();

  function changeBudget(text: string) {
    setBudget(text);
    const n = parseNumber(text);
    if (n === undefined) {
      setBudgetError('');
      set({ budget: null });
    } else if (Number.isNaN(n) || n <= 0) {
      setBudgetError('Enter an amount above zero, or leave it empty for no budget.');
    } else {
      setBudgetError('');
      set({ budget: n });
    }
  }

  function createCategory() {
    const name = newCategory.trim();
    if (!name) return setCategoryError('Enter a category name.');
    if (data.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      return setCategoryError('A category with this name already exists.');
    }
    apply((d) => addCategory(d, name));
    setNewCategory('');
    setCategoryError('');
    toast(`Added ${name}`);
  }

  function exportData() {
    const blob = new Blob([exportJson(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `replenish-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Backup file downloaded');
  }

  async function importFile(file: File) {
    setImportError('');
    let text: string;
    try {
      text = await file.text();
    } catch {
      return setImportError('This file could not be read.');
    }
    const result = parseImport(text);
    if (!result.ok) return setImportError(result.error);
    const d = result.data;
    openModal({
      type: 'confirm',
      title: 'Replace your data with this backup?',
      body: `The backup contains ${plural(d.items.length, 'list item')}, ${plural(d.recurring.length, 'recurring purchase')}, ${plural(d.history.length, 'purchase record')} and ${plural(d.recipes.length, 'meal')}. Everything currently in Replenish on this device will be replaced.`,
      confirmLabel: 'Replace data',
      danger: true,
      onConfirm: () => {
        apply(() => processDue(d, new Date()));
        setBudget(d.settings.budget !== null ? String(d.settings.budget) : '');
        toast('Backup restored');
      },
    });
  }

  return (
    <>
      <PageHeader title="Settings" />

      <Section title="Sync across devices">
        <SyncSettings />
      </Section>

      <Section title="Appearance">
        <div className="card settings">
          <div className="setting">
            <span className="setting-label">Theme</span>
            <Segmented<Theme>
              label="Theme"
              value={s.theme}
              onChange={(theme) => set({ theme })}
              options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'Match device' }]}
            />
          </div>
        </div>
      </Section>

      <Section title="Region and formats">
        <div className="card settings">
          <label className="setting">
            <span className="setting-label">Currency</span>
            <select value={s.currency} onChange={(e) => set({ currency: e.target.value })}>
              {[...new Set([...CURRENCIES, s.currency])].map((c) => (
                <option key={c} value={c}>{c} ({formatMoney(12.5, c)})</option>
              ))}
            </select>
          </label>
          <label className="setting">
            <span className="setting-label">Date format</span>
            <select value={s.dateFormat} onChange={(e) => set({ dateFormat: e.target.value as DateFormat })}>
              {(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as DateFormat[]).map((f) => (
                <option key={f} value={f}>{f} ({formatDate(sampleDay, f)})</option>
              ))}
            </select>
          </label>
          <Toggle
            label="24-hour time"
            description={`Times look like ${formatTime(sampleDay, s.time24)}`}
            checked={s.time24}
            onChange={(time24) => set({ time24 })}
          />
        </div>
      </Section>

      <Section title="Shopping">
        <div className="card settings">
          <div className="setting setting-block">
            <Field
              label={`Budget for the current list (${s.currency})`}
              error={budgetError}
              hint="Compared with the estimated cost of your current list. Leave empty for no budget."
            >
              <input value={budget} inputMode="decimal" placeholder="No budget" onChange={(e) => changeBudget(e.target.value)} />
            </Field>
          </div>
          <label className="setting">
            <span className="setting-label">Category for items that are not recognised</span>
            <select value={s.defaultCategoryId} onChange={(e) => set({ defaultCategoryId: e.target.value })}>
              {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="setting">
            <span className="setting-label">Organise the list by</span>
            <select value={s.listSort} onChange={(e) => set({ listSort: e.target.value as SortKey })}>
              <option value="category">Category</option>
              <option value="priority">Priority</option>
              <option value="name">Name</option>
              <option value="added">Date added</option>
            </select>
          </label>
          <Toggle label="Group the list by category" checked={s.groupByCategory} onChange={(groupByCategory) => set({ groupByCategory })} />
          <Toggle
            label="Add due recurring purchases automatically"
            description="When off, due purchases wait under Recurring until you add them."
            checked={s.autoAddRecurring}
            onChange={(autoAddRecurring) => set({ autoAddRecurring })}
          />
        </div>
      </Section>

      <Section title="Spending budgets">
        <SpendingBudgetSettings />
      </Section>

      <Section title="Stores">
        <StoresSettings />
      </Section>

      <Section title="Automatic categories">
        <CategorySmartSettings />
      </Section>

      <Section title="Categories">
        <ul className="card rows">
          {data.categories.map((c) => <CategoryRow key={c.id} category={c} />)}
        </ul>
        <form className="card add-category" onSubmit={(e) => { e.preventDefault(); createCategory(); }}>
          <Field label="New category" error={categoryError}>
            <input value={newCategory} maxLength={40} placeholder="Such as Garden or Baby" onChange={(e) => { setNewCategory(e.target.value); setCategoryError(''); }} />
          </Field>
          <button type="submit" className="btn"><Plus size={16} aria-hidden="true" /> Add category</button>
        </form>
      </Section>

      <Section title="Notifications">
        <div className="card settings">
          <p className="fine">Notifications appear inside the app, under the bell.</p>
          <Toggle label="Recurring purchases due" checked={s.notifications.recurringDue} onChange={(v) => set({ notifications: { ...s.notifications, recurringDue: v } })} />
          <Toggle label="Deferred items returning to the list" checked={s.notifications.deferredReturn} onChange={(v) => set({ notifications: { ...s.notifications, deferredReturn: v } })} />
          <Toggle label="Replenishment reminders" checked={s.notifications.replenishment} onChange={(v) => set({ notifications: { ...s.notifications, replenishment: v } })} />
          <Toggle label="Going over budget" checked={s.notifications.budget} onChange={(v) => set({ notifications: { ...s.notifications, budget: v } })} />
        </div>
      </Section>

      <Section title="App and scanning">
        <AppSettings />
      </Section>

      <Section title="Backup and data">
        <div className="card settings">
          {saveFailed && (
            <p className="banner" role="alert">
              Changes cannot be saved in this browser right now (storage is full or blocked). Export a backup to keep your data.
            </p>
          )}
          <div className="setting">
            <span className="setting-label">
              Export a backup
              <span className="toggle-desc">Downloads everything as a JSON file.</span>
            </span>
            <button type="button" className="btn" onClick={exportData}><Download size={16} aria-hidden="true" /> Export JSON</button>
          </div>
          <div className="setting">
            <span className="setting-label">
              Restore from a backup
              <span className="toggle-desc">Replaces the data on this device with a JSON backup.</span>
              {importError && <span className="field-error" role="alert">{importError}</span>}
            </span>
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}><Upload size={16} aria-hidden="true" /> Import JSON</button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              aria-label="Choose a backup file to import"
              tabIndex={-1}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void importFile(file);
              }}
            />
          </div>
          <div className="setting">
            <span className="setting-label">
              Demo data
              <span className="toggle-desc">Sample items, schedules and three months of purchases to explore the app. Your own records are never touched.</span>
            </span>
            {hasSample(data) ? (
              <button type="button" className="btn" onClick={() => { apply(removeSample); toast('Demo data removed'); }}>Remove demo data</button>
            ) : (
              <button type="button" className="btn" onClick={() => { apply((d) => loadSample(d, new Date())); toast('Demo data loaded'); }}>Load demo data</button>
            )}
          </div>
          <div className="setting">
            <span className="setting-label">
              Clear all data
              <span className="toggle-desc">Deletes every item, schedule, purchase record and setting on this device.</span>
            </span>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() =>
                openModal({
                  type: 'confirm',
                  title: 'Clear all data?',
                  body: 'This permanently deletes your shopping list, deferred items, recurring purchases, purchase history and settings from this device. Export a backup first if you might want them back.' +
                    (sync.status !== 'off' ? ' Sync is on, so your other devices will be cleared too.' : ''),
                  confirmLabel: 'Clear everything',
                  danger: true,
                  onConfirm: () => { apply(clearAll); setBudget(''); toast('All data cleared'); },
                })
              }
            >
              Clear all data
            </button>
          </div>
        </div>
      </Section>

      <Section title="About">
        <div className="card settings">
          <dl className="facts">
            <div><dt>Application</dt><dd>Replenish {__APP_VERSION__}</dd></div>
            <div><dt>Data format</dt><dd>Version {CURRENT_VERSION}</dd></div>
            <div><dt>Stored</dt><dd>On this device only, in browser storage ({STORAGE_KEY})</dd></div>
            <div>
              <dt>Records</dt>
              <dd>{plural(data.items.length, 'list item')}, {data.recurring.length} recurring, {plural(data.history.length, 'purchase')}, {plural(data.recipes.length, 'meal')}, {plural(Object.keys(data.barcodes).length, 'barcode')}</dd>
            </div>
          </dl>
          <p className="fine">
            Suggestions are calculated on this device from your purchase dates using simple, explainable
            rules. Nothing is sent anywhere and no account is needed.
          </p>
        </div>
      </Section>
    </>
  );
}
