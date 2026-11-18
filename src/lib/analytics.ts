import type { AppData, Category, DeferralEvent, PurchaseRecord } from '../types';
import { categoryById } from './categories';
import { addDays, addMonths, asDay, diffDays, monthLabel, shortDate, startOfMonth, startOfWeek } from './dates';
import { buildItemStats } from './replenishment';

export type RangePreset = '7' | '30' | '90' | '365' | 'all' | 'custom';

export interface RangeFilter {
  preset: RangePreset;
  from: string;
  to: string;
  categoryId: string; // 'all' or a category id
}

export const RANGE_LABELS: Record<RangePreset, string> = {
  '7': 'Last 7 days',
  '30': 'Last 30 days',
  '90': 'Last 3 months',
  '365': 'Last 12 months',
  all: 'All time',
  custom: 'Custom dates',
};

export function defaultRange(todayStr: string): RangeFilter {
  return { preset: '90', from: addDays(todayStr, -89), to: todayStr, categoryId: 'all' };
}

/** Resolves a filter to concrete first and last days (null = unbounded). */
export function rangeBounds(f: RangeFilter, todayStr: string): { from: string | null; to: string | null } {
  if (f.preset === 'all') return { from: null, to: null };
  if (f.preset === 'custom') {
    const from = f.from || null;
    const to = f.to || null;
    return from && to && from > to ? { from: to, to: from } : { from, to };
  }
  return { from: addDays(todayStr, -(Number(f.preset) - 1)), to: todayStr };
}

export function filterHistory(history: PurchaseRecord[], f: RangeFilter, todayStr: string): PurchaseRecord[] {
  const { from, to } = rangeBounds(f, todayStr);
  return history.filter((r) => {
    const day = asDay(r.purchasedAt);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return f.categoryId === 'all' || r.categoryId === f.categoryId;
  });
}

export function filterDeferrals(events: DeferralEvent[], f: RangeFilter, todayStr: string): DeferralEvent[] {
  const { from, to } = rangeBounds(f, todayStr);
  return events.filter((e) => {
    const day = asDay(e.at);
    return (!from || day >= from) && (!to || day <= to) && (f.categoryId === 'all' || e.categoryId === f.categoryId);
  });
}

export interface Bucket {
  label: string;
  detail: string;
  value: number;
}

function buckets(
  records: PurchaseRecord[],
  first: string,
  last: string,
  step: (day: string) => string,
  floor: (day: string) => string,
  label: (start: string) => { label: string; detail: string },
  max: number,
): Bucket[] {
  const totals = new Map<string, number>();
  for (const r of records) {
    const k = floor(asDay(r.purchasedAt));
    totals.set(k, (totals.get(k) ?? 0) + (r.price ?? 0));
  }
  const out: Bucket[] = [];
  for (let s = floor(first); s <= last; s = step(s)) {
    out.push({ ...label(s), value: totals.get(s) ?? 0 });
  }
  return out.slice(-max);
}

function span(records: PurchaseRecord[], f: RangeFilter, todayStr: string): { first: string; last: string } | null {
  const { from, to } = rangeBounds(f, todayStr);
  const days = records.map((r) => asDay(r.purchasedAt)).sort();
  const first = from ?? days[0];
  const last = to ?? todayStr;
  return first ? { first, last } : null;
}

export function weeklySpend(records: PurchaseRecord[], f: RangeFilter, todayStr: string): Bucket[] {
  const s = span(records, f, todayStr);
  if (!s) return [];
  return buckets(
    records, s.first, s.last,
    (d) => addDays(d, 7),
    startOfWeek,
    (start) => ({ label: shortDate(start), detail: `Week of ${shortDate(start)}` }),
    12,
  );
}

export function monthlySpend(records: PurchaseRecord[], f: RangeFilter, todayStr: string): Bucket[] {
  const s = span(records, f, todayStr);
  if (!s) return [];
  return buckets(
    records, s.first, s.last,
    (d) => addMonths(d, 1),
    startOfMonth,
    (start) => ({ label: monthLabel(start).slice(0, 3), detail: monthLabel(start) }),
    12,
  );
}

export function categorySpend(records: PurchaseRecord[], categories: Category[]): Bucket[] {
  const totals = new Map<string, number>();
  for (const r of records) totals.set(r.categoryId, (totals.get(r.categoryId) ?? 0) + (r.price ?? 0));
  return [...totals]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([cid, value]) => {
      const name = categoryById(categories, cid).name;
      return { label: name, detail: name, value };
    });
}

export function topItems(records: PurchaseRecord[], limit = 8): Bucket[] {
  return buildItemStats(records)
    .slice(0, limit)
    .map((s) => ({ label: s.name, detail: s.name, value: s.count }));
}

export interface Summary {
  totalPurchases: number;
  totalSpent: number;
  unpriced: number;
  thisWeek: number;
  thisMonth: number;
  perWeek: number;
  /** Average days between repeat purchases of the same product. */
  avgRepeatGap: number | null;
  shoppingDays: number;
}

export function summarize(records: PurchaseRecord[], all: PurchaseRecord[], f: RangeFilter, todayStr: string): Summary {
  const totalSpent = records.reduce((s, r) => s + (r.price ?? 0), 0);
  const weekStart = startOfWeek(todayStr);
  const monthStart = startOfMonth(todayStr);
  const inCat = all.filter((r) => f.categoryId === 'all' || r.categoryId === f.categoryId);
  const sumFrom = (start: string) =>
    inCat.filter((r) => asDay(r.purchasedAt) >= start).reduce((s, r) => s + (r.price ?? 0), 0);
  const s = span(records, f, todayStr);
  const weeks = s ? Math.max(1, (diffDays(s.first, s.last) + 1) / 7) : 1;
  const gaps = buildItemStats(records).flatMap((x) => x.intervals);
  return {
    totalPurchases: records.length,
    totalSpent,
    unpriced: records.filter((r) => r.price === undefined).length,
    thisWeek: sumFrom(weekStart),
    thisMonth: sumFrom(monthStart),
    perWeek: records.length / weeks,
    avgRepeatGap: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
    shoppingDays: new Set(records.map((r) => asDay(r.purchasedAt))).size,
  };
}

/** Estimated cost of the current list: what is left, and what is already in the basket. */
export function listTotals(data: AppData): { remaining: number; purchased: number; total: number; unpriced: number } {
  let remaining = 0;
  let purchased = 0;
  let unpriced = 0;
  for (const i of data.items) {
    if (i.status === 'active') {
      if (i.estimatedPrice === undefined) unpriced += 1;
      remaining += i.estimatedPrice ?? 0;
    } else if (i.status === 'purchased') {
      purchased += i.actualPrice ?? i.estimatedPrice ?? 0;
    }
  }
  return { remaining, purchased, total: remaining + purchased, unpriced };
}
