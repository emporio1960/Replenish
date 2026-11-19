import { describe, expect, it } from 'vitest';
import { categorise, classifyName, productKey } from '../lib/classify';
import { parseList } from '../lib/parseList';
import { defaultData, exportJson, parseImport, sanitize } from '../lib/storage';
import {
  addItem, addParsed, addRecurring, addRecurringToList, autoCategory, deferItem, deleteCategory, addCategory,
  forgetCategoryRule, learnCategory, processDue, purchaseItem, restoreItem, sortableOther, sortOther, updateSettings,
} from '../state/actions';

const NOW = new Date(2026, 10, 20, 10);
const cat = (name: string) => classifyName(name).categoryId;
const expectAll = (table: Record<string, string>) => {
  const wrong = Object.entries(table).filter(([name, id]) => cat(name) !== id).map(([name, id]) => `${name}: got ${cat(name)}, want ${id}`);
  expect(wrong).toEqual([]);
};

describe('automatic categorisation', () => {
  it('files the examples from the brief', () => {
    expectAll({
      Apples: 'produce', Bananas: 'produce', 'Chicken breast': 'meat', Salmon: 'meat', Milk: 'dairy', Cheese: 'dairy',
      Bread: 'bakery', Croissants: 'bakery', Rice: 'pantry', Pasta: 'pantry', 'Orange juice': 'beverages',
      'Dishwashing liquid': 'cleaning', 'Laundry detergent': 'cleaning', Shampoo: 'personal', Toothpaste: 'personal',
      'Dog food': 'pet', Batteries: 'household',
    });
  });

  it('covers common groceries', () => {
    expectAll({
      Carrots: 'produce', 'Baby spinach': 'produce', Avocado: 'produce', Eggs: 'dairy', 'Greek yoghurt': 'dairy',
      Butter: 'dairy', 'Beef mince': 'meat', Bacon: 'meat', Prawns: 'meat', 'Sourdough loaf': 'bakery', Wraps: 'bakery',
      'Olive oil': 'pantry', 'Tinned tomatoes': 'pantry', 'Peanut butter': 'pantry', Flour: 'pantry', Cereal: 'pantry',
      'Ice cream': 'frozen', 'Frozen peas': 'frozen', 'Fish fingers': 'frozen', Coffee: 'beverages', 'Tea bags': 'beverages',
      'Sparkling water': 'beverages', Wine: 'beverages',
    });
  });

  it('covers cleaning, household, personal care, pet and pharmacy', () => {
    expectAll({
      Bleach: 'cleaning', 'Dishwasher tablets': 'cleaning', Sponges: 'cleaning', 'Fabric softener': 'cleaning',
      'Toilet cleaner': 'cleaning', 'Toilet paper': 'household', 'Paper towel': 'household', 'Bin liners': 'household',
      'Cling wrap': 'household', 'Light globes': 'household', Tissues: 'household',
      Conditioner: 'personal', Deodorant: 'personal', 'Body wash': 'personal', Razors: 'personal', Nappies: 'personal',
      'Cat litter': 'pet', 'Dog treats': 'pet', 'Kitten food': 'pet', 'Bird seed': 'pet',
      Panadol: 'health', 'Band-Aids': 'health', 'Vitamin D': 'health', 'Cough syrup': 'health',
    });
  });

  it('ignores quantities and measurement units', () => {
    expectAll({
      '2 litres of milk': 'dairy', '500g chicken mince': 'meat', '2 packs of toilet paper': 'household',
      '1 bottle of dishwashing liquid': 'cleaning', 'eggs x12': 'dairy', '3 kg potatoes': 'produce', 'Milk 2L': 'dairy',
    });
    expect(productKey('2 packs of toilet paper')).toBe('toilet paper');
  });

  it('understands plurals, synonyms and Australian terms', () => {
    expectAll({
      Tomato: 'produce', Tomatoes: 'produce', Capsicum: 'produce', Zucchini: 'produce', Rockmelon: 'produce',
      Coriander: 'produce', 'Spring onions': 'produce', Snags: 'meat', Chook: 'meat', Barramundi: 'meat', Devon: 'meat',
      Vegemite: 'pantry', 'Weet-Bix': 'pantry', 'Tim Tams': 'pantry', Lollies: 'pantry', Bikkies: 'pantry',
      Cordial: 'beverages', Milo: 'beverages', 'Loo roll': 'household', Alfoil: 'household', 'Glad wrap': 'household',
      'Washing up liquid': 'cleaning', Chux: 'cleaning', Yogurt: 'dairy', Yoghurt: 'dairy', Haloumi: 'dairy',
      'Icy poles': 'frozen', 'Dim sims': 'frozen', Thongs: 'other',
    });
  });

  it('uses context: the longest product name, describing words, then the head word', () => {
    expectAll({
      'Chicken stock': 'pantry', 'Milk chocolate': 'pantry', 'Coconut milk': 'pantry', 'Tomato sauce': 'pantry',
      'Apple juice': 'beverages', 'Hot dog buns': 'bakery', 'Hot dogs': 'meat', 'Frozen berries': 'frozen',
      'Frozen chicken nuggets': 'frozen', 'Tinned corn': 'pantry', 'Cat biscuits': 'pet', 'Dog shampoo': 'pet',
      'Baby wipes': 'personal', 'Sausage rolls': 'bakery', 'Toilet rolls': 'household', 'Instant coffee': 'beverages',
      'Smoked salmon': 'meat', 'Almond milk': 'dairy', 'Free range eggs': 'dairy', 'Full cream milk 2L': 'dairy',
    });
  });

  it('forgives small spelling mistakes but does not stretch to short or unrelated words', () => {
    expectAll({
      Bannana: 'produce', Brocoli: 'produce', Tomatoe: 'produce', Shampo: 'personal', Toothpast: 'personal',
      Yoghert: 'dairy', Sausges: 'meat', 'Dishwashing liqiud': 'cleaning',
    });
    expect(classifyName('Brocoli').source).toBe('spelling');
    expectAll({ Paper: 'other', 'Printer paper': 'other', Mice: 'other' });
  });

  it('puts unknown products in Other instead of guessing', () => {
    for (const name of ['Thingamajig', 'Birthday present for Sam', 'USB cable', 'Zxqv', '']) {
      expect(classifyName(name)).toEqual({ categoryId: 'other', source: 'none' });
    }
  });
});

describe('learning from corrections', () => {
  it('applies a correction to future matching products, ahead of the built-in rules', () => {
    let d = defaultData();
    expect(autoCategory(d, 'Almond milk')).toBe('dairy');
    d = learnCategory(d, 'Almond milk', 'beverages');
    expect(categorise(d, '2 cartons almond milk')).toEqual({ categoryId: 'beverages', source: 'learned' });
    expect(autoCategory(d, 'almond milks')).toBe('beverages');
    expect(autoCategory(d, 'Milk')).toBe('dairy'); // only that product changes
    // Unknown items can be taught too.
    d = learnCategory(d, 'USB cable', 'household');
    expect(autoCategory(d, 'usb cables')).toBe('household');
    // Putting it back to what the dictionary says removes the rule again.
    d = learnCategory(d, 'Almond milk', 'dairy');
    expect(d.categoryRules['almond milk']).toBeUndefined();
    expect(forgetCategoryRule(d, 'usb cable').categoryRules).toEqual({});
  });

  it('can be switched off, and follows custom and deleted categories', () => {
    const off = updateSettings(defaultData(), { rememberCategories: false });
    expect(learnCategory(off, 'Almond milk', 'beverages').categoryRules).toEqual({});
    let d = addCategory(defaultData(), 'Garden');
    const garden = d.categories.find((c) => c.name === 'Garden')!.id;
    d = learnCategory(d, 'Potting mix', garden);
    expect(autoCategory(d, 'potting mix')).toBe(garden);
    d = deleteCategory(d, garden);
    expect(d.categoryRules).toEqual({});
    expect(autoCategory(d, 'potting mix')).toBe('other');
  });

  it('reuses the category a product was last bought under', () => {
    let d = addItem(defaultData(), { name: 'Kombucha', quantity: 1, unit: 'bottles', categoryId: 'health', priority: 'normal' }, NOW, 'k');
    d = purchaseItem(d, 'k', NOW);
    expect(categorise(d, 'kombucha')).toEqual({ categoryId: 'health', source: 'history' });
  });

  it('persists rules through save, export, import and the version upgrade', () => {
    let d = learnCategory(defaultData(), 'Almond milk', 'beverages');
    d = updateSettings(d, { collapsedCategories: ['dairy'], showEmptyCategories: true });
    const back = parseImport(exportJson(d));
    expect(back.ok && back.data.categoryRules).toEqual({ 'almond milk': 'beverages' });
    expect(back.ok && back.data.settings.collapsedCategories).toEqual(['dairy']);
    expect(sanitize(JSON.parse(JSON.stringify(d))).categoryRules).toEqual(d.categoryRules);
    // An older save: existing items and their categories are untouched, and the new category appears.
    const old = sanitize({ version: 2, items: [{ id: 'a', name: 'Milk', categoryId: 'other' }, { id: 'b', name: 'Bread', categoryId: 'bakery' }], categoryRules: { x: 'nope' } });
    expect(old.version).toBeGreaterThanOrEqual(3);
    expect(old.items.map((i) => i.categoryId)).toEqual(['other', 'bakery']);
    expect(old.categories.some((c) => c.id === 'household')).toBe(true);
    expect(old.categoryRules).toEqual({});
  });
});

describe('categorisation across the app', () => {
  it('categorises pasted lists and keeps categories through deferral and recurrence', () => {
    let d = addParsed(defaultData(), parseList('2 litres of milk\nbannanas\ndishwashing liquid\nwidget'), NOW);
    expect(d.items.map((i) => [i.name, i.categoryId])).toEqual([
      ['Milk', 'dairy'], ['Bannanas', 'produce'], ['Dishwashing liquid', 'cleaning'], ['Widget', 'other'],
    ]);
    const id = d.items[2].id;
    d = deferItem(d, id, '2026-11-22', '', NOW);
    d = processDue(d, new Date(2026, 10, 22, 9));
    expect(d.items.find((i) => i.id === id)).toMatchObject({ status: 'active', categoryId: 'cleaning' });
    d = restoreItem(deferItem(d, id, null, '', NOW), id);
    expect(d.items.find((i) => i.id === id)?.categoryId).toBe('cleaning');

    d = addRecurring(d, {
      name: 'Dog food', quantity: 1, unit: 'packs', categoryId: autoCategory(d, 'Dog food'),
      frequency: { kind: 'monthly' }, nextDue: '2026-11-20',
    }, NOW, undefined, 'r');
    d = addRecurringToList(d, 'r', NOW);
    expect(d.items.find((i) => i.recurringId === 'r')?.categoryId).toBe('pet');
  });

  it('offers to sort items left in Other, without touching anything else', () => {
    let d = defaultData();
    for (const [i, name] of ['Milk', 'Widget', 'Bread'].entries()) {
      d = addItem(d, { name, quantity: 1, unit: 'units', categoryId: i === 2 ? 'frozen' : 'other', priority: 'normal' }, NOW, name);
    }
    expect(sortableOther(d)).toBe(1);
    d = sortOther(d);
    expect(d.items.map((i) => i.categoryId)).toEqual(['dairy', 'other', 'frozen']);
    expect(sortableOther(d)).toBe(0);
  });
});
