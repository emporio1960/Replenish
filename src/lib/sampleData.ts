import type { DeferralEvent, PurchaseRecord, Recipe, RecurringPurchase, ShoppingItem, Store, Unit } from '../types';
import { addDays, parseDay } from './dates';
import { normalizeName } from './duplicates';

/**
 * Optional demonstration data. Every record is flagged `sample: true` so it
 * can be removed in one step without touching anything the user created.
 * Dates are generated relative to today so the demo always looks current.
 */

interface Product {
  name: string;
  quantity: number;
  unit: Unit;
  price: number;
  categoryId: string;
  /** Typical days between purchases and the day offsets used to vary them. */
  every: number;
  jitter: number[];
  /** Days since the most recent purchase. */
  last: number;
}

const PRODUCTS: Product[] = [
  { name: 'Milk', quantity: 2, unit: 'L', price: 3.6, categoryId: 'dairy', every: 7, jitter: [0, 1, -1, 0, 1], last: 7 },
  { name: 'Sourdough loaf', quantity: 1, unit: 'units', price: 6.5, categoryId: 'bakery', every: 5, jitter: [0, 1, 0, -1], last: 4 },
  { name: 'Free range eggs', quantity: 12, unit: 'units', price: 7.2, categoryId: 'dairy', every: 10, jitter: [0, 2, -1, 1], last: 11 },
  { name: 'Bananas', quantity: 1, unit: 'kg', price: 4.5, categoryId: 'produce', every: 7, jitter: [0, 0, 1, -1], last: 3 },
  { name: 'Coffee beans', quantity: 500, unit: 'g', price: 18, categoryId: 'beverages', every: 21, jitter: [0, 2, -2], last: 19 },
  { name: 'Chicken thighs', quantity: 1, unit: 'kg', price: 13.5, categoryId: 'meat', every: 7, jitter: [0, 3, -2, 4, 0], last: 5 },
  { name: 'Dog food', quantity: 1, unit: 'packs', price: 42, categoryId: 'pet', every: 28, jitter: [0, 1], last: 26 },
  { name: 'Toilet paper', quantity: 1, unit: 'packs', price: 11, categoryId: 'household', every: 30, jitter: [0, -3], last: 12 },
  { name: 'Olive oil', quantity: 750, unit: 'ml', price: 14, categoryId: 'pantry', every: 45, jitter: [0], last: 40 },
  { name: 'Frozen peas', quantity: 1, unit: 'packs', price: 3.2, categoryId: 'frozen', every: 20, jitter: [0, 6, -5], last: 9 },
];

const HISTORY_DAYS = 84;

function at(day: string, hour: number, minute: number): string {
  const d = parseDay(day);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export function buildSampleData(todayStr: string): {
  items: ShoppingItem[];
  recurring: RecurringPurchase[];
  history: PurchaseRecord[];
  deferrals: DeferralEvent[];
  stores: Store[];
  recipes: Recipe[];
} {
  const history: PurchaseRecord[] = [];
  PRODUCTS.forEach((p, pi) => {
    let ago = p.last;
    let n = 0;
    while (ago <= HISTORY_DAYS) {
      const recurring = p.name === 'Dog food' || p.name === 'Coffee beans';
      history.push({
        id: `sample-h-${pi}-${n}`,
        name: p.name,
        key: normalizeName(p.name),
        quantity: p.quantity,
        unit: p.unit,
        // Small, repeatable price movement so averages are not all identical.
        price: Math.round(p.price * (1 + ((n % 3) - 1) * 0.04) * 100) / 100,
        categoryId: p.categoryId,
        purchasedAt: at(addDays(todayStr, -ago), 10 + (pi % 8), (pi * 7 + n * 13) % 60),
        recurring,
        recurringId: recurring ? `sample-r-${normalizeName(p.name).replace(/\s/g, '-')}` : undefined,
        sample: true,
      });
      ago += p.every + p.jitter[n % p.jitter.length];
      n += 1;
    }
  });

  const created = (daysAgo: number) => at(addDays(todayStr, -daysAgo), 18, 30);
  const base = { priority: 'normal' as const, deferCount: 0, sample: true as const };

  const items: ShoppingItem[] = [
    { ...base, id: 'sample-i-1', name: 'Tomatoes', quantity: 500, unit: 'g', estimatedPrice: 4, categoryId: 'produce', status: 'active', createdAt: created(1) },
    { ...base, id: 'sample-i-2', name: 'Greek yoghurt', quantity: 1, unit: 'kg', estimatedPrice: 6.5, categoryId: 'dairy', status: 'active', createdAt: created(1), priority: 'high' },
    { ...base, id: 'sample-i-3', name: 'Pasta', quantity: 2, unit: 'packs', estimatedPrice: 3.6, categoryId: 'pantry', status: 'active', createdAt: created(2), notes: 'Any short shape' },
    { ...base, id: 'sample-i-4', name: 'Dishwashing liquid', quantity: 1, unit: 'bottles', estimatedPrice: 4.2, categoryId: 'cleaning', status: 'active', createdAt: created(2) },
    { ...base, id: 'sample-i-5', name: 'Sparkling water', quantity: 6, unit: 'bottles', estimatedPrice: 7.5, categoryId: 'beverages', status: 'active', createdAt: created(0), priority: 'low' },
    {
      ...base, id: 'sample-i-6', name: 'Washing detergent', quantity: 2, unit: 'L', estimatedPrice: 16, categoryId: 'cleaning',
      status: 'deferred', createdAt: created(12), deferCount: 2,
      deferral: { deferredAt: created(2), until: addDays(todayStr, 4), reason: 'Waiting for the half-price special' },
    },
    {
      ...base, id: 'sample-i-7', name: 'Sunscreen', quantity: 1, unit: 'bottles', estimatedPrice: 14, categoryId: 'health',
      status: 'deferred', createdAt: created(6), deferCount: 1,
      deferral: { deferredAt: created(3), until: null, reason: 'Still some left in the car' },
    },
  ];

  const deferrals: DeferralEvent[] = [
    { id: 'sample-d-1', itemId: 'sample-i-6', name: 'Washing detergent', key: normalizeName('Washing detergent'), categoryId: 'cleaning', at: created(9), until: addDays(todayStr, -2), sample: true },
    { id: 'sample-d-2', itemId: 'sample-i-6', name: 'Washing detergent', key: normalizeName('Washing detergent'), categoryId: 'cleaning', at: created(2), until: addDays(todayStr, 4), sample: true },
    { id: 'sample-d-3', itemId: 'sample-i-7', name: 'Sunscreen', key: normalizeName('Sunscreen'), categoryId: 'health', at: created(3), until: null, sample: true },
  ];

  const schedule = (
    name: string, quantity: number, unit: Unit, price: number, categoryId: string,
    frequency: RecurringPurchase['frequency'], dueIn: number, done: number, extra: Partial<RecurringPurchase> = {},
  ): RecurringPurchase => ({
    id: `sample-r-${normalizeName(name).replace(/\s/g, '-')}`,
    name, quantity, unit, estimatedPrice: price, categoryId, frequency,
    nextDue: addDays(todayStr, dueIn),
    paused: false,
    createdAt: created(HISTORY_DAYS),
    skippedCount: 0,
    completedCount: done,
    sample: true,
    ...extra,
  });

  const recurring: RecurringPurchase[] = [
    schedule('Dog food', 1, 'packs', 42, 'pet', { kind: 'custom', customDays: 28 }, 1, 3, { reminderDate: todayStr }),
    schedule('Coffee beans', 500, 'g', 18, 'beverages', { kind: 'custom', customDays: 21 }, 2, 4),
    schedule('Dishwasher tablets', 1, 'packs', 19, 'cleaning', { kind: 'monthly' }, 0, 2),
    schedule('Vitamin D', 1, 'bottles', 12, 'health', { kind: '3months' }, 34, 1),
    schedule('Cat litter', 1, 'packs', 15, 'pet', { kind: 'fortnightly' }, 9, 0, { paused: true, notes: 'Paused while the cat is at the neighbours' }),
  ];

  const stores: Store[] = [
    {
      id: 'sample-s-market', name: 'Supermarket', sample: true,
      aisleOrder: ['produce', 'bakery', 'meat', 'dairy', 'pantry', 'beverages', 'frozen', 'cleaning', 'household', 'personal', 'health', 'pet', 'other'],
    },
    { id: 'sample-s-chemist', name: 'Chemist', sample: true, aisleOrder: ['health', 'personal'] },
  ];
  items[6].storeId = 'sample-s-chemist';

  const recipes: Recipe[] = [
    {
      id: 'sample-m-bolognese', name: 'Spaghetti bolognese', sample: true,
      ingredients: [
        { name: 'Beef mince', quantity: 500, unit: 'g' },
        { name: 'Pasta', quantity: 1, unit: 'packs' },
        { name: 'Tinned tomatoes', quantity: 2, unit: 'units' },
        { name: 'Brown onion', quantity: 1, unit: 'units' },
        { name: 'Garlic', quantity: 1, unit: 'units' },
      ],
    },
    {
      id: 'sample-m-curry', name: 'Chicken curry', sample: true,
      ingredients: [
        { name: 'Chicken thighs', quantity: 1, unit: 'kg' },
        { name: 'Coconut milk', quantity: 1, unit: 'units' },
        { name: 'Curry paste', quantity: 1, unit: 'units' },
        { name: 'Basmati rice', quantity: 1, unit: 'kg' },
      ],
    },
  ];

  return { items, recurring, history, deferrals, stores, recipes };
}
