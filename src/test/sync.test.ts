import { describe, expect, it } from 'vitest';
import { combine, decide } from '../lib/sync';
import { defaultData } from '../lib/storage';
import { addItem, deleteItem, learnBarcode, saveRecipe } from '../state/actions';

const NOW = new Date(2026, 10, 18, 10);
const item = (name: string) => ({ name, quantity: 1, unit: 'units' as const, categoryId: 'other', priority: 'normal' as const });

describe('sync decisions', () => {
  const remote = { savedAt: '2026-11-18T01:00:00.000Z' };
  it('uploads when there is no remote copy yet', () => {
    expect(decide({ remoteStamp: null, dirty: false }, null)).toBe('push');
  });
  it('does nothing when neither side changed', () => {
    expect(decide({ remoteStamp: remote.savedAt, dirty: false }, remote)).toBe('none');
  });
  it('uploads local changes when the remote copy has not moved', () => {
    expect(decide({ remoteStamp: remote.savedAt, dirty: true }, remote)).toBe('push');
  });
  it('downloads when only another device changed', () => {
    expect(decide({ remoteStamp: '2026-11-17T00:00:00.000Z', dirty: false }, remote)).toBe('pull');
    expect(decide({ remoteStamp: null, dirty: false }, remote)).toBe('pull'); // a fresh second device
  });
  it('asks when both sides changed, instead of overwriting either', () => {
    expect(decide({ remoteStamp: '2026-11-17T00:00:00.000Z', dirty: true }, remote)).toBe('conflict');
    expect(decide({ remoteStamp: null, dirty: true }, remote)).toBe('conflict'); // second device that already has data
  });
});

describe('combining two diverged copies', () => {
  it('keeps every record from both, preferring this device for shared ones', () => {
    const base = addItem(defaultData(), item('Milk'), NOW, 'milk');
    const mine = addItem({ ...base, items: base.items.map((i) => ({ ...i, quantity: 3 })) }, item('Bread'), NOW, 'bread');
    let theirs = addItem(base, item('Eggs'), NOW, 'eggs');
    theirs = learnBarcode(theirs, '9300633000011', 'Eggs');
    theirs = saveRecipe(theirs, { id: 'm1', name: 'Omelette', ingredients: [{ name: 'Eggs', quantity: 3, unit: 'units' }] });
    const merged = combine(mine, theirs);
    expect(merged.items.map((i) => i.id).sort()).toEqual(['bread', 'eggs', 'milk']);
    expect(merged.items.find((i) => i.id === 'milk')?.quantity).toBe(3);
    expect(merged.barcodes['9300633000011']).toBe('Eggs');
    expect(merged.recipes).toHaveLength(1);
    expect(merged.categories).toHaveLength(base.categories.length);
  });
  it('can bring back something deleted on one device (documented limitation)', () => {
    const base = addItem(defaultData(), item('Milk'), NOW, 'milk');
    expect(combine(deleteItem(base, 'milk'), base).items).toHaveLength(1);
  });
});
