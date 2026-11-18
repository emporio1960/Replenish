import { useState, type FormEvent } from 'react';
import { ArrowLeft, Check, Plus, ScanBarcode, X } from 'lucide-react';
import type { ShoppingItem } from '../types';
import { storeCategoryOrder } from '../lib/categories';
import { findDuplicates } from '../lib/duplicates';
import { formatMoney, formatQty, plural } from '../lib/format';
import { addItem, clearPurchased, purchaseItem, undoPurchase, updateSettings } from '../state/actions';
import { useStore } from '../state/store';
import { useDeleteItem } from '../components/Modals';
import { CategoryIcon, ProgressBar } from '../components/ui';
import { groupByCategory, sortItems } from './ShoppingList';

/** A stripped-back list for use in the shop: big targets, one hand, no editing. */
export function ShoppingMode() {
  const { data, apply, go, toast, openModal } = useStore();
  const remove = useDeleteItem();
  const [name, setName] = useState('');
  const { currency } = data.settings;

  // With a store chosen, show what is bought there (plus anything with no store set)
  // and walk the categories in that store's aisle order.
  const store = data.stores.find((s) => s.id === data.settings.shoppingStoreId);
  const here = (i: ShoppingItem) => !store || !i.storeId || i.storeId === store.id;
  const aisles = storeCategoryOrder(store, data.categories);
  const elsewhere = data.items.filter((i) => i.status === 'active' && !here(i)).length;
  const active = sortItems(data.items.filter((i) => i.status === 'active' && here(i)), 'priority', data.categories);
  const purchased = data.items
    .filter((i) => i.status === 'purchased' && here(i))
    .sort((a, b) => (b.purchasedAt ?? '').localeCompare(a.purchasedAt ?? ''));
  const total = active.length + purchased.length;
  const remaining = active.reduce((s, i) => s + (i.estimatedPrice ?? 0), 0);
  const groups = groupByCategory(active, aisles);

  function add(itemName: string) {
    apply((d) =>
      addItem(d, { name: itemName, quantity: 1, unit: 'units', categoryId: d.settings.defaultCategoryId, priority: 'normal', storeId: store?.id }, new Date()),
    );
    toast(`Added ${itemName}`);
  }

  function quickAdd(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setName('');
    const dup = findDuplicates(trimmed, data.items)[0];
    if (dup) {
      toast(
        dup.status === 'deferred' ? `${dup.name} is already deferred` : `${dup.name} is already on your list`,
        { label: 'Add anyway', run: () => add(trimmed) },
      );
    } else {
      add(trimmed);
    }
  }

  const row = (item: ShoppingItem) => {
    const done = item.status === 'purchased';
    return (
      <li key={item.id} className={`shop-row ${done ? 'is-done' : ''}`}>
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          className="shop-check"
          onClick={() => apply((d) => (done ? undoPurchase(d, item.id) : purchaseItem(d, item.id, new Date())))}
        >
          <span className="shop-box" aria-hidden="true">{done && <Check size={22} strokeWidth={3} />}</span>
          <span className="shop-text">
            <span className="shop-name">{item.name}</span>
            <span className="shop-qty">
              {formatQty(item.quantity, item.unit)}
              {item.notes ? `, ${item.notes}` : ''}
            </span>
          </span>
        </button>
        {!done && (
          <button type="button" className="icon-btn" aria-label={`Remove ${item.name} from the list`} onClick={() => remove(item)}>
            <X size={20} />
          </button>
        )}
      </li>
    );
  };

  return (
    <div className="shop">
      <header className="shop-head">
        <button type="button" className="btn btn-quiet" onClick={() => go('list')}>
          <ArrowLeft size={18} aria-hidden="true" /> Done shopping
        </button>
        <span className="shop-count" aria-live="polite">{active.length} left</span>
      </header>

      <section className="shop-progress" aria-label="Progress">
        <p className="basket-figure">
          {total === 0 ? 'Nothing on the list' : <><span>{purchased.length}</span> of {total} in the basket</>}
        </p>
        <ProgressBar value={purchased.length} max={Math.max(total, 1)} tone="good" label="Items purchased" />
        {total > 0 && (
          <p className="shop-sub">
            {active.length === 0 ? 'All done.' : `${plural(active.length, 'item')} left, about ${formatMoney(remaining, currency)} to go`}
          </p>
        )}
        {elsewhere > 0 && <p className="fine">{plural(elsewhere, 'item')} for other stores {elsewhere === 1 ? 'is' : 'are'} hidden.</p>}
      </section>

      {data.stores.length > 0 && (
        <label className="filter shop-store">
          <span>Shopping at</span>
          <select
            value={store?.id ?? ''}
            onChange={(e) => apply((d) => updateSettings(d, { shoppingStoreId: e.target.value || null }))}
          >
            <option value="">All stores</option>
            {data.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}

      <form className="shop-add" onSubmit={quickAdd}>
        <label className="sr-only" htmlFor="shop-add-input">Add an item</label>
        <input id="shop-add-input" value={name} maxLength={80} placeholder="Add an item" autoComplete="off" enterKeyHint="done" onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn btn-primary" aria-label="Add item" disabled={!name.trim()}>
          <Plus size={20} aria-hidden="true" />
        </button>
        <button type="button" className="btn" aria-label="Scan a barcode" onClick={() => openModal({ type: 'scan' })}>
          <ScanBarcode size={20} aria-hidden="true" />
        </button>
      </form>

      {groups.map((g) => (
        <section key={g.category.id} className="shop-group">
          <h2 className="group-head"><CategoryIcon category={g.category} size={26} /> {g.category.name}</h2>
          <ul className="shop-list">{g.items.map(row)}</ul>
        </section>
      ))}

      {purchased.length > 0 && (
        <section className="shop-group">
          <div className="group-head group-head-split">
            <h2>In the basket <span className="count">{purchased.length}</span></h2>
            {active.length === 0 && (
              <button type="button" className="link" onClick={() => { apply(clearPurchased); toast('Purchased items cleared'); go('list'); }}>
                Clear and finish
              </button>
            )}
          </div>
          <ul className="shop-list">{purchased.map(row)}</ul>
        </section>
      )}
    </div>
  );
}
