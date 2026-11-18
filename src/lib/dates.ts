import type { DateFormat } from '../types';

const pad = (n: number) => String(n).padStart(2, '0');
const DAY_MS = 86_400_000;

/** Local calendar day of a Date as YYYY-MM-DD. */
export function toDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today(): string {
  return toDay(new Date());
}

export function isValidDay(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function isValidIso(s: unknown): s is string {
  return typeof s === 'string' && s.length >= 10 && !Number.isNaN(new Date(s).getTime());
}

/** Accepts a day string or an ISO timestamp and returns the local day. */
export function asDay(s: string): string {
  return s.length === 10 ? s : toDay(new Date(s));
}

export function parseDay(s: string): Date {
  const [y, m, d] = asDay(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return toDay(d);
}

/** Adds calendar months, clamping to the last day of shorter months. */
export function addMonths(day: string, n: number): string {
  const d = parseDay(day);
  const dom = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(dom, last));
  return toDay(d);
}

/** Whole days from a to b (positive when b is later). */
export function diffDays(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / DAY_MS);
}

/** The Monday after the given day. */
export function nextMonday(day: string): string {
  const dow = parseDay(day).getDay();
  return addDays(day, (8 - dow) % 7 || 7);
}

/** Monday of the week containing the given day. */
export function startOfWeek(day: string): string {
  const dow = parseDay(day).getDay();
  return addDays(day, -((dow + 6) % 7));
}

export function startOfMonth(day: string): string {
  return `${asDay(day).slice(0, 7)}-01`;
}

export function formatDate(s: string, fmt: DateFormat): string {
  const [y, m, d] = asDay(s).split('-');
  if (fmt === 'MM/DD/YYYY') return `${m}/${d}/${y}`;
  if (fmt === 'YYYY-MM-DD') return `${y}-${m}-${d}`;
  return `${d}/${m}/${y}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Short label such as "18 Nov". */
export function shortDate(s: string): string {
  const d = parseDay(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function monthLabel(s: string): string {
  const d = parseDay(s);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function longDate(s: string): string {
  const d = parseDay(s);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function formatTime(iso: string, time24: boolean): string {
  const d = new Date(iso);
  const mins = pad(d.getMinutes());
  if (time24) return `${pad(d.getHours())}:${mins}`;
  const h = d.getHours() % 12 || 12;
  return `${h}:${mins} ${d.getHours() < 12 ? 'am' : 'pm'}`;
}

/** "today", "tomorrow", "in 5 days", "3 days ago". */
export function relativeDay(day: string, from: string): string {
  const n = diffDays(from, day);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

export function pluralDays(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${r} ${r === 1 ? 'day' : 'days'}`;
}
