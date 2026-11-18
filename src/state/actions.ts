/**
 * Every change to application data is a pure function here:
 * (current data, arguments) -> new data. The UI never mutates state directly,
 * which keeps behaviour testable and makes a future sync layer straightforward.
 */
import type {
  AppData,
  Category,
  Frequency,
  Priority,
  PurchaseRecord,
  RecurringPurchase,
  ReplenishPref,
  Settings,
  ShoppingItem,
  Unit,
} from '../types';
import { CUSTOM_COLORS, OTHER_CATEGORY_ID } from '../lib/categories';
import { toDay } from '../lib/dates';
import { normalizeName } from '../lib/duplicates';
import { uid } from '../lib/format';
import { advance, skipFrom } from '../lib/recurrence';
import { buildSampleData } from '../lib/sampleData';
import { defaultData } from '../lib/storage';

export interface ItemInput {
  name: string;
  quantity: number;
  unit: Unit;
  estimatedPrice?: number;
  categoryId: string;
  notes?: string;
  priority: Priority;
  recurringId?: string;
}

export interface RecurringInput {
  name: string;
  quantity: number;
  unit: Unit;
  estimatedPrice?: number;
  categoryId: string;
  notes?: string;
  frequency: Frequency;
  nextDue: string;
  reminderDate?: string;
}

const mapItem = (data: AppData, id: string, fn: (i: ShoppingItem) => ShoppingItem): AppData => ({
  ...data,
  items: data.items.map((i) => (i.id === id ? fn(i) : i)),
});

const mapRecurring = (
  data: AppData,
  id: string,
  fn: (r: RecurringPurchase) => RecurringPurchase,
): AppData => ({ ...data, recurring: data.recurring.map((r) => (r.id === id ? fn(r) : r)) });

/* ---------- shopping items ---------- */

export function addItem(data: AppData, input: ItemInput, now: Date, id: string = uid()): AppData {
  const item: ShoppingItem = {
    id,
    name: input.name.trim(),
    quantity: input.quantity,
    unit: input.unit,
    estimatedPrice: input.estimatedPrice,
    categoryId: input.categoryId,
    notes: input.notes?.trim() || undefined,
    priority: input.priority,
    status: 'active',
    createdAt: now.toISOString(),
    deferCount: 0,
    recurringId: input.recurringId,
  };
  return { ...data, onboarded: true, items: [...data.items, item] };
}

export function updateItem(data: AppData, id: string, patch: Partial<ShoppingItem>): AppData {
  const next = mapItem(data, id, (i) => ({ ...i, ...patch }));
  const item = next.items.find((i) => i.id === id);
  // Keep the history record in step when a purchased item's price is corrected.
  if (item?.status === 'purchased' && item.historyId && 'actualPrice' in patch) {
    return {
      ...next,
      history: next.history.map((h) =>
        h.id === item.historyId ? { ...h, price: item.actualPrice ?? item.estimatedPrice } : h,
      ),
    };
  }
  return next;
}

export function deleteItem(data: AppData, id: string): AppData {
  return { ...data, items: data.items.filter((i) => i.id !== id) };
}

export function restoreDeletedItem(data: AppData, item: ShoppingItem): AppData {
  return data.items.some((i) => i.id === item.id) ? data : { ...data, items: [...data.items, item] };
}

/** The schedule a list item counts towards: its link, or a schedule with the same name. */
function scheduleFor(data: AppData, item: ShoppingItem): RecurringPurchase | undefined {
  return (
    data.recurring.find((r) => r.id === item.recurringId) ??
    data.recurring.find((r) => normalizeName(r.name) === normalizeName(item.name))
  );
}

export function purchaseItem(data: AppData, id: string, now: Date, actualPrice?: number): AppData {
  const item = data.items.find((i) => i.id === id);
  if (!item || item.status === 'purchased') return data;
  const at = now.toISOString();
  const schedule = scheduleFor(data, item);
  const paid = actualPrice ?? item.actualPrice;
  const record: PurchaseRecord = {
    id: uid(),
    name: item.name,
    key: normalizeName(item.name),
    quantity: item.quantity,
    unit: item.unit,
    price: paid ?? item.estimatedPrice,
    categoryId: item.categoryId,
    purchasedAt: at,
    recurring: Boolean(schedule),
    recurringId: schedule?.id,
    sample: item.sample,
  };
  let next: AppData = { ...data, history: [...data.history, record] };
  if (schedule) {
    // Completing a recurring purchase schedules the next one from the purchase date.
    next = mapRecurring(next, schedule.id, (r) => ({
      ...r,
      nextDue: advance(toDay(now), r.frequency),
      reminderDate: undefined,
      lastPurchasedAt: at,
      completedCount: r.completedCount + 1,
    }));
  }
  return mapItem(next, id, (i) => ({
    ...i,
    status: 'purchased',
    purchasedAt: at,
    actualPrice: paid,
    historyId: record.id,
    deferral: undefined,
    returnedAt: undefined,
    recurringId: schedule?.id,
    recurringPrevDue: schedule?.nextDue,
  }));
}

export function undoPurchase(data: AppData, id: string): AppData {
  const item = data.items.find((i) => i.id === id);
  if (!item || item.status !== 'purchased') return data;
  let next: AppData = { ...data, history: data.history.filter((h) => h.id !== item.historyId) };
  if (item.recurringId && item.recurringPrevDue) {
    const prevDue = item.recurringPrevDue;
    next = mapRecurring(next, item.recurringId, (r) => ({
      ...r,
      nextDue: prevDue,
      completedCount: Math.max(0, r.completedCount - 1),
    }));
  }
  return mapItem(next, id, (i) => ({
    ...i,
    status: 'active',
    purchasedAt: undefined,
    historyId: undefined,
    actualPrice: undefined,
    recurringPrevDue: undefined,
  }));
}

/** Removes ticked-off items from the list. Their purchase history is kept. */
export function clearPurchased(data: AppData): AppData {
  return { ...data, items: data.items.filter((i) => i.status !== 'purchased') };
}

/* ---------- deferrals ---------- */

export function deferItem(data: AppData, id: string, until: string | null, reason: string, now: Date): AppData {
  const item = data.items.find((i) => i.id === id);
  if (!item || item.status === 'purchased') return data;
  const at = now.toISOString();
  const already = item.status === 'deferred';
  const next = mapItem(data, id, (i) => ({
    ...i,
    status: 'deferred',
    returnedAt: undefined,
    // Changing the date of an already-deferred item is not a new postponement.
    deferCount: already ? i.deferCount : i.deferCount + 1,
    deferral: {
      deferredAt: already && i.deferral ? i.deferral.deferredAt : at,
      until,
      reason: reason.trim() || undefined,
    },
  }));
  if (already) return next;
  return {
    ...next,
    deferrals: [
      ...next.deferrals,
      { id: uid(), itemId: id, name: item.name, key: normalizeName(item.name), categoryId: item.categoryId, at, until, sample: item.sample },
    ],
  };
}

export function restoreItem(data: AppData, id: string): AppData {
  return mapItem(data, id, (i) =>
    i.status === 'deferred' ? { ...i, status: 'active', deferral: undefined, returnedAt: undefined } : i,
  );
}

/* ---------- recurring purchases ---------- */

export function addRecurring(
  data: AppData,
  input: RecurringInput,
  now: Date,
  linkItemId?: string,
  id: string = uid(),
): AppData {
  const schedule: RecurringPurchase = {
    id,
    ...input,
    name: input.name.trim(),
    notes: input.notes?.trim() || undefined,
    paused: false,
    createdAt: now.toISOString(),
    skippedCount: 0,
    completedCount: 0,
  };
  const next: AppData = { ...data, onboarded: true, recurring: [...data.recurring, schedule] };
  return linkItemId ? mapItem(next, linkItemId, (i) => ({ ...i, recurringId: id })) : next;
}

export function updateRecurring(data: AppData, id: string, patch: Partial<RecurringPurchase>): AppData {
  return mapRecurring(data, id, (r) => ({ ...r, ...patch }));
}

export function deleteRecurring(data: AppData, id: string): AppData {
  return {
    ...data,
    recurring: data.recurring.filter((r) => r.id !== id),
    items: data.items.map((i) =>
      i.recurringId === id ? { ...i, recurringId: undefined, recurringPrevDue: undefined } : i,
    ),
  };
}

/** Skips one occurrence. The schedule itself stays in place. */
export function skipRecurring(data: AppData, id: string, now: Date): AppData {
  return mapRecurring(data, id, (r) => ({
    ...r,
    nextDue: skipFrom(r.nextDue, r.frequency, toDay(now)),
    reminderDate: undefined,
    skippedCount: r.skippedCount + 1,
  }));
}

/** Pushes the next due date back without changing the schedule's frequency. */
export function snoozeRecurring(data: AppData, id: string, until: string): AppData {
  return mapRecurring(data, id, (r) => ({ ...r, nextDue: until, reminderDate: undefined }));
}

/** The not-yet-purchased list item that already covers a schedule, if any. */
export function itemForRecurring(data: AppData, r: RecurringPurchase): ShoppingItem | undefined {
  const key = normalizeName(r.name);
  return data.items.find(
    (i) => i.status !== 'purchased' && (i.recurringId === r.id || normalizeName(i.name) === key),
  );
}

/** Puts a recurring purchase on the list, reusing an existing entry rather than duplicating it. */
export function addRecurringToList(data: AppData, id: string, now: Date): AppData {
  const r = data.recurring.find((x) => x.id === id);
  if (!r) return data;
  const existing = itemForRecurring(data, r);
  if (existing) {
    return existing.recurringId === r.id ? data : mapItem(data, existing.id, (i) => ({ ...i, recurringId: r.id }));
  }
  return addItem(
    data,
    {
      name: r.name,
      quantity: r.quantity,
      unit: r.unit,
      estimatedPrice: r.estimatedPrice,
      categoryId: r.categoryId,
      notes: r.notes,
      priority: 'normal',
      recurringId: r.id,
    },
    now,
  );
}

/* ---------- time-based processing ---------- */

/**
 * Runs on load and periodically. Returns deferred items to the list when
 * their date arrives and (optionally) adds due recurring purchases.
 * Returns the same object when nothing changed.
 */
export function processDue(data: AppData, now: Date): AppData {
  const todayStr = toDay(now);
  const at = now.toISOString();
  let next = data;
  const returning = data.items.filter(
    (i) => i.status === 'deferred' && i.deferral?.until && i.deferral.until <= todayStr,
  );
  if (returning.length) {
    const ids = new Set(returning.map((i) => i.id));
    next = {
      ...next,
      items: next.items.map((i) =>
        ids.has(i.id) ? { ...i, status: 'active', deferral: undefined, returnedAt: at } : i,
      ),
      notices: next.settings.notifications.deferredReturn
        ? [
            ...next.notices,
            ...returning.map((i) => ({
              id: uid(),
              kind: 'deferred-return' as const,
              message: `${i.name} is back on your list after being deferred.`,
              at,
            })),
          ].slice(-50)
        : next.notices,
    };
  }
  if (next.settings.autoAddRecurring) {
    for (const r of next.recurring) {
      if (r.paused || r.nextDue > todayStr || itemForRecurring(next, r)) continue;
      // A purchase ticked off today has already advanced the date, so anything
      // still due here genuinely needs adding.
      next = addRecurringToList(next, r.id, now);
      next = {
        ...next,
        notices: [
          ...next.notices,
          { id: uid(), kind: 'recurring-added' as const, message: `${r.name} is due and was added to your list.`, at },
        ].slice(-50),
      };
    }
  }
  return next;
}

/* ---------- categories, settings, preferences ---------- */

export function addCategory(data: AppData, name: string): AppData {
  const custom = data.categories.filter((c) => c.custom).length;
  const category: Category = {
    id: `custom-${uid()}`,
    name: name.trim(),
    icon: 'tag',
    color: CUSTOM_COLORS[custom % CUSTOM_COLORS.length],
    custom: true,
  };
  return { ...data, categories: [...data.categories, category] };
}

export function renameCategory(data: AppData, id: string, name: string): AppData {
  return { ...data, categories: data.categories.map((c) => (c.id === id ? { ...c, name: name.trim() } : c)) };
}

/** Deletes a custom category; anything filed under it moves to Other. */
export function deleteCategory(data: AppData, id: string): AppData {
  const cat = data.categories.find((c) => c.id === id);
  if (!cat || !cat.custom) return data;
  const move = <T extends { categoryId: string }>(x: T): T =>
    x.categoryId === id ? { ...x, categoryId: OTHER_CATEGORY_ID } : x;
  return {
    ...data,
    categories: data.categories.filter((c) => c.id !== id),
    items: data.items.map(move),
    recurring: data.recurring.map(move),
    history: data.history.map(move),
    settings:
      data.settings.defaultCategoryId === id
        ? { ...data.settings, defaultCategoryId: OTHER_CATEGORY_ID }
        : data.settings,
  };
}

export function updateSettings(data: AppData, patch: Partial<Settings>): AppData {
  return { ...data, settings: { ...data.settings, ...patch } };
}

export function setReplenishPref(data: AppData, key: string, patch: ReplenishPref): AppData {
  return { ...data, replenishPrefs: { ...data.replenishPrefs, [key]: { ...data.replenishPrefs[key], ...patch } } };
}

/* ---------- history ---------- */

export function deleteHistory(data: AppData, id: string): AppData {
  return {
    ...data,
    history: data.history.filter((h) => h.id !== id),
    items: data.items.map((i) => (i.historyId === id ? { ...i, historyId: undefined } : i)),
  };
}

export function setHistoryPrice(data: AppData, id: string, price: number | undefined): AppData {
  return {
    ...data,
    history: data.history.map((h) => (h.id === id ? { ...h, price } : h)),
    items: data.items.map((i) => (i.historyId === id ? { ...i, actualPrice: price } : i)),
  };
}

/* ---------- notices ---------- */

export function dismissNotice(data: AppData, id: string): AppData {
  return { ...data, notices: data.notices.filter((n) => n.id !== id) };
}

export function clearNotices(data: AppData): AppData {
  return data.notices.length ? { ...data, notices: [] } : data;
}

/* ---------- whole-data operations ---------- */

export function loadSample(data: AppData, now: Date): AppData {
  const without = removeSample(data);
  const sample = buildSampleData(toDay(now));
  return {
    ...without,
    onboarded: true,
    items: [...without.items, ...sample.items],
    recurring: [...without.recurring, ...sample.recurring],
    history: [...without.history, ...sample.history],
    deferrals: [...without.deferrals, ...sample.deferrals],
  };
}

export function hasSample(data: AppData): boolean {
  return (
    data.items.some((i) => i.sample) ||
    data.recurring.some((r) => r.sample) ||
    data.history.some((h) => h.sample) ||
    data.deferrals.some((d) => d.sample)
  );
}

/** Removes demonstration records only. Anything the user created stays. */
export function removeSample(data: AppData): AppData {
  const goneRecurring = new Set(data.recurring.filter((r) => r.sample).map((r) => r.id));
  return {
    ...data,
    items: data.items
      .filter((i) => !i.sample)
      .map((i) => (i.recurringId && goneRecurring.has(i.recurringId) ? { ...i, recurringId: undefined } : i)),
    recurring: data.recurring.filter((r) => !r.sample),
    history: data.history.filter((h) => !h.sample),
    deferrals: data.deferrals.filter((d) => !d.sample),
  };
}

export function clearAll(): AppData {
  return { ...defaultData(), onboarded: true };
}
