import type { Unit } from '../types';

export const CURRENCIES = ['AUD', 'NZD', 'USD', 'CAD', 'GBP', 'EUR', 'SGD', 'JPY', 'INR', 'ZAR'];

export function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function formatQty(quantity: number, unit: Unit): string {
  const q = Number(quantity.toFixed(2));
  if (unit === 'units') return `× ${q}`;
  if (q === 1 && (unit === 'packs' || unit === 'bottles')) return `1 ${unit.slice(0, -1)}`;
  return `${q} ${unit}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function times(n: number): string {
  if (n === 1) return 'once';
  if (n === 2) return 'twice';
  return `${n} times`;
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Parses a user-typed number; returns undefined when empty, NaN when invalid. */
export function parseNumber(text: string): number | undefined {
  const t = text.trim().replace(',', '.');
  if (t === '') return undefined;
  return /^\d*\.?\d+$|^\d+\.$/.test(t) ? Number(t) : Number.NaN;
}
