import type { AppData, RecurringPurchase, ViewId } from '../types';
import { listTotals } from './analytics';
import { addDays, diffDays, pluralDays, relativeDay } from './dates';
import { formatMoney, plural, times } from './format';
import { frequencyLabel } from './recurrence';
import { actionable, type Recommendation } from './replenishment';

export type Tone = 'neutral' | 'good' | 'warn' | 'alert';

export interface Insight {
  id: string;
  icon: 'replenish' | 'pattern' | 'deferred' | 'recurring' | 'budget' | 'progress' | 'return';
  text: string;
  tone: Tone;
  view: ViewId;
}

export function dueRecurring(data: AppData, todayStr: string): RecurringPurchase[] {
  return data.recurring
    .filter((r) => !r.paused && r.nextDue <= todayStr)
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue));
}

export function upcomingRecurring(data: AppData, todayStr: string, withinDays = 7): RecurringPurchase[] {
  const limit = addDays(todayStr, withinDays);
  return data.recurring
    .filter((r) => !r.paused && r.nextDue <= limit)
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue));
}

/** Observations for the dashboard, built only from the user's own data. */
export function buildInsights(data: AppData, todayStr: string, recs: Recommendation[]): Insight[] {
  const out: Insight[] = [];
  const { currency, budget } = data.settings;
  const active = data.items.filter((i) => i.status === 'active');
  const purchased = data.items.filter((i) => i.status === 'purchased');
  const deferred = data.items.filter((i) => i.status === 'deferred');

  const need = actionable(recs);
  if (need.length) {
    out.push({
      id: 'replenish',
      icon: 'replenish',
      tone: need.some((r) => r.level === 'due') ? 'warn' : 'neutral',
      view: 'suggestions',
      text: `You have ${plural(need.length, 'item')} that may need replenishing soon.`,
    });
  }

  const steady = recs.filter((r) => r.predictable).sort((a, b) => b.count - a.count)[0]
    ?? recs.filter((r) => r.intervals.length >= 2).sort((a, b) => b.count - a.count)[0];
  if (steady) {
    out.push({
      id: 'pattern',
      icon: 'pattern',
      tone: 'neutral',
      view: 'suggestions',
      text: `${steady.name} is usually purchased every ${pluralDays(steady.usedInterval)}.`,
    });
  }

  const postponed = [...deferred, ...active]
    .filter((i) => i.deferCount >= 2)
    .sort((a, b) => b.deferCount - a.deferCount)[0];
  if (postponed) {
    out.push({
      id: 'deferred',
      icon: 'deferred',
      tone: 'warn',
      view: postponed.status === 'deferred' ? 'deferred' : 'list',
      text: `You have deferred ${postponed.name.toLowerCase()} ${times(postponed.deferCount)}.`,
    });
  }

  const next = data.recurring.filter((r) => !r.paused).sort((a, b) => a.nextDue.localeCompare(b.nextDue))[0];
  if (next) {
    const overdue = diffDays(next.nextDue, todayStr);
    out.push({
      id: 'recurring',
      icon: 'recurring',
      tone: overdue >= 0 ? 'warn' : 'neutral',
      view: 'recurring',
      text:
        overdue > 0
          ? `${next.name} (${frequencyLabel(next.frequency).toLowerCase()}) was due ${relativeDay(next.nextDue, todayStr)}.`
          : `Your next recurring purchase, ${next.name.toLowerCase()}, is due ${relativeDay(next.nextDue, todayStr)}.`,
    });
  }

  const returning = deferred
    .filter((i) => i.deferral?.until && diffDays(todayStr, i.deferral.until) <= 3)
    .sort((a, b) => (a.deferral!.until! < b.deferral!.until! ? -1 : 1))[0];
  if (returning) {
    out.push({
      id: 'return',
      icon: 'return',
      tone: 'neutral',
      view: 'deferred',
      text: `${returning.name} returns to your list ${relativeDay(returning.deferral!.until!, todayStr)}.`,
    });
  }

  const totals = listTotals(data);
  if (budget !== null && totals.total > 0) {
    const over = totals.total - budget;
    out.push({
      id: 'budget',
      icon: 'budget',
      tone: over > 0 ? 'alert' : 'good',
      view: 'list',
      text:
        over > 0
          ? `This list is estimated at ${formatMoney(totals.total, currency)}, which is ${formatMoney(over, currency)} over your budget.`
          : `This list is estimated at ${formatMoney(totals.total, currency)}, leaving ${formatMoney(-over, currency)} of your budget.`,
    });
  }

  if (active.length === 0 && purchased.length > 0) {
    out.push({
      id: 'progress',
      icon: 'progress',
      tone: 'good',
      view: 'list',
      text: `Everything on your list is in the basket: ${plural(purchased.length, 'item')} purchased.`,
    });
  }
  return out;
}

export interface Alert {
  id: string;
  title: string;
  body: string;
  tone: Tone;
  view: ViewId;
  /** Stored notices can be dismissed; derived alerts clear when acted on. */
  noticeId?: string;
}

/** In-app notifications, respecting the user's notification preferences. */
export function buildAlerts(data: AppData, todayStr: string, recs: Recommendation[]): Alert[] {
  const prefs = data.settings.notifications;
  const out: Alert[] = [];

  if (prefs.recurringDue) {
    for (const r of data.recurring) {
      if (r.paused) continue;
      const onList = data.items.some((i) => i.status === 'active' && i.recurringId === r.id);
      if (r.nextDue <= todayStr && !onList) {
        out.push({
          id: `due-${r.id}`,
          title: `${r.name} is due`,
          body: `${frequencyLabel(r.frequency)} purchase, due ${relativeDay(r.nextDue, todayStr)}. Add it to your list, defer it or skip it.`,
          tone: 'warn',
          view: 'recurring',
        });
      } else if (r.reminderDate && r.reminderDate <= todayStr && r.nextDue > todayStr) {
        out.push({
          id: `remind-${r.id}`,
          title: `Reminder: ${r.name}`,
          body: `Due ${relativeDay(r.nextDue, todayStr)}.`,
          tone: 'neutral',
          view: 'recurring',
        });
      }
    }
  }

  for (const n of [...data.notices].reverse()) {
    out.push({
      id: n.id,
      noticeId: n.id,
      title: n.kind === 'deferred-return' ? 'Back from deferral' : 'Recurring purchase added',
      body: n.message,
      tone: 'neutral',
      view: 'list',
    });
  }

  if (prefs.replenishment) {
    for (const r of actionable(recs).filter((x) => x.level === 'due')) {
      out.push({
        id: `rep-${r.key}`,
        title: `${r.name} may need replenishing`,
        body: `Usually bought every ${pluralDays(r.usedInterval)}; last bought ${relativeDay(r.lastPurchased, todayStr)}.`,
        tone: 'neutral',
        view: 'suggestions',
      });
    }
  }

  const { budget, currency } = data.settings;
  const totals = listTotals(data);
  if (prefs.budget && budget !== null && totals.total > budget) {
    out.push({
      id: 'budget',
      title: 'Over budget',
      body: `Your list is estimated at ${formatMoney(totals.total, currency)} against a budget of ${formatMoney(budget, currency)}.`,
      tone: 'alert',
      view: 'list',
    });
  }
  return out;
}
