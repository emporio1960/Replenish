import { describe, expect, it } from 'vitest';
import type { AppData } from '../types';
import { buildShare, selectItems } from '../lib/exportList';
import { findMatches, matchCategory, parseCsvRows, parseImport, readItem } from '../lib/importParser';
import { defaultData, exportJson, sanitize } from '../lib/storage';
import {
  addItem, addRecurring, canUndoImport, deferItem, importItems, purchaseItem, undoImport, type ImportEntry,
} from '../state/actions';

const NOW = new Date(2026, 10, 20, 10);
const base = defaultData();
const item = (name: string, extra = {}) => ({ name, quantity: 1, unit: 'units' as const, categoryId: 'other', priority: 'normal' as const, ...extra });
const names = (text: string, d: AppData = base, hint?: 'txt' | 'csv' | 'json') => parseImport(text, d, hint).drafts.map((x) => x.name);
const entries = (text: string, d: AppData): ImportEntry[] =>
  parseImport(text, d).drafts.map((x) => ({ name: x.name, quantity: x.quantity, unit: x.unit, notes: x.notes, categoryId: x.categoryId, action: 'add' }));

describe('reading items', () => {
  it('pulls out quantity, unit and notes without inventing any', () => {
    expect(readItem('2L milk')).toMatchObject({ name: 'Milk', quantity: 2, unit: 'L', notes: undefined, completed: false });
    expect(readItem('1kg apples')).toMatchObject({ name: 'Apples', quantity: 1, unit: 'kg' });
    expect(readItem('Milk (full cream)')).toMatchObject({ name: 'Milk', quantity: 1, unit: 'units', notes: 'full cream' });
    expect(readItem('Bread - the sourdough one')).toMatchObject({ name: 'Bread', notes: 'the sourdough one' });
    expect(readItem('Eggs (12)')).toMatchObject({ name: 'Eggs', quantity: 12 });
    expect(readItem('Butter (done)')).toMatchObject({ name: 'Butter', completed: true });
    expect(readItem('   ')).toBeNull();
  });
});

describe('importing from Apple Notes', () => {
  it('reads the example note, skipping the title', () => {
    const p = parseImport('Shopping List\n\n* Milk\n* Bread\n* Eggs\n* Apples\n* Chicken breast\n* Dishwashing liquid\n* Toilet paper', base);
    expect(p.listName).toBe('Shopping List');
    expect(p.format).toBe('text');
    expect(p.drafts.map((d) => [d.name, d.categoryId])).toEqual([
      ['Milk', 'dairy'], ['Bread', 'bakery'], ['Eggs', 'dairy'], ['Apples', 'produce'], ['Chicken breast', 'meat'],
      ['Dishwashing liquid', 'cleaning'], ['Toilet paper', 'household'],
    ]);
  });

  it('handles numbered lists, checkbox lists, group headings and explanatory text', () => {
    const p = parseImport(
      [
        'Weekly shop', 'Remember to take the reusable bags and check the specials before you go.', '',
        'Fruit & Veg:', '1. 1kg apples', '2) Bananas', '',
        '## Dairy', '- [ ] 2L milk', '- [x] Greek yoghurt', '☐ Cheese (tasty)', '☑ Butter', '',
        'Cleaning', '• Dishwashing liquid', '• 2 packs toilet paper', '• Flux capacitor',
      ].join('\n'),
      base,
    );
    expect(p.listName).toBe('Weekly shop');
    expect(p.drafts.map((d) => d.name)).toEqual(['Apples', 'Bananas', 'Milk', 'Greek yoghurt', 'Cheese', 'Butter', 'Dishwashing liquid', 'Toilet paper', 'Flux capacitor']);
    expect(p.drafts.filter((d) => d.completed).map((d) => d.name)).toEqual(['Greek yoghurt', 'Butter']);
    expect(p.drafts[0]).toMatchObject({ quantity: 1, unit: 'kg', categoryId: 'produce' });
    expect(p.drafts[2]).toMatchObject({ quantity: 2, unit: 'L', categoryId: 'dairy' });
    expect(p.drafts[4].notes).toBe('tasty');
    expect(p.drafts[7]).toMatchObject({ quantity: 2, unit: 'packs', categoryId: 'household' }); // the classifier beats the "Cleaning" heading
    // An unknown product takes its category from the heading it sits under, and says so.
    expect(p.drafts[8]).toMatchObject({ categoryId: 'cleaning', categorySource: 'heading', heading: 'Cleaning' });
    expect(p.ignored).toBeGreaterThanOrEqual(4);
  });

  it('reads plain lines with no bullets, including headings', () => {
    const p = parseImport('Groceries\nMilk\nbread\n500g chicken mince\n\nPANTRY\nRice\nMystery sauce', base);
    expect(p.listName).toBe('Groceries');
    expect(p.drafts.map((d) => d.name)).toEqual(['Milk', 'Bread', 'Chicken mince', 'Rice', 'Mystery sauce']);
    expect(p.drafts[2]).toMatchObject({ quantity: 500, unit: 'g', categoryId: 'meat' });
    expect(p.drafts[4]).toMatchObject({ categoryId: 'pantry', categorySource: 'heading' });
  });
});

describe('importing from Apple Reminders', () => {
  it('reads a pasted list with completed items and notes', () => {
    const p = parseImport('Groceries\n◦ 2L Milk\n◦ Dishwashing liquid\n    the green one\n✓ Bread\n◦ 2 packs toilet paper', base);
    expect(p.listName).toBe('Groceries');
    expect(p.drafts.map((d) => [d.name, d.completed])).toEqual([['Milk', false], ['Dishwashing liquid', false], ['Bread', true], ['Toilet paper', false]]);
    expect(p.drafts[1].notes).toBe('the green one');
  });

  it('accepts the structured JSON a Shortcut can produce, and Replenish\'s own files', () => {
    const p = parseImport(JSON.stringify({ list: 'Groceries', items: [
      { title: 'Milk', quantity: 2, unit: 'L', completed: false, notes: 'full cream' },
      { title: '500g chicken mince', completed: true }, 'Bread', { title: '' }, 42,
    ] }), base);
    expect(p).toMatchObject({ format: 'json', listName: 'Groceries' });
    expect(p.drafts).toHaveLength(3);
    expect(p.drafts[0]).toMatchObject({ name: 'Milk', quantity: 2, unit: 'L', notes: 'full cream', categoryId: 'dairy' });
    expect(p.drafts[1]).toMatchObject({ name: 'Chicken mince', quantity: 500, unit: 'g', completed: true });
    expect(names('["Milk","- [x] Eggs"]')).toEqual(['Milk', 'Eggs']);
    expect(() => parseImport('{broken', base, 'json')).toThrow('not valid JSON');
    // A Replenish backup: active and bought items come across, deferred ones do not.
    let d = addItem(base, item('Milk'), NOW, 'a');
    d = deferItem(addItem(d, item('Soap'), NOW, 'b'), 'b', null, '', NOW);
    expect(names(exportJson(d))).toEqual(['Milk']);
  });
});

describe('importing files', () => {
  it('reads CSV with a header row, in any column order', () => {
    const p = parseImport('Category,Item,Qty,Unit,Done,Notes\nDairy,Milk,2,L,no,"full cream, 2 for 1"\nBakery,"Bread, sliced",1,,yes,\nGarden,Potting mix,1,packs,,', base, 'csv');
    expect(p.format).toBe('csv');
    expect(p.drafts.map((d) => [d.name, d.quantity, d.unit, d.completed])).toEqual([
      ['Milk', 2, 'L', false], ['Bread, sliced', 1, 'units', true], ['Potting mix', 1, 'packs', false],
    ]);
    expect(p.drafts[0].notes).toBe('full cream, 2 for 1');
    expect(p.drafts[2].categoryId).toBe('other'); // "Garden" is not a category here, so nothing is guessed
  });
  it('reads CSV without a header, and detects pasted CSV', () => {
    expect(parseImport('Milk,2,L\n500g mince\nEggs,12', base, 'csv').drafts.map((d) => [d.name, d.quantity, d.unit])).toEqual([
      ['Milk', 2, 'L'], ['Mince', 500, 'g'], ['Eggs', 12, 'units'],
    ]);
    expect(parseImport('Title,Completed\nMilk,true\nBread,false', base).format).toBe('csv');
    expect(parseCsvRows('a;b\n"x;y";z')).toEqual([['a', 'b'], ['x;y', 'z']]);
  });
  it('reads TXT and survives messy input', () => {
    expect(names('﻿  -   Milk  \r\n\r\n*Bread\n-\n- \n--- \n1.Eggs', base, 'txt')).toContain('Milk');
    expect(parseImport('', base).drafts).toEqual([]);
    expect(parseImport('12345\n!!!', base).drafts).toEqual([]);
    expect(parseImport(Array.from({ length: 700 }, (_, i) => `- Thing ${i}`).join('\n'), base).drafts).toHaveLength(500);
  });
  it('matches category names written different ways', () => {
    const c = base.categories;
    expect(matchCategory('Dairy & Eggs', c)).toBe('dairy');
    expect(matchCategory('FRUIT AND VEGETABLES', c)).toBe('produce');
    expect(matchCategory('Fruit & Veg', c)).toBe('produce');
    expect(matchCategory('Household Cleaning', c)).toBe('cleaning');
    expect(matchCategory('Toiletries', c)).toBe('personal');
    expect(matchCategory('Chemist', c)).toBe('health');
    expect(matchCategory('Miscellaneous stuff', c)).toBeUndefined();
  });
});

describe('duplicate detection', () => {
  let d = addItem(base, item('Milk', { quantity: 1, unit: 'L' }), NOW, 'milk');
  d = deferItem(addItem(d, item('Washing detergent'), NOW, 'det'), 'det', null, '', NOW);
  d = purchaseItem(addItem(d, item('Bread'), NOW, 'bread'), 'bread', NOW);
  d = addRecurring(d, { ...item('Dog food'), frequency: { kind: 'monthly' }, nextDue: '2026-12-01' }, NOW);

  it('compares against the list, deferred, purchased and recurring items', () => {
    const p = parseImport('- 2L Milk\n- milk\n- washing detergents\n- Bread\n- Dog food\n- Lemons', d);
    const m = p.drafts.map((x) => findMatches(x, d, p.drafts));
    expect(m[0]).toMatchObject({ existing: { id: 'milk' }, repeated: false }); // "2L Milk" relates to "Milk"
    expect(m[1]).toMatchObject({ existing: { id: 'milk' }, repeated: true });
    expect(m[2].existing).toMatchObject({ id: 'det', status: 'deferred' });
    expect(m[3]).toMatchObject({ existing: undefined, purchased: { id: 'bread' } });
    expect(m[4].recurring?.name).toBe('Dog food');
    expect(m[5]).toEqual({ existing: undefined, purchased: undefined, recurring: undefined, repeated: false });
  });

  it('skips, merges, adds separately or replaces, exactly as chosen', () => {
    const before = JSON.stringify(d.items);
    const next = importItems(d, [
      { ...item('Milk'), quantity: 2, unit: 'L', action: 'merge', existingId: 'milk' },
      { ...item('Milk'), action: 'add', existingId: 'milk' },
      { ...item('Laundry liquid'), quantity: 3, categoryId: 'cleaning', action: 'replace', existingId: 'det' },
      { ...item('Lemons'), categoryId: 'produce', action: 'skip' },
      { ...item(''), action: 'add' },
      { ...item('Limes'), categoryId: 'produce', action: 'add' },
    ], { source: 'reminders', listName: 'Groceries' }, NOW);
    expect(next.items.find((i) => i.id === 'milk')?.quantity).toBe(3);
    expect(next.items.filter((i) => i.name === 'Milk')).toHaveLength(2);
    expect(next.items.find((i) => i.id === 'det')).toMatchObject({ name: 'Laundry liquid', quantity: 3, status: 'deferred', categoryId: 'cleaning' });
    expect(next.items.some((i) => i.name === 'Lemons')).toBe(false);
    const record = next.imports[0];
    expect(record).toMatchObject({ source: 'reminders', listName: 'Groceries', added: 2, merged: 1, replaced: 1, skipped: 2 });
    expect(record.itemIds).toHaveLength(2);
    expect(new Set(next.items.map((i) => i.id)).size).toBe(next.items.length); // every item has its own id
    expect(JSON.stringify(d.items)).toBe(before); // the original data object was not mutated

    // Undo puts everything back exactly as it was.
    const undone = undoImport(next, record.id);
    expect(JSON.stringify(undone.items)).toBe(before);
    expect(undone.imports[0].undone).toBe(true);
    expect(canUndoImport(undone.imports[0])).toBe(false);
    expect(undoImport(undone, record.id)).toBe(undone);
  });

  it('leaves existing records untouched on a plain import and keeps bought items on undo', () => {
    let next = importItems(d, entries('- Lemons\n- Limes', d), { source: 'notes' }, NOW);
    for (const old of d.items) expect(next.items.find((i) => i.id === old.id)).toEqual(old);
    const lemons = next.items.find((i) => i.name === 'Lemons')!;
    expect(lemons).toMatchObject({ status: 'active', categoryId: 'produce', deferCount: 0 });
    next = purchaseItem(next, lemons.id, NOW);
    const undone = undoImport(next, next.imports[0].id);
    expect(undone.items.some((i) => i.name === 'Lemons')).toBe(true); // bought since, so kept
    expect(undone.items.some((i) => i.name === 'Limes')).toBe(false);
    expect(undone.history).toHaveLength(next.history.length);
  });

  it('remembers a category corrected in the preview, and persists the history', () => {
    const next = importItems(base, [{ ...item('Almond milk'), categoryId: 'beverages', action: 'add', corrected: true }], { source: 'file' }, NOW);
    expect(next.categoryRules['almond milk']).toBe('beverages');
    const saved = sanitize(JSON.parse(JSON.stringify(next)));
    expect(saved.imports).toEqual(next.imports);
    expect(saved.items).toEqual(next.items);
    expect(sanitize({ version: 4, items: [{ id: 'a', name: 'Milk' }] })).toMatchObject({ version: 5, imports: [] });
  });
});

describe('exporting and sharing', () => {
  let d = addItem(base, item('Milk', { quantity: 2, unit: 'L', categoryId: 'dairy', estimatedPrice: 3.6, notes: 'full cream' }), NOW, 'milk');
  d = addItem(d, item('Apples', { quantity: 1, unit: 'kg', categoryId: 'produce', estimatedPrice: 4 }), NOW, 'apples');
  d = addItem(d, item('Bread', { categoryId: 'bakery' }), NOW, 'bread');
  d = purchaseItem(addItem(d, item('Eggs', { quantity: 12, categoryId: 'dairy', estimatedPrice: 7 }), NOW, 'eggs'), 'eggs', NOW);
  d = deferItem(addItem(d, item('Sunscreen', { categoryId: 'health' }), NOW, 'sun'), 'sun', null, '', NOW);
  const opts = { title: 'Shopping list', headings: true, quantities: true, summary: false };
  const share = (format: Parameters<typeof buildShare>[2]['format'], scope: Parameters<typeof selectItems>[1] = { kind: 'remaining' }, extra = {}) =>
    buildShare(d, selectItems(d, scope), { ...opts, format, ...extra }, '2026-11-20');

  it('chooses the right items for each scope, never the deferred ones', () => {
    expect(selectItems(d, { kind: 'remaining' }).map((i) => i.name)).toEqual(['Milk', 'Apples', 'Bread']);
    expect(selectItems(d, { kind: 'all' }).map((i) => i.name)).toEqual(['Milk', 'Apples', 'Bread', 'Eggs']);
    expect(selectItems(d, { kind: 'category', categoryId: 'dairy' }).map((i) => i.name)).toEqual(['Milk']);
    expect(selectItems(d, { kind: 'selected', ids: ['bread', 'sun'] }).map((i) => i.name)).toEqual(['Bread']);
  });

  it('writes Reminders text as one clean line per item', () => {
    expect(share('reminders', { kind: 'remaining' }, { headings: false }).text).toBe('Apples (1 kg)\nMilk (2 L)\nBread');
    expect(share('reminders').text).toBe('Fruit and vegetables:\nApples (1 kg)\nDairy and eggs:\nMilk (2 L)\nBakery:\nBread');
    expect(share('reminders', { kind: 'remaining' }, { headings: false, quantities: false }).text).toBe('Apples\nMilk\nBread');
  });

  it('writes Notes text with title, date, headings, quantities and checkboxes', () => {
    expect(share('plain', { kind: 'all' }, { summary: true }).text).toBe(
      'Shopping list\n20/11/2026\n4 items, estimated $7.60 (1 without a price)\n\nFruit and vegetables\n- Apples (1 kg)\n\nDairy and eggs\n- Milk (2 L) - full cream\n- Eggs (12) (bought)\n\nBakery\n- Bread',
    );
    expect(share('formatted', { kind: 'all' }).text).toContain('☐ Milk (2 L) - full cream\n☑ Eggs (12)');
    const md = share('markdown', { kind: 'all' });
    expect(md.text).toContain('# Shopping list\n_20/11/2026_\n\n## Fruit and vegetables\n- [ ] Apples (1 kg)');
    expect(md.text).toContain('- [x] Eggs (12)');
    expect(md).toMatchObject({ filename: 'shopping-list-2026-11-20.md', itemCount: 4 });
  });

  it('writes CSV and JSON that Replenish can read back', () => {
    const csv = share('csv', { kind: 'all' });
    expect(csv.text.split('\n')[0]).toBe('Item,Quantity,Unit,Category,Notes,Completed');
    expect(csv).toMatchObject({ filename: 'shopping-list-2026-11-20.csv', mime: 'text/csv' });
    const back = parseImport(csv.text, base, 'csv');
    expect(back.drafts.map((x) => [x.name, x.quantity, x.unit, x.completed, x.categoryId])).toEqual([
      ['Apples', 1, 'kg', false, 'produce'], ['Milk', 2, 'L', false, 'dairy'], ['Eggs', 12, 'units', true, 'dairy'], ['Bread', 1, 'units', false, 'bakery'],
    ]);
    const json = parseImport(share('json', { kind: 'all' }).text, base);
    expect(json).toMatchObject({ format: 'json', listName: 'Shopping list' });
    expect(json.drafts.find((x) => x.name === 'Milk')).toMatchObject({ quantity: 2, unit: 'L', notes: 'full cream' });
    // Round trip through text formats as well.
    expect(names(share('markdown', { kind: 'all' }).text).sort()).toEqual(['Apples', 'Bread', 'Eggs', 'Milk']);
    expect(names(share('formatted', { kind: 'all' }).text).sort()).toEqual(['Apples', 'Bread', 'Eggs', 'Milk']);
    expect(names(share('reminders').text).sort()).toEqual(['Apples', 'Bread', 'Milk']);
  });

  it('never shares private data', () => {
    for (const format of ['reminders', 'plain', 'formatted', 'markdown', 'csv', 'json'] as const) {
      const text = share(format, { kind: 'all' }).text;
      expect(text).not.toMatch(/milk"?,?\s*"?id|"id"|estimatedPrice|createdAt|3\.6|historyId/i);
      expect(text).not.toContain('Sunscreen');
    }
  });
});
