/**
 * The shopping-list import parser. One engine reads everything that comes in
 * from outside: text pasted or shared from Apple Reminders or Notes, TXT, CSV
 * and JSON files, and data handed over by an Apple Shortcut.
 *
 * It only reports what is actually in the text. Quantities, notes and ticks
 * are taken when present and never made up; categories come from the same
 * classifier the rest of the app uses.
 */
import { UNITS, type AppData, type Category, type RecurringPurchase, type ShoppingItem, type Unit } from '../types';
import { OTHER_CATEGORY_ID } from './categories';
import { categorise, classifyName, type ClassifySource } from './classify';
import { isLikelyDuplicate, normalizeName } from './duplicates';
import { parseLine } from './parseList';

export interface ImportDraft {
  key: string;
  name: string;
  quantity: number;
  unit: Unit;
  notes?: string;
  /** Ticked off in the source list. */
  completed: boolean;
  categoryId: string;
  /** How the category was decided; 'heading' means a section heading in the source. */
  categorySource: ClassifySource | 'heading';
  heading?: string;
}

export interface ParsedImport {
  listName: string | null;
  format: 'text' | 'csv' | 'json';
  drafts: ImportDraft[];
  /** Lines that were read as headings or explanatory text rather than items. */
  ignored: number;
}

export const MAX_IMPORT_CHARS = 200_000;
export const MAX_IMPORT_ITEMS = 500;

/* ---------- categories named in the source ---------- */

const HEADING_SYNONYMS: Record<string, string> = {
  produce: 'produce', fruit: 'produce', fruits: 'produce', veg: 'produce', vegetables: 'produce', veggies: 'produce',
  'fruit and veg': 'produce', greengrocer: 'produce',
  meat: 'meat', butcher: 'meat', seafood: 'meat', deli: 'meat', poultry: 'meat', 'meat and fish': 'meat',
  dairy: 'dairy', fridge: 'dairy', 'dairy eggs and cheese': 'dairy', eggs: 'dairy', chilled: 'dairy',
  bakery: 'bakery', 'breads and cereals': 'bakery',
  pantry: 'pantry', 'dry goods': 'pantry', staples: 'pantry', 'canned goods': 'pantry',
  'snacks and candy': 'pantry', snacks: 'pantry', 'oils and dressings': 'pantry', 'sauces and condiments': 'pantry',
  'spices and seasonings': 'pantry', 'baking items': 'pantry', 'pasta rice and beans': 'pantry',
  frozen: 'frozen', freezer: 'frozen',
  drinks: 'beverages', beverages: 'beverages', 'coffee and tea': 'beverages', 'wine beer and spirits': 'beverages',
  cleaning: 'cleaning', laundry: 'cleaning', 'cleaning products': 'cleaning',
  household: 'household', 'household items': 'household', 'home and garden': 'household', 'paper products': 'household',
  'personal care': 'personal', toiletries: 'personal', bathroom: 'personal', 'personal care and health': 'personal',
  'baby care': 'personal', baby: 'personal',
  pet: 'pet', pets: 'pet', 'pet care': 'pet',
  health: 'health', pharmacy: 'health', chemist: 'health', medicine: 'health',
};

const plain = (s: string) =>
  s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** The category a heading or column value refers to, if it clearly names one. */
export function matchCategory(text: string, categories: Category[]): string | undefined {
  const t = plain(text);
  if (!t) return undefined;
  const exact = categories.find((c) => plain(c.name) === t);
  if (exact) return exact.id;
  const synonym = HEADING_SYNONYMS[t] ?? HEADING_SYNONYMS[t.replace(/\band\b/g, '').replace(/\s+/g, ' ').trim()];
  if (synonym && categories.some((c) => c.id === synonym)) return synonym;
  const words = t.split(' ').filter((w) => w !== 'and');
  const partial = categories.filter((c) => {
    const name = plain(c.name).split(' ');
    return words.length > 0 && words.every((w) => name.includes(w));
  });
  return partial.length === 1 ? partial[0].id : undefined;
}

/* ---------- reading one item ---------- */

const DONE_MARK = /^\s*(?:[-*+]\s*)?(?:\[\s*[xX✓✔]\s*\]|☑️?|✅|✓|✔️?|☒)\s*/;
const OPEN_MARK = /^\s*(?:[-*+]\s*)?(?:\[\s?\]|☐|□|⬜|◻️?|◯)\s*/;
const BULLET = /^\s*(?:[-*+•·–—◦○●▪■‣⁃]|\d{1,3}[.)])\s+/;

interface RawItem {
  text: string;
  completed: boolean;
  marked: boolean;
}

function stripMarker(line: string): RawItem {
  if (DONE_MARK.test(line)) return { text: line.replace(DONE_MARK, ''), completed: true, marked: true };
  if (OPEN_MARK.test(line)) return { text: line.replace(OPEN_MARK, ''), completed: false, marked: true };
  if (BULLET.test(line)) return { text: line.replace(BULLET, ''), completed: false, marked: true };
  return { text: line, completed: false, marked: false };
}

interface ItemParts {
  name: string;
  quantity: number;
  unit: Unit;
  notes?: string;
  completed: boolean;
}

/** Splits "2L milk (full cream) - the blue one" into name, quantity, unit and notes. */
export function readItem(text: string, completed = false): ItemParts | null {
  let body = text.trim();
  let done = completed;
  const tail = /\s*[([]?(?:done|completed|bought|purchased)[)\]]?\s*$/i;
  if (/[([](?:done|completed|bought|purchased)[)\]]\s*$/i.test(body)) {
    body = body.replace(tail, '');
    done = true;
  }
  const notes: string[] = [];
  // "Milk (2 L) - full cream": a trailing note after a dash, then brackets that
  // hold either an amount or a note.
  const dash = /^(.*?[a-z].*?)\s+[-–—:]\s+(.+)$/i.exec(body);
  if (dash) {
    body = dash[1];
    notes.push(dash[2].trim());
  }
  let parsed = null as ReturnType<typeof parseLine>;
  const bracket = /^(.*\S)\s*\(([^()]+)\)\s*$/.exec(body);
  if (bracket) {
    const inside = bracket[2].trim();
    const asAmount = /^x?\s*\d+(?:[.,]\d+)?\s*[a-z]*$/i.test(inside) ? parseLine(`${inside.replace(/^x\s*/i, '')} ${bracket[1]}`) : null;
    if (asAmount && (asAmount.quantity !== 1 || asAmount.unit !== 'units' || /^x?\s*1$/i.test(inside))) parsed = asAmount;
    else notes.unshift(inside);
    body = bracket[1];
  }
  parsed = parsed ?? parseLine(body);
  if (!parsed) return null;
  return {
    name: parsed.name,
    quantity: parsed.quantity > 0 ? parsed.quantity : 1,
    unit: parsed.unit,
    notes: notes.join('; ').slice(0, 300) || undefined,
    completed: done,
  };
}

/* ---------- plain text ---------- */

interface Collected {
  parts: ItemParts;
  heading?: string;
  headingCategory?: string;
  category?: string;
}

const LIST_WORDS = /\b(list|shopping|groceries|grocery|to buy|supermarket|shop|reminders?)\b/i;
const isShouting = (s: string) => /[A-Z]{3,}/.test(s) && s === s.toUpperCase() && !/\d/.test(s);

function parseText(text: string, categories: Category[]): { listName: string | null; items: Collected[]; ignored: number } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const filled = lines.filter((l) => l.trim());
  const markedCount = filled.filter((l) => stripMarker(l).marked).length;
  // Once a few lines carry bullets or checkboxes, the unmarked lines around them
  // are titles, headings and notes rather than items.
  const markedDoc = markedCount >= 2 && markedCount / filled.length >= 0.3;

  let listName: string | null = null;
  let heading: string | undefined;
  let headingCategory: string | undefined;
  let ignored = 0;
  let seenItem = false;
  const items: Collected[] = [];

  const setHeading = (raw: string) => {
    const label = raw.replace(/^#+\s*/, '').replace(/[:：]\s*$/, '').trim();
    if (!label) return;
    const cat = matchCategory(label, categories);
    if (!seenItem && !cat && listName === null) {
      listName = label.slice(0, 80);
    } else {
      heading = label.slice(0, 80);
      headingCategory = cat;
    }
    ignored += 1;
  };

  lines.forEach((line, index) => {
    if (!line.trim()) return;
    if (/^\s*#{1,6}\s+\S/.test(line)) return setHeading(line);
    const raw = stripMarker(line);
    const textOnly = raw.text.trim();
    if (!textOnly) return;

    if (!raw.marked) {
      const words = textOnly.split(/\s+/).length;
      const sentence = words >= 8 || (words >= 4 && /[.!?]$/.test(textOnly));
      if (/[:：]$/.test(textOnly)) return setHeading(textOnly);
      if (markedDoc) {
        // An indented line under an item is that item's note (as Reminders exports them).
        if (/^\s+/.test(line) && items.length && !sentence) {
          const last = items[items.length - 1].parts;
          last.notes = [last.notes, textOnly].filter(Boolean).join('; ').slice(0, 300);
          return;
        }
        if (sentence) {
          ignored += 1;
          return;
        }
        return setHeading(textOnly);
      }
      if (sentence) {
        ignored += 1;
        return;
      }
      const firstLine = !seenItem && listName === null && index === lines.findIndex((l) => l.trim());
      if (firstLine && (LIST_WORDS.test(textOnly) || !lines[index + 1]?.trim())) return setHeading(textOnly);
      const exactCategory = categories.some((c) => plain(c.name) === plain(textOnly));
      if (exactCategory || isShouting(textOnly) || (matchCategory(textOnly, categories) && classifyName(textOnly).source === 'none')) {
        return setHeading(textOnly);
      }
    }

    const parts = readItem(textOnly, raw.completed);
    if (!parts) {
      ignored += 1;
      return;
    }
    seenItem = true;
    items.push({ parts, heading, headingCategory });
  });
  return { listName, items, ignored };
}

/* ---------- CSV ---------- */

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/\r\n?/g, '\n');
  const delimiter = src.split('\n')[0].includes('\t') && !src.split('\n')[0].includes(',') ? '\t' : src.split('\n')[0].split(';').length > src.split('\n')[0].split(',').length ? ';' : ',';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      if (row.some((c) => c)) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c)) rows.push(row);
  return rows;
}

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', 'x', 'done', 'completed', 'complete', 'checked', 'bought', 'purchased', '✓', '✔']);
const COLUMN_NAMES: Record<string, string[]> = {
  name: ['item', 'name', 'title', 'product', 'reminder', 'task', 'description'],
  quantity: ['quantity', 'qty', 'amount', 'count'],
  unit: ['unit', 'units', 'uom', 'measure'],
  notes: ['notes', 'note', 'comment', 'comments', 'details'],
  completed: ['completed', 'complete', 'done', 'checked', 'status', 'purchased', 'bought', 'iscompleted'],
  category: ['category', 'section', 'aisle', 'group', 'department'],
};
const UNIT_FIX: Record<string, Unit> = { l: 'L', litre: 'L', litres: 'L', kg: 'kg', g: 'g', ml: 'ml', pack: 'packs', packs: 'packs', bottle: 'bottles', bottles: 'bottles', unit: 'units', units: 'units' };

function looksLikeCsvHeader(cells: string[]): boolean {
  const names = cells.map((c) => plain(c).replace(/\s/g, ''));
  return names.some((n) => COLUMN_NAMES.name.includes(n));
}

function parseCsv(text: string, categories: Category[]): { listName: string | null; items: Collected[]; ignored: number } {
  const rows = parseCsvRows(text);
  if (!rows.length) return { listName: null, items: [], ignored: 0 };
  const header = looksLikeCsvHeader(rows[0]) ? rows[0].map((c) => plain(c).replace(/\s/g, '')) : null;
  const col = (field: string) => (header ? header.findIndex((h) => COLUMN_NAMES[field].includes(h)) : -1);
  const at = { name: header ? col('name') : 0, quantity: header ? col('quantity') : -1, unit: col('unit'), notes: col('notes'), completed: col('completed'), category: col('category') };
  const items: Collected[] = [];
  let ignored = header ? 1 : 0;
  for (const row of rows.slice(header ? 1 : 0)) {
    const raw = stripMarker(row[at.name] ?? '');
    const parts = readItem(raw.text, raw.completed);
    if (!parts) {
      ignored += 1;
      continue;
    }
    // Without a header, a bare number in the second column is taken as the quantity.
    const qtyCell = at.quantity >= 0 ? row[at.quantity] : !header && /^\d+(?:[.,]\d+)?$/.test(row[1] ?? '') ? row[1] : undefined;
    const qty = qtyCell !== undefined ? Number(qtyCell.replace(',', '.')) : NaN;
    if (Number.isFinite(qty) && qty > 0) parts.quantity = qty;
    const unitCell = at.unit >= 0 ? row[at.unit] : !header && qtyCell !== undefined ? row[2] : undefined;
    const unit = unitCell ? (UNIT_FIX[unitCell.toLowerCase()] ?? (UNITS as string[]).find((u) => u.toLowerCase() === unitCell.toLowerCase())) : undefined;
    if (unit) parts.unit = unit as Unit;
    if (at.notes >= 0 && row[at.notes]) parts.notes = [parts.notes, row[at.notes]].filter(Boolean).join('; ').slice(0, 300);
    if (at.completed >= 0 && TRUE_WORDS.has((row[at.completed] ?? '').toLowerCase())) parts.completed = true;
    const categoryText = at.category >= 0 ? row[at.category] : undefined;
    items.push({ parts, heading: categoryText || undefined, category: categoryText ? matchCategory(categoryText, categories) : undefined });
  }
  return { listName: null, items, ignored };
}

/* ---------- JSON ---------- */

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function parseJson(root: unknown, categories: Category[]): { listName: string | null; items: Collected[]; ignored: number } {
  let listName: string | null = null;
  let entries: unknown[] = [];
  if (Array.isArray(root)) entries = root;
  else if (isObj(root)) {
    listName = str(root.list) || str(root.listName) || str(root.name) || str(root.title) || null;
    const found = [root.items, root.reminders, root.entries, root.data, root.list].find(Array.isArray);
    entries = (found as unknown[] | undefined) ?? [];
  }
  const items: Collected[] = [];
  let ignored = 0;
  for (const e of entries) {
    if (typeof e === 'string') {
      const raw = stripMarker(e);
      const parts = readItem(raw.text, raw.completed);
      if (parts) items.push({ parts });
      else ignored += 1;
      continue;
    }
    if (!isObj(e)) {
      ignored += 1;
      continue;
    }
    // Replenish's own backups: deferred items are not part of the current list.
    if (e.status === 'deferred') {
      ignored += 1;
      continue;
    }
    const title = str(e.title) || str(e.name) || str(e.item) || str(e.text) || str(e.product);
    const done = [e.completed, e.isCompleted, e.done, e.checked].some((v) => v === true || (typeof v === 'string' && TRUE_WORDS.has(v.toLowerCase()))) || e.status === 'purchased';
    const parts = readItem(title, done);
    if (!parts) {
      ignored += 1;
      continue;
    }
    if (typeof e.quantity === 'number' && e.quantity > 0) parts.quantity = e.quantity;
    const unit = str(e.unit);
    const fixed = UNIT_FIX[unit.toLowerCase()] ?? (UNITS as string[]).find((u) => u === unit);
    if (fixed) parts.unit = fixed as Unit;
    const note = str(e.notes) || str(e.note);
    if (note) parts.notes = [parts.notes, note].filter(Boolean).join('; ').slice(0, 300);
    const categoryText = str(e.category) || str(e.section) || str(e.categoryId);
    const byId = categories.find((c) => c.id === categoryText)?.id;
    items.push({ parts, heading: categoryText || undefined, category: byId ?? (categoryText ? matchCategory(categoryText, categories) : undefined) });
  }
  return { listName, items, ignored };
}

/* ---------- entry point ---------- */

type Known = Pick<AppData, 'categoryRules' | 'categories' | 'history' | 'recurring' | 'settings'>;

/**
 * Reads a shopping list in any supported form. `hint` is the file type when
 * the text came from a file; pasted text is detected automatically.
 */
export function parseImport(input: string, data: Known, hint?: 'txt' | 'csv' | 'json'): ParsedImport {
  const text = input.replace(/^﻿/, '').slice(0, MAX_IMPORT_CHARS).trim();
  let format: ParsedImport['format'] = 'text';
  let result: { listName: string | null; items: Collected[]; ignored: number } | null = null;

  if (hint === 'json' || (hint !== 'csv' && /^[[{]/.test(text))) {
    try {
      result = parseJson(JSON.parse(text), data.categories);
      format = 'json';
    } catch {
      if (hint === 'json') throw new Error('This file is not valid JSON.');
    }
  }
  if (!result) {
    const first = text.split('\n')[0] ?? '';
    const csvLike = hint === 'csv' || (text.includes('\n') && /[,;\t]/.test(first) && looksLikeCsvHeader(parseCsvRows(first)[0] ?? []));
    if (csvLike) {
      result = parseCsv(text, data.categories);
      format = 'csv';
    } else {
      result = parseText(text, data.categories);
    }
  }

  const drafts: ImportDraft[] = result.items.slice(0, MAX_IMPORT_ITEMS).map((item, i) => {
    const auto = categorise(data, item.parts.name);
    // The classifier knows products; a heading or category column is the next
    // best evidence, and only then the "not recognised" category.
    const fromSource = item.category ?? item.headingCategory;
    const categoryId = auto.source !== 'none' ? auto.categoryId : (fromSource ?? data.settings.defaultCategoryId ?? OTHER_CATEGORY_ID);
    return {
      key: `d${i}`,
      ...item.parts,
      categoryId,
      categorySource: auto.source !== 'none' ? auto.source : fromSource ? 'heading' : 'none',
      heading: item.heading,
    };
  });
  return { listName: result.listName, format, drafts, ignored: result.ignored };
}

/* ---------- duplicates ---------- */

export interface DraftMatches {
  /** An item still to buy (on the list or deferred) that looks like the same product. */
  existing?: ShoppingItem;
  /** Already ticked off on the current list. */
  purchased?: ShoppingItem;
  /** A recurring purchase for the same product. */
  recurring?: RecurringPurchase;
  /** The same product appears earlier in the list being imported. */
  repeated: boolean;
}

/** Compares one imported item with everything already in Replenish, and with the rest of the import. */
export function findMatches(draft: ImportDraft, data: Pick<AppData, 'items' | 'recurring'>, drafts: ImportDraft[]): DraftMatches {
  const key = normalizeName(draft.name);
  const index = drafts.findIndex((d) => d.key === draft.key);
  return {
    existing: data.items.find((i) => i.status !== 'purchased' && isLikelyDuplicate(i.name, draft.name)),
    purchased: data.items.find((i) => i.status === 'purchased' && isLikelyDuplicate(i.name, draft.name)),
    recurring: data.recurring.find((r) => normalizeName(r.name) === key),
    repeated: drafts.slice(0, Math.max(index, 0)).some((d) => normalizeName(d.name) === key),
  };
}
