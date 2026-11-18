import type { Frequency, FrequencyKind } from '../types';
import { addDays, addMonths } from './dates';

interface FrequencyDef {
  kind: FrequencyKind;
  label: string;
  days?: number;
  months?: number;
}

export const FREQUENCIES: FrequencyDef[] = [
  { kind: 'daily', label: 'Daily', days: 1 },
  { kind: '3days', label: 'Every 3 days', days: 3 },
  { kind: 'weekly', label: 'Weekly', days: 7 },
  { kind: 'fortnightly', label: 'Fortnightly', days: 14 },
  { kind: 'monthly', label: 'Monthly', months: 1 },
  { kind: '2months', label: 'Every 2 months', months: 2 },
  { kind: '3months', label: 'Every 3 months', months: 3 },
  { kind: 'custom', label: 'Custom interval' },
];

function def(f: Frequency): FrequencyDef {
  return FREQUENCIES.find((x) => x.kind === f.kind) ?? FREQUENCIES[2];
}

export function customDays(f: Frequency): number {
  return Math.max(1, Math.round(f.customDays ?? 7));
}

/** One recurrence interval after the given day. */
export function advance(day: string, f: Frequency): string {
  const d = def(f);
  if (d.kind === 'custom') return addDays(day, customDays(f));
  if (d.months) return addMonths(day, d.months);
  return addDays(day, d.days ?? 7);
}

/** Next due date after skipping one occurrence: always lands after today. */
export function skipFrom(nextDue: string, f: Frequency, todayStr: string): string {
  let next = advance(nextDue, f);
  let guard = 0;
  while (next <= todayStr && guard++ < 5000) next = advance(next, f);
  return next;
}

export function frequencyLabel(f: Frequency): string {
  if (f.kind === 'custom') {
    const n = customDays(f);
    return n === 1 ? 'Every day' : `Every ${n} days`;
  }
  return def(f).label;
}

export function approxDays(f: Frequency): number {
  const d = def(f);
  if (d.kind === 'custom') return customDays(f);
  return d.months ? d.months * 30 : (d.days ?? 7);
}

/** Closest preset (or a custom interval) for a learned interval in days. */
export function frequencyFromDays(days: number): Frequency {
  const n = Math.max(1, Math.round(days));
  const exact: Record<number, FrequencyKind> = { 1: 'daily', 3: '3days', 7: 'weekly', 14: 'fortnightly' };
  if (exact[n]) return { kind: exact[n] };
  if (n >= 28 && n <= 31) return { kind: 'monthly' };
  return { kind: 'custom', customDays: n };
}
