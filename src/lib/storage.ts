import {
  PRIORITIES,
  UNITS,
  type AppData,
  type Category,
  type DateFormat,
  type DeferralEvent,
  type Frequency,
  type FrequencyKind,
  type Notice,
  type Priority,
  type PurchaseRecord,
  type Recipe,
  type Store,
  type RecurringPurchase,
  type ReplenishPref,
  type Settings,
  type ShoppingItem,
  type SortKey,
  type Theme,
  type Unit,
} from '../types';
import { DEFAULT_CATEGORIES, OTHER_CATEGORY_ID } from './categories';
import { isValidDay, isValidIso, today } from './dates';
import { normalizeName } from './duplicates';
import { uid } from './format';
import { defaultAppearance, sanitizeAppearance } from '../theme/engine';

export const STORAGE_KEY = 'replenish:data';
export const CURRENT_VERSION = 4;

/**
 * Persistence boundary. The app only talks to this interface, so a cloud
 * database can replace LocalStorage later without touching the UI.
 */
export interface StorageAdapter {
  read(): string | null;
  write(text: string): boolean;
  clear(): void;
}

let memoryFallback: string | null = null;

export const localStorageAdapter: StorageAdapter = {
  read() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return memoryFallback;
    }
  },
  write(text) {
    memoryFallback = text;
    try {
      window.localStorage.setItem(STORAGE_KEY, text);
      return true;
    } catch {
      return false;
    }
  },
  clear() {
    memoryFallback = null;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable: nothing to clear */
    }
  },
};

export function defaultSettings(): Settings {
  return {
    currency: 'AUD',
    dateFormat: 'DD/MM/YYYY',
    time24: true,
    theme: 'system',
    appearance: defaultAppearance(),
    budget: null,
    defaultCategoryId: OTHER_CATEGORY_ID,
    listSort: 'category',
    groupByCategory: true,
    autoAddRecurring: false,
    notifications: { recurringDue: true, deferredReturn: true, replenishment: true, budget: true },
    spendingBudget: { period: 'week', total: null, byCategory: {} },
    shoppingStoreId: null,
    rememberCategories: true,
    showEmptyCategories: false,
    collapsedCategories: [],
    barcodeLookup: false,
    deviceNotifications: false,
  };
}

export function defaultData(): AppData {
  return {
    version: CURRENT_VERSION,
    items: [],
    recurring: [],
    history: [],
    deferrals: [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    settings: defaultSettings(),
    replenishPrefs: {},
    notices: [],
    stores: [],
    recipes: [],
    categoryRules: {},
    barcodes: {},
    onboarded: false,
  };
}

/* ---------- validation helpers ---------- */

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const optText = (v: unknown, max = 500): string | undefined => text(v, max) || undefined;
const posNum = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
const optMoney = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
const count = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback;
const iso = (v: unknown, fallback: string): string => (isValidIso(v) ? v : fallback);
const optIso = (v: unknown): string | undefined => (isValidIso(v) ? v : undefined);
const optDay = (v: unknown): string | undefined => (isValidDay(v) ? v : undefined);
const id = (v: unknown): string => text(v, 80) || uid();
const flag = (v: unknown): true | undefined => (v === true ? true : undefined);

const FREQ_KINDS: FrequencyKind[] = [
  'daily', '3days', 'weekly', 'fortnightly', 'monthly', '2months', '3months', 'custom',
];

function sanitizeFrequency(v: unknown): Frequency {
  if (!isObj(v)) return { kind: 'weekly' };
  const kind = oneOf(v.kind, FREQ_KINDS, 'weekly');
  return kind === 'custom'
    ? { kind, customDays: Math.min(730, Math.max(1, Math.round(posNum(v.customDays, 7)))) }
    : { kind };
}

function sanitizeCategories(v: unknown): Category[] {
  const seen = new Set<string>();
  const out: Category[] = [];
  for (const raw of arr(v)) {
    if (!isObj(raw)) continue;
    const name = text(raw.name, 40);
    const cid = text(raw.id, 80);
    if (!name || !cid || seen.has(cid)) continue;
    seen.add(cid);
    out.push({
      id: cid,
      name,
      icon: text(raw.icon, 20) || 'tag',
      color: /^#[0-9a-fA-F]{6}$/.test(text(raw.color)) ? text(raw.color) : '#6f7480',
      custom: bool(raw.custom, true),
    });
  }
  // The built-in categories always exist so every item has somewhere to live.
  for (const d of DEFAULT_CATEGORIES) if (!seen.has(d.id)) out.push({ ...d });
  return out;
}

function sanitizeItem(raw: unknown, catIds: Set<string>, now: string): ShoppingItem | null {
  if (!isObj(raw)) return null;
  const name = text(raw.name, 80);
  if (!name) return null;
  let status = oneOf(raw.status, ['active', 'purchased', 'deferred'] as const, 'active');
  const item: ShoppingItem = {
    id: id(raw.id),
    name,
    quantity: posNum(raw.quantity, 1),
    unit: oneOf<Unit>(raw.unit, UNITS, 'units'),
    estimatedPrice: optMoney(raw.estimatedPrice),
    actualPrice: optMoney(raw.actualPrice),
    categoryId: catIds.has(text(raw.categoryId)) ? text(raw.categoryId) : OTHER_CATEGORY_ID,
    notes: optText(raw.notes),
    priority: oneOf<Priority>(raw.priority, PRIORITIES, 'normal'),
    status,
    createdAt: iso(raw.createdAt, now),
    deferCount: count(raw.deferCount),
    storeId: optText(raw.storeId, 80),
    recurringId: optText(raw.recurringId, 80),
    recurringPrevDue: optDay(raw.recurringPrevDue),
    returnedAt: optIso(raw.returnedAt),
    sample: flag(raw.sample),
  };
  if (status === 'deferred') {
    // A deferred item with broken deferral data stays deferred (indefinitely)
    // rather than vanishing: deferred items are never silently lost.
    const d = isObj(raw.deferral) ? raw.deferral : {};
    item.deferral = {
      deferredAt: iso(d.deferredAt, now),
      until: isValidDay(d.until) ? d.until : null,
      reason: optText(d.reason, 200),
    };
    item.deferCount = Math.max(1, item.deferCount);
  }
  if (status === 'purchased') {
    item.purchasedAt = iso(raw.purchasedAt, now);
    item.historyId = optText(raw.historyId, 80);
  }
  return item;
}

function sanitizeRecurring(raw: unknown, catIds: Set<string>, now: string): RecurringPurchase | null {
  if (!isObj(raw)) return null;
  const name = text(raw.name, 80);
  if (!name) return null;
  return {
    id: id(raw.id),
    name,
    quantity: posNum(raw.quantity, 1),
    unit: oneOf<Unit>(raw.unit, UNITS, 'units'),
    estimatedPrice: optMoney(raw.estimatedPrice),
    categoryId: catIds.has(text(raw.categoryId)) ? text(raw.categoryId) : OTHER_CATEGORY_ID,
    notes: optText(raw.notes),
    frequency: sanitizeFrequency(raw.frequency),
    nextDue: isValidDay(raw.nextDue) ? raw.nextDue : today(),
    reminderDate: optDay(raw.reminderDate),
    paused: bool(raw.paused, false),
    createdAt: iso(raw.createdAt, now),
    lastPurchasedAt: optIso(raw.lastPurchasedAt),
    skippedCount: count(raw.skippedCount),
    completedCount: count(raw.completedCount),
    sample: flag(raw.sample),
  };
}

function sanitizeRecord(raw: unknown, catIds: Set<string>): PurchaseRecord | null {
  if (!isObj(raw)) return null;
  const name = text(raw.name, 80);
  if (!name || !isValidIso(raw.purchasedAt)) return null;
  return {
    id: id(raw.id),
    name,
    key: normalizeName(name),
    quantity: posNum(raw.quantity, 1),
    unit: oneOf<Unit>(raw.unit, UNITS, 'units'),
    price: optMoney(raw.price),
    categoryId: catIds.has(text(raw.categoryId)) ? text(raw.categoryId) : OTHER_CATEGORY_ID,
    purchasedAt: raw.purchasedAt,
    recurring: bool(raw.recurring, false),
    recurringId: optText(raw.recurringId, 80),
    sample: flag(raw.sample),
  };
}

function sanitizeDeferral(raw: unknown): DeferralEvent | null {
  if (!isObj(raw)) return null;
  const name = text(raw.name, 80);
  if (!name || !isValidIso(raw.at)) return null;
  return {
    id: id(raw.id),
    itemId: text(raw.itemId, 80),
    name,
    key: normalizeName(name),
    categoryId: optText(raw.categoryId, 80),
    at: raw.at,
    until: isValidDay(raw.until) ? raw.until : null,
    sample: flag(raw.sample),
  };
}

function sanitizeStores(v: unknown, catIds: Set<string>): Store[] {
  const out: Store[] = [];
  for (const raw of arr(v)) {
    if (!isObj(raw)) continue;
    const name = text(raw.name, 40);
    if (!name) continue;
    const order = [...new Set(arr(raw.aisleOrder).filter((c): c is string => typeof c === 'string' && catIds.has(c)))];
    out.push({ id: id(raw.id), name, aisleOrder: order, sample: flag(raw.sample) });
  }
  return out;
}

function sanitizeRecipes(v: unknown): Recipe[] {
  const out: Recipe[] = [];
  for (const raw of arr(v)) {
    if (!isObj(raw)) continue;
    const name = text(raw.name, 80);
    if (!name) continue;
    const ingredients = arr(raw.ingredients)
      .filter(isObj)
      .filter((i) => text(i.name, 80))
      .map((i) => ({ name: text(i.name, 80), quantity: posNum(i.quantity, 1), unit: oneOf<Unit>(i.unit, UNITS, 'units') }));
    out.push({ id: id(raw.id), name, ingredients, sample: flag(raw.sample) });
  }
  return out;
}

function sanitizeSettings(raw: unknown, catIds: Set<string>, storeIds: Set<string>): Settings {
  const d = defaultSettings();
  if (!isObj(raw)) return d;
  const n = isObj(raw.notifications) ? raw.notifications : {};
  const sb = isObj(raw.spendingBudget) ? raw.spendingBudget : {};
  const byCategory: Record<string, number> = {};
  if (isObj(sb.byCategory)) {
    for (const [cid, amount] of Object.entries(sb.byCategory)) {
      if (catIds.has(cid) && typeof amount === 'number' && Number.isFinite(amount) && amount > 0) byCategory[cid] = amount;
    }
  }
  const currency = text(raw.currency, 10).toUpperCase();
  return {
    currency: /^[A-Z]{3}$/.test(currency) ? currency : d.currency,
    dateFormat: oneOf<DateFormat>(raw.dateFormat, ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'], d.dateFormat),
    time24: bool(raw.time24, d.time24),
    theme: oneOf<Theme>(raw.theme, ['light', 'dark', 'system'], d.theme),
    appearance: sanitizeAppearance(raw.appearance),
    budget: typeof raw.budget === 'number' && Number.isFinite(raw.budget) && raw.budget > 0 ? raw.budget : null,
    defaultCategoryId: catIds.has(text(raw.defaultCategoryId)) ? text(raw.defaultCategoryId) : d.defaultCategoryId,
    listSort: oneOf<SortKey>(raw.listSort, ['category', 'name', 'added', 'priority'], d.listSort),
    groupByCategory: bool(raw.groupByCategory, d.groupByCategory),
    autoAddRecurring: bool(raw.autoAddRecurring, d.autoAddRecurring),
    notifications: {
      recurringDue: bool(n.recurringDue, true),
      deferredReturn: bool(n.deferredReturn, true),
      replenishment: bool(n.replenishment, true),
      budget: bool(n.budget, true),
    },
    spendingBudget: {
      period: oneOf(sb.period, ['week', 'month'] as const, 'week'),
      total: typeof sb.total === 'number' && Number.isFinite(sb.total) && sb.total > 0 ? sb.total : null,
      byCategory,
    },
    shoppingStoreId: storeIds.has(text(raw.shoppingStoreId)) ? text(raw.shoppingStoreId) : null,
    rememberCategories: bool(raw.rememberCategories, true),
    showEmptyCategories: bool(raw.showEmptyCategories, false),
    collapsedCategories: [...new Set(arr(raw.collapsedCategories).filter((c): c is string => typeof c === 'string' && catIds.has(c)))],
    barcodeLookup: bool(raw.barcodeLookup, false),
    deviceNotifications: bool(raw.deviceNotifications, false),
  };
}

const keep = <T,>(v: T | null): v is T => v !== null;

/** Upgrades older saved shapes step by step. Add a case when CURRENT_VERSION changes. */
function migrate(raw: Raw): Raw {
  let data = raw;
  let version = typeof data.version === 'number' ? data.version : 0;
  while (version < CURRENT_VERSION) {
    switch (version) {
      case 0:
        // Pre-versioning saves used "deferralLog" for the deferral history.
        data = { ...data, deferrals: data.deferrals ?? data.deferralLog };
        break;
      case 1:
        // Version 2 added stores, recipes and learned barcodes.
        data = { ...data, stores: data.stores ?? [], recipes: data.recipes ?? [], barcodes: data.barcodes ?? {} };
        break;
      case 2:
        // Version 3 added learned category rules (and the Household essentials
        // category, which sanitizeCategories adds for existing saves).
        data = { ...data, categoryRules: data.categoryRules ?? {} };
        break;
      case 3:
        // Version 4 added appearance settings (themes). Older saves get the
        // original Replenish theme, so nothing looks different until chosen.
        break;
    }
    version += 1;
  }
  return { ...data, version: CURRENT_VERSION };
}

/**
 * Validates anything read from storage or an import file and returns a
 * well-formed AppData. Invalid records are dropped; invalid fields fall back
 * to defaults. Throws only when the input is not Replenish data at all.
 */
export function sanitize(input: unknown): AppData {
  if (!isObj(input)) throw new Error('This file does not contain Replenish data.');
  if (typeof input.version === 'number' && input.version > CURRENT_VERSION) {
    throw new Error('This backup was made by a newer version of Replenish.');
  }
  if (!('items' in input) && !('recurring' in input) && !('history' in input) && !('settings' in input)) {
    throw new Error('This file does not contain Replenish data.');
  }
  const raw = migrate(input);
  const now = new Date().toISOString();
  const categories = sanitizeCategories(raw.categories);
  const catIds = new Set(categories.map((c) => c.id));

  const unique = <T extends { id: string }>(list: T[]): T[] => {
    const seen = new Set<string>();
    return list.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  };

  const recurring = unique(arr(raw.recurring).map((r) => sanitizeRecurring(r, catIds, now)).filter(keep));
  const recurringIds = new Set(recurring.map((r) => r.id));
  const history = unique(arr(raw.history).map((r) => sanitizeRecord(r, catIds)).filter(keep));
  const stores = unique(sanitizeStores(raw.stores, catIds));
  const storeIds = new Set(stores.map((s) => s.id));
  const items = unique(arr(raw.items).map((i) => sanitizeItem(i, catIds, now)).filter(keep)).map((i) => ({
    ...i,
    recurringId: i.recurringId && recurringIds.has(i.recurringId) ? i.recurringId : undefined,
    storeId: i.storeId && storeIds.has(i.storeId) ? i.storeId : undefined,
  }));

  const barcodes: Record<string, string> = {};
  if (isObj(raw.barcodes)) {
    for (const [code, name] of Object.entries(raw.barcodes)) {
      if (/^\d{6,14}$/.test(code) && text(name, 80)) barcodes[code] = text(name, 80);
    }
  }

  const categoryRules: Record<string, string> = {};
  if (isObj(raw.categoryRules)) {
    for (const [key, cid] of Object.entries(raw.categoryRules)) {
      if (key && key.length <= 80 && typeof cid === 'string' && catIds.has(cid)) categoryRules[key] = cid;
    }
  }

  const replenishPrefs: Record<string, ReplenishPref> = {};
  if (isObj(raw.replenishPrefs)) {
    for (const [key, value] of Object.entries(raw.replenishPrefs)) {
      if (!isObj(value)) continue;
      const pref: ReplenishPref = {};
      if (isValidDay(value.dismissedAtPurchase)) pref.dismissedAtPurchase = value.dismissedAtPurchase;
      if (typeof value.customIntervalDays === 'number' && value.customIntervalDays >= 1) {
        pref.customIntervalDays = Math.min(730, Math.round(value.customIntervalDays));
      }
      if (isObj(value.stock) && typeof value.stock.quantity === 'number' && value.stock.quantity >= 0 && isValidDay(value.stock.day)) {
        pref.stock = { quantity: value.stock.quantity, unit: oneOf<Unit>(value.stock.unit, UNITS, 'units'), day: value.stock.day };
      }
      if (Object.keys(pref).length) replenishPrefs[key] = pref;
    }
  }

  const notices: Notice[] = arr(raw.notices)
    .filter(isObj)
    .filter((n) => text(n.message) && isValidIso(n.at))
    .map((n) => ({
      id: id(n.id),
      kind: oneOf(n.kind, ['deferred-return', 'recurring-added'] as const, 'deferred-return'),
      message: text(n.message, 300),
      at: n.at as string,
    }))
    .slice(-50);

  return {
    version: CURRENT_VERSION,
    items,
    recurring,
    history,
    deferrals: unique(arr(raw.deferrals).map(sanitizeDeferral).filter(keep)),
    categories,
    settings: sanitizeSettings(raw.settings, catIds, storeIds),
    replenishPrefs,
    notices,
    stores,
    recipes: unique(sanitizeRecipes(raw.recipes)),
    categoryRules,
    barcodes,
    onboarded: bool(raw.onboarded, items.length + recurring.length + history.length > 0),
  };
}

export function loadData(adapter: StorageAdapter = localStorageAdapter): AppData {
  const saved = adapter.read();
  if (!saved) return defaultData();
  try {
    return sanitize(JSON.parse(saved));
  } catch {
    // Keep the unreadable save aside instead of overwriting it.
    try {
      window.localStorage.setItem(`${STORAGE_KEY}:corrupt-${Date.now()}`, saved);
    } catch {
      /* ignore */
    }
    return defaultData();
  }
}

export function saveData(data: AppData, adapter: StorageAdapter = localStorageAdapter): boolean {
  return adapter.write(JSON.stringify(data));
}

export function exportJson(data: AppData): string {
  return JSON.stringify({ app: 'Replenish', exportedAt: new Date().toISOString(), ...data }, null, 2);
}

export type ImportResult = { ok: true; data: AppData } | { ok: false; error: string };

export function parseImport(fileText: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileText);
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' };
  }
  try {
    return { ok: true, data: { ...sanitize(parsed), onboarded: true } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'This file could not be read.' };
  }
}
