import type { AppData, PurchaseRecord, Unit } from '../types';
import { addDays, asDay, diffDays, pluralDays, shortDate } from './dates';
import { normalizeName } from './duplicates';
import { plural } from './format';

/** Everything learned about one product from purchase history. */
export interface ItemStats {
  key: string;
  name: string;
  count: number;
  /** Distinct purchase days, oldest first. */
  days: string[];
  /** Gaps in days between consecutive purchase days. */
  intervals: number[];
  avgInterval: number | null;
  /** Coefficient of variation of the gaps: lower means a steadier cycle. */
  variation: number | null;
  predictable: boolean;
  typicalQuantity: number;
  unit: Unit;
  avgPrice?: number;
  totalSpent: number;
  categoryId: string;
  lastPurchased: string;
  /** Priced purchases in the product's usual unit, oldest first. */
  prices: PricePoint[];
  /** Median price per unit of quantity across those purchases. */
  usualUnitPrice?: number;
}

export interface PricePoint {
  day: string;
  price: number;
  quantity: number;
  unitPrice: number;
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export type PriceFlag = 'above' | 'below' | null;

/** Compares a price with what the product usually costs per unit (15% either way). */
export function priceFlag(
  price: number | undefined, quantity: number, unit: Unit, stats: ItemStats | undefined,
): PriceFlag {
  if (price === undefined || !stats || stats.usualUnitPrice === undefined) return null;
  if (stats.prices.length < 3 || unit !== stats.unit || quantity <= 0 || stats.usualUnitPrice <= 0) return null;
  const ratio = price / quantity / stats.usualUnitPrice;
  return ratio >= 1.15 ? 'above' : ratio <= 0.85 ? 'below' : null;
}

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  let best = values[values.length - 1];
  let bestCount = 0;
  for (const v of values) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c >= bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

export function buildItemStats(history: PurchaseRecord[]): ItemStats[] {
  const groups = new Map<string, PurchaseRecord[]>();
  for (const r of history) {
    const list = groups.get(r.key);
    if (list) list.push(r);
    else groups.set(r.key, [r]);
  }
  const stats: ItemStats[] = [];
  for (const [key, records] of groups) {
    records.sort((a, b) => a.purchasedAt.localeCompare(b.purchasedAt));
    const days = [...new Set(records.map((r) => asDay(r.purchasedAt)))].sort();
    const intervals = days.slice(1).map((d, i) => diffDays(days[i], d));
    const avg = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null;
    let variation: number | null = null;
    if (avg && intervals.length >= 2) {
      const variance = intervals.reduce((s, x) => s + (x - avg) ** 2, 0) / intervals.length;
      variation = Math.sqrt(variance) / avg;
    }
    const latest = records[records.length - 1];
    const priced = records.filter((r) => r.price !== undefined);
    const totalSpent = priced.reduce((s, r) => s + (r.price ?? 0), 0);
    const prices: PricePoint[] = priced
      .filter((r) => r.unit === latest.unit && r.quantity > 0)
      .map((r) => ({ day: asDay(r.purchasedAt), price: r.price!, quantity: r.quantity, unitPrice: r.price! / r.quantity }));
    stats.push({
      key,
      name: latest.name,
      count: records.length,
      days,
      intervals,
      avgInterval: avg,
      variation,
      predictable: variation !== null && intervals.length >= 3 && variation <= 0.35,
      typicalQuantity: mode(records.filter((r) => r.unit === latest.unit).map((r) => r.quantity)),
      unit: latest.unit,
      avgPrice: priced.length ? totalSpent / priced.length : undefined,
      totalSpent,
      categoryId: latest.categoryId,
      lastPurchased: days[days.length - 1],
      prices,
      usualUnitPrice: prices.length ? median(prices.map((x) => x.unitPrice)) : undefined,
    });
  }
  return stats.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export type ReplenishLevel = 'due' | 'approaching' | 'low';

export interface Recommendation extends ItemStats {
  /** Interval used for the estimate (learned average, or the user's adjustment). */
  usedInterval: number;
  adjusted: boolean;
  nextEstimated: string;
  daysUntil: number;
  level: ReplenishLevel;
  onList: boolean;
  /** Set when the estimate uses a quantity the user recorded as being at home. */
  stock?: { quantity: number; day: string; remaining: number; perDay: number };
  /** Plain-language account of how the estimate was made. */
  explanation: string;
}

export const LEVEL_LABEL: Record<ReplenishLevel, string> = {
  due: 'Due now',
  approaching: 'Approaching replenishment',
  low: 'Low priority',
};

/**
 * Estimates when products bought at least twice might need replenishing.
 * The estimate is only "last purchase + typical gap": it says nothing about
 * what is actually in the cupboard.
 */
export function buildRecommendations(data: AppData, todayStr: string): Recommendation[] {
  const scheduled = new Set(data.recurring.map((r) => normalizeName(r.name)));
  const onList = new Set(
    data.items.filter((i) => i.status !== 'purchased').map((i) => normalizeName(i.name)),
  );
  const out: Recommendation[] = [];
  for (const s of buildItemStats(data.history)) {
    if (s.avgInterval === null || s.avgInterval < 1) continue;
    // Products with a recurring schedule are handled by that schedule.
    if (scheduled.has(s.key)) continue;
    const pref = data.replenishPrefs[s.key];
    if (pref?.dismissedAtPurchase === s.lastPurchased) continue;
    const adjusted = pref?.customIntervalDays !== undefined;
    const usedInterval = adjusted ? pref!.customIntervalDays! : Math.max(1, Math.round(s.avgInterval));
    let nextEstimated = addDays(s.lastPurchased, usedInterval);
    // A stock count recorded since the last purchase beats a date-only guess.
    const counted =
      pref?.stock && pref.stock.unit === s.unit && pref.stock.day >= s.lastPurchased && s.typicalQuantity > 0
        ? pref.stock
        : undefined;
    let stock: Recommendation['stock'];
    if (counted) {
      const perDay = s.typicalQuantity / usedInterval;
      nextEstimated = addDays(counted.day, Math.floor(counted.quantity / perDay));
      stock = {
        quantity: counted.quantity,
        day: counted.day,
        perDay,
        remaining: Math.max(0, counted.quantity - perDay * Math.max(0, diffDays(counted.day, todayStr))),
      };
    }
    const daysUntil = diffDays(todayStr, nextEstimated);
    const window = Math.max(2, Math.round(usedInterval * 0.25));
    const level: ReplenishLevel = daysUntil <= 0 ? 'due' : daysUntil <= window ? 'approaching' : 'low';

    const gaps = s.intervals.slice(-6).join(', ');
    const basis =
      s.intervals.length === 1
        ? `Bought twice, ${pluralDays(s.intervals[0])} apart, so this is a rough estimate.`
        : `Bought ${s.count} times on ${plural(s.days.length, 'day')}. Recent gaps between purchases: ${gaps} days (average ${pluralDays(s.avgInterval)}).`;
    const used = adjusted
      ? ` You set the interval to ${pluralDays(usedInterval)}.`
      : '';
    const round = (n: number) => Number(n.toFixed(2));
    const explanation = stock
      ? `${basis}${used} You recorded ${round(stock.quantity)} ${s.unit} at home on ${shortDate(stock.day)}. Using your usual ${round(s.typicalQuantity)} ${s.unit} every ${pluralDays(usedInterval)} (about ${round(stock.perDay)} ${s.unit} a day), that lasts until around ${shortDate(nextEstimated)}.`
      : `${basis}${used} Last bought ${shortDate(s.lastPurchased)}, so the next purchase is estimated for ${shortDate(nextEstimated)}.`;

    out.push({
      ...s,
      usedInterval,
      adjusted,
      nextEstimated,
      daysUntil,
      level,
      onList: onList.has(s.key),
      stock,
      explanation,
    });
  }
  return out.sort((a, b) => a.daysUntil - b.daysUntil);
}

/** Recommendations the user still needs to act on. */
export function actionable(recs: Recommendation[]): Recommendation[] {
  return recs.filter((r) => !r.onList && r.level !== 'low');
}
