/**
 * Builds shopping-list text and files for Apple Reminders, Apple Notes and
 * general sharing. Only what belongs on a shopping list leaves the app: item
 * names, quantities, categories, notes and whether each is bought. Prices,
 * stores, history and identifiers are never included, apart from an optional
 * one-line total.
 */
import type { AppData, ShoppingItem } from '../types';
import { categoryById } from './categories';
import { formatDate } from './dates';
import { formatMoney, plural } from './format';

export type ShareFormat = 'reminders' | 'plain' | 'formatted' | 'markdown' | 'csv' | 'json';
export type ShareScope =
  | { kind: 'remaining' }
  | { kind: 'all' }
  | { kind: 'category'; categoryId: string }
  | { kind: 'selected'; ids: string[] };

export interface ShareOptions {
  format: ShareFormat;
  title: string;
  /** Group items under category headings. */
  headings: boolean;
  quantities: boolean;
  /** Add a line with the number of items and the estimated total. */
  summary: boolean;
}

export interface ShareOutput {
  text: string;
  filename: string;
  mime: string;
  itemCount: number;
}

export const FORMAT_LABELS: Record<ShareFormat, string> = {
  reminders: 'Apple Reminders (one item per line)',
  plain: 'Apple Notes: plain text',
  formatted: 'Apple Notes: with checkboxes',
  markdown: 'Markdown checklist',
  csv: 'CSV spreadsheet file',
  json: 'Structured JSON',
};

/** Items in a share. Deferred items are never part of the current list. */
export function selectItems(data: AppData, scope: ShareScope): ShoppingItem[] {
  const onList = data.items.filter((i) => i.status !== 'deferred');
  switch (scope.kind) {
    case 'all':
      return onList;
    case 'category':
      return onList.filter((i) => i.status === 'active' && i.categoryId === scope.categoryId);
    case 'selected':
      return onList.filter((i) => scope.ids.includes(i.id));
    default:
      return onList.filter((i) => i.status === 'active');
  }
}

const amount = (i: ShoppingItem) => {
  const q = Number(i.quantity.toFixed(2));
  return i.unit === 'units' ? `${q}` : `${q} ${q === 1 && (i.unit === 'packs' || i.unit === 'bottles') ? i.unit.slice(0, -1) : i.unit}`;
};
const hasAmount = (i: ShoppingItem) => !(i.quantity === 1 && i.unit === 'units');
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'shopping-list';

export function buildShare(data: AppData, items: ShoppingItem[], options: ShareOptions, todayStr: string): ShareOutput {
  const { format, headings, quantities, summary } = options;
  const title = options.title.trim() || 'Shopping list';
  const date = formatDate(todayStr, data.settings.dateFormat);
  const name = (i: ShoppingItem) => (quantities && hasAmount(i) ? `${i.name} (${amount(i)})` : i.name);
  const groups = data.categories
    .map((c) => ({ category: c, items: items.filter((i) => categoryById(data.categories, i.categoryId).id === c.id) }))
    .filter((g) => g.items.length);
  const sections = headings ? groups : [{ category: null, items: groups.flatMap((g) => g.items) }];

  const priced = items.filter((i) => i.status === 'active');
  const total = priced.reduce((s, i) => s + (i.estimatedPrice ?? 0), 0);
  const unpriced = priced.filter((i) => i.estimatedPrice === undefined).length;
  const summaryLine =
    `${plural(items.length, 'item')}` +
    (total > 0 ? `, estimated ${formatMoney(total, data.settings.currency)}${unpriced ? ` (${unpriced} without a price)` : ''}` : '');
  const base = `${slug(title)}-${todayStr}`;
  const out = (text: string, ext: string, mime: string): ShareOutput => ({ text, filename: `${base}.${ext}`, mime, itemCount: items.length });

  if (format === 'json') {
    return out(
      JSON.stringify(
        {
          app: 'Replenish',
          list: title,
          exportedAt: todayStr,
          ...(summary ? { summary: summaryLine } : {}),
          items: items.map((i) => ({
            title: i.name,
            quantity: i.quantity,
            unit: i.unit,
            category: categoryById(data.categories, i.categoryId).name,
            ...(i.notes ? { notes: i.notes } : {}),
            completed: i.status === 'purchased',
          })),
        },
        null,
        2,
      ),
      'json',
      'application/json',
    );
  }

  if (format === 'csv') {
    const rows = [['Item', 'Quantity', 'Unit', 'Category', 'Notes', 'Completed']];
    for (const g of groups) {
      for (const i of g.items) {
        rows.push([i.name, String(Number(i.quantity.toFixed(2))), i.unit, g.category.name, i.notes ?? '', i.status === 'purchased' ? 'yes' : 'no']);
      }
    }
    return out(rows.map((r) => r.map(csvCell).join(',')).join('\n'), 'csv', 'text/csv');
  }

  const lines: string[] = [];
  if (format === 'reminders') {
    // Each line becomes one reminder, so there is no title, date or summary to get in the way.
    for (const s of sections) {
      if (s.category) lines.push(`${s.category.name}:`);
      for (const i of s.items) lines.push(name(i));
    }
    return out(lines.join('\n'), 'txt', 'text/plain');
  }

  const md = format === 'markdown';
  lines.push(md ? `# ${title}` : title, md ? `_${date}_` : date);
  if (summary) lines.push(summaryLine);
  for (const s of sections) {
    lines.push('');
    if (s.category) lines.push(md ? `## ${s.category.name}` : s.category.name);
    for (const i of s.items) {
      const done = i.status === 'purchased';
      const note = i.notes ? ` - ${i.notes}` : '';
      if (md) lines.push(`- [${done ? 'x' : ' '}] ${name(i)}${note}`);
      else if (format === 'formatted') lines.push(`${done ? '☑' : '☐'} ${name(i)}${note}`);
      else lines.push(`- ${name(i)}${note}${done ? ' (bought)' : ''}`);
    }
  }
  return out(lines.join('\n'), md ? 'md' : 'txt', md ? 'text/markdown' : 'text/plain');
}
