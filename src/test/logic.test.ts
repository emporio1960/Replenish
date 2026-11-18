import { describe, expect, it } from 'vitest';
import type { AppData } from '../types';
import { addDays, addMonths, nextMonday, toDay } from '../lib/dates';
import { findDuplicates, isLikelyDuplicate, normalizeName } from '../lib/duplicates';
import { advance, skipFrom } from '../lib/recurrence';
import { buildRecommendations } from '../lib/replenishment';
import { buildInsights } from '../lib/insights';
import { defaultData, exportJson, parseImport, sanitize } from '../lib/storage';
import {
  addItem, addRecurring, addRecurringToList, clearAll, deferItem, deleteCategory, addCategory, deleteItem,
  deleteRecurring, hasSample, loadSample, processDue, purchaseItem, removeSample, restoreItem,
  skipRecurring, undoPurchase, updateItem, updateRecurring, updateSettings,
} from '../state/actions';

const at = (day: string, hour = 10) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour);
};
const NOW = at('2026-11-18');
const item = (name: string, extra = {}) => ({
  name, quantity: 1, unit: 'units' as const, categoryId: 'other', priority: 'normal' as const, ...extra,
});
const withItem = (name: string, d: AppData = defaultData(), now = NOW) => {
  const next = addItem(d, item(name), now, `id-${name}`);
  return next;
};

describe('dates', () => {
  it('adds days and months across boundaries', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-18', 3)).toBe('2027-02-18');
    expect(nextMonday('2026-11-18')).toBe('2026-11-23');
    expect(nextMonday('2026-11-23')).toBe('2026-11-30');
  });
});

describe('shopping items', () => {
  it('adds, edits and deletes', () => {
    let d = withItem('Milk');
    expect(d.items).toHaveLength(1);
    d = updateItem(d, 'id-Milk', { quantity: 3, unit: 'L' });
    expect(d.items[0]).toMatchObject({ quantity: 3, unit: 'L', status: 'active' });
    d = deleteItem(d, 'id-Milk');
    expect(d.items).toHaveLength(0);
  });

  it('records a purchase in history and undoes it cleanly', () => {
    let d = addItem(defaultData(), item('Milk', { estimatedPrice: 3.5 }), NOW, 'm');
    d = purchaseItem(d, 'm', NOW);
    expect(d.items[0].status).toBe('purchased');
    expect(d.history).toHaveLength(1);
    expect(d.history[0]).toMatchObject({ name: 'Milk', price: 3.5, recurring: false });
    d = updateItem(d, 'm', { actualPrice: 4 });
    expect(d.history[0].price).toBe(4);
    d = undoPurchase(d, 'm');
    expect(d.items[0].status).toBe('active');
    expect(d.history).toHaveLength(0);
  });
});

describe('deferred purchases', () => {
  it('moves an item to deferred and returns it automatically when due', () => {
    let d = withItem('Detergent');
    d = deferItem(d, 'id-Detergent', '2026-11-21', 'On special next week', NOW);
    expect(d.items[0]).toMatchObject({ status: 'deferred', deferCount: 1 });
    expect(d.items[0].deferral).toMatchObject({ until: '2026-11-21', reason: 'On special next week' });
    expect(d.deferrals).toHaveLength(1);

    const early = processDue(d, at('2026-11-20'));
    expect(early).toBe(d); // nothing changed, same object
    const due = processDue(d, at('2026-11-21', 0));
    expect(due.items[0].status).toBe('active');
    expect(due.items[0].returnedAt).toBeDefined();
    expect(due.notices).toHaveLength(1);
  });

  it('never loses an indefinitely deferred item and counts repeat deferrals', () => {
    let d = withItem('Sunscreen');
    d = deferItem(d, 'id-Sunscreen', null, '', NOW);
    d = processDue(d, at('2030-01-01'));
    expect(d.items[0].status).toBe('deferred');
    d = restoreItem(d, 'id-Sunscreen');
    expect(d.items[0].status).toBe('active');
    d = deferItem(d, 'id-Sunscreen', '2026-12-01', '', NOW);
    expect(d.items[0].deferCount).toBe(2);
    // Changing the date of a deferred item is not another postponement.
    d = deferItem(d, 'id-Sunscreen', '2026-12-05', '', NOW);
    expect(d.items[0].deferCount).toBe(2);
    expect(d.items[0].deferral?.until).toBe('2026-12-05');
    expect(buildInsights(d, toDay(NOW), []).some((i) => i.text.includes('deferred sunscreen twice'))).toBe(true);
  });

  it('keeps a deferred item whose saved deferral data is damaged', () => {
    const d = sanitize({ version: 1, items: [{ id: 'x', name: 'Rice', status: 'deferred', deferral: 'broken' }] });
    expect(d.items[0]).toMatchObject({ status: 'deferred' });
    expect(d.items[0].deferral?.until).toBeNull();
  });
});

describe('recurring purchases', () => {
  const schedule = (d: AppData, nextDue: string, kind: 'weekly' | 'monthly' = 'weekly') =>
    addRecurring(d, { ...item('Dog food'), frequency: { kind }, nextDue }, NOW, undefined, 'r');

  it('advances by each frequency', () => {
    expect(advance('2026-11-18', { kind: 'daily' })).toBe('2026-11-19');
    expect(advance('2026-11-18', { kind: 'fortnightly' })).toBe('2026-12-02');
    expect(advance('2026-11-30', { kind: '3months' })).toBe('2027-02-28');
    expect(advance('2026-11-18', { kind: 'custom', customDays: 10 })).toBe('2026-11-28');
  });

  it('adds a due purchase to the list once, never twice', () => {
    let d = schedule(defaultData(), '2026-11-18');
    d = addRecurringToList(d, 'r', NOW);
    d = addRecurringToList(d, 'r', NOW);
    expect(d.items).toHaveLength(1);
    expect(d.items[0].recurringId).toBe('r');
    // An existing manual entry with the same name is linked rather than duplicated.
    let e = withItem('dog food', schedule(defaultData(), '2026-11-18'));
    e = addRecurringToList(e, 'r', NOW);
    expect(e.items).toHaveLength(1);
    expect(e.items[0].recurringId).toBe('r');
  });

  it('calculates the next date on completion and restores it on undo', () => {
    let d = addRecurringToList(schedule(defaultData(), '2026-11-16'), 'r', NOW);
    const id = d.items[0].id;
    d = purchaseItem(d, id, NOW);
    expect(d.recurring[0]).toMatchObject({ nextDue: '2026-11-25', completedCount: 1 });
    expect(d.history[0].recurring).toBe(true);
    d = undoPurchase(d, id);
    expect(d.recurring[0]).toMatchObject({ nextDue: '2026-11-16', completedCount: 0 });
  });

  it('skips one occurrence without removing the schedule', () => {
    let d = schedule(defaultData(), '2026-11-18');
    d = skipRecurring(d, 'r', NOW);
    expect(d.recurring).toHaveLength(1);
    expect(d.recurring[0]).toMatchObject({ nextDue: '2026-11-25', skippedCount: 1 });
    // A long-overdue schedule lands after today rather than staying overdue.
    expect(skipFrom('2026-10-01', { kind: 'weekly' }, '2026-11-18') > '2026-11-18').toBe(true);
  });

  it('pauses, resumes, auto-adds when asked, and unlinks on removal', () => {
    let d = schedule(updateSettings(defaultData(), { autoAddRecurring: true }), '2026-11-18');
    d = updateRecurring(d, 'r', { paused: true });
    expect(processDue(d, NOW).items).toHaveLength(0);
    d = processDue(updateRecurring(d, 'r', { paused: false }), NOW);
    expect(d.items).toHaveLength(1);
    expect(processDue(d, NOW).items).toHaveLength(1);
    d = deleteRecurring(d, 'r');
    expect(d.recurring).toHaveLength(0);
    expect(d.items[0].recurringId).toBeUndefined();
  });
});

describe('duplicate detection', () => {
  it('matches plurals, case, word order and small typos, but not different products', () => {
    expect(normalizeName('  Bananas! ')).toBe('banana');
    expect(isLikelyDuplicate('Tomatoes', 'tomato')).toBe(true);
    expect(isLikelyDuplicate('Full cream milk', 'milk full cream')).toBe(true);
    expect(isLikelyDuplicate('Dishwasher tablets', 'Dishwaser tablets')).toBe(true);
    expect(isLikelyDuplicate('Rice', 'Mice')).toBe(false);
    expect(isLikelyDuplicate('Milk', 'Oat milk')).toBe(false);
  });

  it('checks active and deferred items but ignores purchased ones', () => {
    let d = withItem('Milk');
    expect(findDuplicates('milk', d.items)).toHaveLength(1);
    d = deferItem(d, 'id-Milk', null, '', NOW);
    expect(findDuplicates('MILK', d.items)).toHaveLength(1);
    d = purchaseItem(restoreItem(d, 'id-Milk'), 'id-Milk', NOW);
    expect(findDuplicates('milk', d.items)).toHaveLength(0);
  });
});

describe('replenishment engine', () => {
  const buyOn = (d: AppData, name: string, days: string[]) =>
    days.reduce((acc, day, i) => {
      const id = `${name}-${day}-${i}`;
      return purchaseItem(addItem(acc, item(name, { quantity: 2, unit: 'L', estimatedPrice: 3 }), at(day), id), id, at(day));
    }, d);

  it('learns the interval and rates urgency, with an explanation', () => {
    const d = buyOn(defaultData(), 'Milk', ['2026-10-21', '2026-10-28', '2026-11-04', '2026-11-11']);
    const [rec] = buildRecommendations(d, '2026-11-18');
    expect(rec).toMatchObject({
      name: 'Milk', usedInterval: 7, nextEstimated: '2026-11-18', level: 'due', predictable: true,
      typicalQuantity: 2, unit: 'L', avgPrice: 3,
    });
    expect(rec.explanation).toContain('7, 7, 7');
    expect(buildRecommendations(d, '2026-11-16')[0].level).toBe('approaching');
    expect(buildRecommendations(d, '2026-11-12')[0].level).toBe('low');
  });

  it('needs two purchases, and respects dismiss, adjust and schedules', () => {
    let d = buyOn(defaultData(), 'Eggs', ['2026-11-01']);
    expect(buildRecommendations(d, '2026-11-18')).toHaveLength(0);
    d = buyOn(d, 'Eggs', ['2026-11-11']);
    expect(buildRecommendations(d, '2026-11-18')[0].usedInterval).toBe(10);

    const adjusted = { ...d, replenishPrefs: { egg: { customIntervalDays: 4 } } };
    expect(buildRecommendations(adjusted, '2026-11-18')[0]).toMatchObject({ adjusted: true, nextEstimated: '2026-11-15', level: 'due' });

    const dismissed = { ...d, replenishPrefs: { egg: { dismissedAtPurchase: '2026-11-11' } } };
    expect(buildRecommendations(dismissed, '2026-11-18')).toHaveLength(0);
    // Buying it again brings the recommendation back.
    expect(buildRecommendations(buyOn(dismissed, 'Eggs', ['2026-11-17']), '2026-11-18')).toHaveLength(1);

    const scheduled = addRecurring(d, { ...item('eggs'), frequency: { kind: 'weekly' }, nextDue: '2026-11-20' }, NOW);
    expect(buildRecommendations(scheduled, '2026-11-18')).toHaveLength(0);
  });
});

describe('data management', () => {
  it('round-trips through export and import', () => {
    let d = loadSample(defaultData(), NOW);
    d = updateSettings(d, { currency: 'NZD', budget: 120 });
    const result = parseImport(exportJson(d));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items).toEqual(d.items);
    expect(result.data.recurring).toEqual(d.recurring);
    expect(result.data.history).toEqual(d.history);
    expect(result.data.settings).toEqual(d.settings);
  });

  it('rejects files that are not Replenish data and repairs bad fields', () => {
    expect(parseImport('not json').ok).toBe(false);
    expect(parseImport('[1,2,3]').ok).toBe(false);
    expect(parseImport('{"hello":"world"}').ok).toBe(false);
    expect(parseImport(JSON.stringify({ version: 99, items: [] })).ok).toBe(false);
    const d = sanitize({
      items: [{ name: 'Rice', quantity: -4, unit: 'buckets', categoryId: 'nope', priority: 'urgent' }, { quantity: 2 }, 'junk'],
      settings: { currency: 'dollars', theme: 'neon', budget: -5 },
      deferralLog: [{ name: 'Rice', at: '2026-11-01T00:00:00.000Z', until: null }],
    });
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({ quantity: 1, unit: 'units', categoryId: 'other', priority: 'normal' });
    expect(d.settings).toMatchObject({ currency: 'AUD', theme: 'system', budget: null });
    expect(d.deferrals).toHaveLength(1); // migrated from the unversioned shape
    expect(d.categories.length).toBeGreaterThanOrEqual(12);
  });

  it('removes demo data without touching user records, and clears everything on request', () => {
    let d = withItem('My own item', loadSample(defaultData(), NOW));
    expect(hasSample(d)).toBe(true);
    d = removeSample(d);
    expect(hasSample(d)).toBe(false);
    expect(d.items.map((i) => i.name)).toEqual(['My own item']);
    expect(d.history).toHaveLength(0);
    expect(clearAll().items).toHaveLength(0);
  });

  it('moves items to Other when a custom category is deleted', () => {
    let d = addCategory(defaultData(), 'Garden');
    const cat = d.categories.find((c) => c.name === 'Garden')!;
    d = addItem(d, item('Mulch', { categoryId: cat.id }), NOW, 'mulch');
    d = deleteCategory(d, cat.id);
    expect(d.items[0].categoryId).toBe('other');
    expect(deleteCategory(d, 'dairy')).toBe(d); // built-in categories cannot be deleted
  });
});
