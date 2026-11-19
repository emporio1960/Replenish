import { describe, expect, it } from 'vitest';
import type { AppData } from '../types';
import { budgetStatus } from '../lib/analytics';
import { storeCategoryOrder } from '../lib/categories';
import { parseLine, parseList } from '../lib/parseList';
import { buildItemStats, buildRecommendations, priceFlag } from '../lib/replenishment';
import { buildAlerts } from '../lib/insights';
import { defaultData, exportJson, parseImport, sanitize } from '../lib/storage';
import {
  addItem, addParsed, addStore, deleteStore, learnBarcode, loadSample, moveAisle, purchaseItem,
  removeSample, saveRecipe, setReplenishPref, updateSettings,
} from '../state/actions';

const at = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 10);
};
const NOW = at('2026-11-18');

function buy(d: AppData, name: string, day: string, price: number, quantity = 2, categoryId = 'dairy'): AppData {
  const id = `${name}-${day}`;
  const next = addItem(d, { name, quantity, unit: 'L', estimatedPrice: price, categoryId, priority: 'normal' }, at(day), id);
  return purchaseItem(next, id, at(day));
}
const milk = (prices: number[]) =>
  ['2026-10-21', '2026-10-28', '2026-11-04', '2026-11-11'].reduce((d, day, i) => buy(d, 'Milk', day, prices[i]), defaultData());

describe('list parsing', () => {
  it('reads quantities and units in the common ways people type them', () => {
    expect(parseLine('2 kg tomatoes')).toEqual({ name: 'Tomatoes', quantity: 2, unit: 'kg' });
    expect(parseLine('500g beef mince')).toEqual({ name: 'Beef mince', quantity: 500, unit: 'g' });
    expect(parseLine('milk 2L')).toEqual({ name: 'Milk', quantity: 2, unit: 'L' });
    expect(parseLine('eggs x12')).toEqual({ name: 'Eggs', quantity: 12, unit: 'units' });
    expect(parseLine('- [ ] 3 lemons')).toEqual({ name: 'Lemons', quantity: 3, unit: 'units' });
    expect(parseLine('1.5 litres of orange juice')).toEqual({ name: 'Orange juice', quantity: 1.5, unit: 'L' });
    expect(parseLine('bread')).toEqual({ name: 'Bread', quantity: 1, unit: 'units' });
    expect(parseLine('7up')).toEqual({ name: '7up', quantity: 1, unit: 'units' });
    expect(parseLine('   ')).toBeNull();
    expect(parseList('milk 2L\n\nbread; 2 packs pasta')).toHaveLength(3);
  });

  it('adds many at once, skipping duplicates and reusing known details', () => {
    let d = milk([3, 3, 3, 3]);
    d = addItem(d, { name: 'Bread', quantity: 1, unit: 'units', categoryId: 'bakery', priority: 'normal' }, NOW);
    const before = d.items.length;
    d = addParsed(d, parseList('milk 4L\nbreads\nlemons\nLemon'), NOW);
    const added = d.items.slice(before);
    expect(added.map((i) => i.name)).toEqual(['Milk', 'Lemons']);
    // Known product: category and a price scaled from the usual price per litre.
    expect(added[0]).toMatchObject({ categoryId: 'dairy', estimatedPrice: 6, quantity: 4, unit: 'L' });
    expect(added[1].categoryId).toBe('produce'); // unknown to history, recognised by the classifier
  });
});

describe('stock on hand', () => {
  it('uses a recorded quantity instead of dates until the next purchase', () => {
    let d = milk([3, 3, 3, 3]); // 2 L every 7 days, last bought 11 Nov
    expect(buildRecommendations(d, '2026-11-18')[0]).toMatchObject({ level: 'due', stock: undefined });
    d = setReplenishPref(d, 'milk', { stock: { quantity: 3, unit: 'L', day: '2026-11-18' } });
    const rec = buildRecommendations(d, '2026-11-18')[0];
    // 2 L per 7 days is about 0.29 L a day, so 3 L lasts 10 days.
    expect(rec).toMatchObject({ nextEstimated: '2026-11-28', level: 'low' });
    expect(rec.stock?.remaining).toBeCloseTo(3);
    expect(rec.explanation).toContain('You recorded 3 L at home');
    expect(buildRecommendations(d, '2026-11-25')[0].stock?.remaining).toBeCloseTo(1);
    // A later purchase makes the old count stale: back to purchase dates.
    d = buy(d, 'Milk', '2026-11-20', 3);
    expect(buildRecommendations(d, '2026-11-21')[0]).toMatchObject({ nextEstimated: '2026-11-28', stock: undefined });
  });
});

describe('price tracking', () => {
  it('finds the usual unit price and flags purchases well above or below it', () => {
    const stats = buildItemStats(milk([3, 3.1, 2.9, 3]).history)[0];
    expect(stats.usualUnitPrice).toBeCloseTo(1.5);
    expect(priceFlag(4, 2, 'L', stats)).toBe('above');
    expect(priceFlag(2.4, 2, 'L', stats)).toBe('below');
    expect(priceFlag(3.2, 2, 'L', stats)).toBeNull();
    expect(priceFlag(6.1, 4, 'L', stats)).toBeNull(); // twice the quantity at the usual rate
    expect(priceFlag(4, 2, 'kg', stats)).toBeNull(); // different unit: not comparable
    expect(priceFlag(undefined, 2, 'L', stats)).toBeNull();
  });
});

describe('spending budgets', () => {
  it('compares this week or month with the limits, and alerts when over', () => {
    let d = milk([3, 3, 3, 3]);
    d = buy(d, 'Milk', '2026-11-17', 12);
    d = buy(d, 'Steak', '2026-11-18', 30, 1, 'meat');
    d = updateSettings(d, { spendingBudget: { period: 'week', total: 40, byCategory: { dairy: 20, meat: 25 } } });
    const week = budgetStatus(d, '2026-11-18');
    expect(week.start).toBe('2026-11-16');
    expect(week.lines).toEqual([
      { id: 'total', label: 'All spending', spent: 42, budget: 40 },
      { id: 'meat', label: 'Meat and seafood', spent: 30, budget: 25 },
      { id: 'dairy', label: 'Dairy and eggs', spent: 12, budget: 20 },
    ]);
    const ids = buildAlerts(d, '2026-11-18', []).map((a) => a.id);
    expect(ids).toContain('spend-total');
    expect(ids).toContain('spend-meat');
    expect(ids).not.toContain('spend-dairy');
    const month = budgetStatus(updateSettings(d, { spendingBudget: { period: 'month', total: 100, byCategory: {} } }), '2026-11-18');
    expect(month.lines[0].spent).toBe(48); // 4 Nov + 11 Nov + this week
  });
});

describe('stores, meals and barcodes', () => {
  it('orders aisles per store and releases items when a store is deleted', () => {
    let d = addStore(defaultData(), 'Supermarket');
    const store = d.stores[0];
    expect(storeCategoryOrder(store, d.categories)[0].id).toBe('produce');
    d = moveAisle(d, store.id, 'bakery', -1);
    d = moveAisle(d, store.id, 'bakery', -1);
    d = moveAisle(d, store.id, 'bakery', -1);
    expect(storeCategoryOrder(d.stores[0], d.categories).slice(0, 2).map((c) => c.id)).toEqual(['bakery', 'produce']);
    expect(moveAisle(d, store.id, 'bakery', -1)).toBe(d); // already first
    d = addItem(d, { name: 'Bread', quantity: 1, unit: 'units', categoryId: 'bakery', priority: 'normal', storeId: store.id }, NOW);
    d = deleteStore(updateSettings(d, { shoppingStoreId: store.id }), store.id);
    expect(d.items[0].storeId).toBeUndefined();
    expect(d.settings.shoppingStoreId).toBeNull();
  });

  it('adds a meal\'s ingredients once and remembers barcodes', () => {
    let d = saveRecipe(defaultData(), {
      id: 'm1', name: 'Curry',
      ingredients: [{ name: 'Chicken thighs', quantity: 1, unit: 'kg' }, { name: 'Rice', quantity: 1, unit: 'kg' }],
    });
    d = addParsed(d, d.recipes[0].ingredients, NOW);
    d = addParsed(d, d.recipes[0].ingredients, NOW);
    expect(d.items.map((i) => i.name)).toEqual(['Chicken thighs', 'Rice']);
    d = learnBarcode(d, '9300633000011', 'Rice');
    expect(d.barcodes['9300633000011']).toBe('Rice');
  });

  it('keeps the new data through export, import, upgrade and demo removal', () => {
    let d = loadSample(defaultData(), NOW);
    d = learnBarcode(d, '9300633000011', 'Rice');
    d = setReplenishPref(d, 'milk', { stock: { quantity: 1, unit: 'L', day: '2026-11-18' } });
    d = updateSettings(d, { spendingBudget: { period: 'month', total: 500, byCategory: { meat: 120 } }, barcodeLookup: true });
    const back = parseImport(exportJson(d));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.data.stores).toEqual(d.stores);
    expect(back.data.recipes).toEqual(d.recipes);
    expect(back.data.barcodes).toEqual(d.barcodes);
    expect(back.data.replenishPrefs).toEqual(d.replenishPrefs);
    expect(back.data.settings).toEqual(d.settings);
    expect(back.data.items.find((i) => i.name === 'Sunscreen')?.storeId).toBe('sample-s-chemist');

    // A version 1 backup (before these features) loads with sensible defaults.
    const v1 = sanitize({ version: 1, items: [{ name: 'Rice' }], settings: { currency: 'AUD' } });
    expect(v1).toMatchObject({ version: 3, stores: [], recipes: [], barcodes: {} });
    expect(v1.settings.spendingBudget).toEqual({ period: 'week', total: null, byCategory: {} });

    const cleaned = removeSample(d);
    expect(cleaned.stores).toHaveLength(0);
    expect(cleaned.recipes).toHaveLength(0);
    expect(cleaned.barcodes).toEqual(d.barcodes);
  });
});
