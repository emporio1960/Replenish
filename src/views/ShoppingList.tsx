import { useMemo, useState } from 'react';
import {
  CalendarClock, Check, ChevronDown, ClipboardList, Ellipsis, ListChecks, Minus, Plus, Repeat, ScanBarcode, Search,
  ShoppingCart, Undo2,
} from 'lucide-react';
import type { Category, Priority, ShoppingItem, SortKey } from '../types';
import { listTotals } from '../lib/analytics';
import { categoryById } from '../lib/categories';
import { formatMoney, formatQty, plural, times } from '../lib/format';
import { clearPurchased, purchaseItem, sortableOther, sortOther, undoPurchase, updateItem, updateSettings } from '../state/actions';
import { useStore } from '../state/store';
import { CategoryIcon, Chip, EmptyState, PageHeader, ProgressBar } from '../components/ui';

const PRIORITY_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

export function sortItems(items: ShoppingItem[], sort: SortKey, categories: Category[]): ShoppingItem[] {
  const order = new Map(categories.map((c, i) => [c.id, i]));
  const byName = (a: ShoppingItem, b: ShoppingItem) => a.name.localeCompare(b.name);
  const list = [...items];
  switch (sort) {
    case 'name':
      return list.sort(byName);
    case 'added':
      return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || byName(a, b));
    case 'priority':
      return list.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byName(a, b));
    default:
      return list.sort(
        (a, b) => (order.get(a.categoryId) ?? 999) - (order.get(b.categoryId) ?? 999) || byName(a, b),
      );
  }
}

export function groupByCategory(
  items: ShoppingItem[], categories: Category[], includeEmpty = false,
): { category: Category; items: ShoppingItem[] }[] {
  const groups = new Map<string, ShoppingItem[]>();
  for (const i of items) {
    const id = categoryById(categories, i.categoryId).id;
    groups.set(id, [...(groups.get(id) ?? []), i]);
  }
  return categories
    .filter((c) => includeEmpty || groups.has(c.id))
    .map((c) => ({ category: c, items: groups.get(c.id) ?? [] }));
}

function stepFor(item: ShoppingItem): number {
  return item.unit === 'g' || item.unit === 'ml' ? 50 : 1;
}

function ItemRow({ item, showIcon }: { item: ShoppingItem; showIcon: boolean }) {
  const { data, apply, openModal, toast } = useStore();
  const category = categoryById(data.categories, item.categoryId);
  const done = item.status === 'purchased';
  const store = data.stores.find((s) => s.id === item.storeId);
  const step = stepFor(item);
  const price = done ? (item.actualPrice ?? item.estimatedPrice) : item.estimatedPrice;

  function toggle() {
    if (done) {
      apply((d) => undoPurchase(d, item.id));
    } else {
      apply((d) => purchaseItem(d, item.id, new Date()));
      toast(`Purchased ${item.name}`, { label: 'Undo', run: () => apply((d) => undoPurchase(d, item.id)) });
    }
  }

  return (
    <li className={`row item-row ${done ? 'is-done' : ''}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Undo purchase of ${item.name}` : `Mark ${item.name} as purchased`}
        className="check"
        onClick={toggle}
      >
        {done && <Check size={16} strokeWidth={3} aria-hidden="true" />}
      </button>
      {showIcon && <CategoryIcon category={category} size={32} />}
      <div className="row-body">
        <span className="row-title">
          {item.priority === 'high' && !done && <span className="prio" title="High priority" aria-label="High priority" />}
          {item.name}
        </span>
        <span className="row-meta">
          <span className="qty-inline">{formatQty(item.quantity, item.unit)}</span>
          {price !== undefined && <span>{formatMoney(price, data.settings.currency)}{done && item.actualPrice !== undefined ? ' paid' : ''}</span>}
          {store && <span>{store.name}</span>}
          {item.notes && <span className="note-text">{item.notes}</span>}
        </span>
        {(item.recurringId || item.deferCount > 0 || item.returnedAt || (item.priority === 'low' && !done)) && (
          <span className="row-chips">
            {item.recurringId && <Chip tone="accent"><Repeat size={12} aria-hidden="true" /> Recurring</Chip>}
            {item.returnedAt && !done && <Chip tone="good"><Undo2 size={12} aria-hidden="true" /> Back from deferral</Chip>}
            {item.deferCount > 0 && !done && (
              <Chip tone={item.deferCount >= 2 ? 'warn' : 'neutral'}>
                <CalendarClock size={12} aria-hidden="true" /> Deferred {times(item.deferCount)}
              </Chip>
            )}
            {item.priority === 'low' && !done && <Chip>Low priority</Chip>}
          </span>
        )}
      </div>
      {!done && (
        <div className="stepper" role="group" aria-label={`Quantity of ${item.name}`}>
          <button
            type="button"
            aria-label="Decrease quantity"
            disabled={item.quantity <= step}
            onClick={() => apply((d) => updateItem(d, item.id, { quantity: Number((item.quantity - step).toFixed(2)) }))}
          >
            <Minus size={15} />
          </button>
          <span>{formatQty(item.quantity, item.unit)}</span>
          <button
            type="button"
            aria-label="Increase quantity"
            onClick={() => apply((d) => updateItem(d, item.id, { quantity: Number((item.quantity + step).toFixed(2)) }))}
          >
            <Plus size={15} />
          </button>
        </div>
      )}
      <button
        type="button"
        className="icon-btn"
        aria-label={`More actions for ${item.name}`}
        onClick={() => openModal(done ? { type: 'item', item } : { type: 'itemActions', itemId: item.id })}
      >
        <Ellipsis size={20} />
      </button>
    </li>
  );
}

export function ShoppingList() {
  const { data, apply, go, openModal, toast } = useStore();
  const { currency, budget, listSort, groupByCategory: grouped } = data.settings;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [priority, setPriority] = useState<'all' | Priority>('all');
  const [showDone, setShowDone] = useState(true);
  const [store, setStore] = useState('all');

  const active = data.items.filter((i) => i.status === 'active');
  const purchased = data.items.filter((i) => i.status === 'purchased');
  const totals = listTotals(data);
  const filtering = query.trim() !== '' || category !== 'all' || priority !== 'all' || store !== 'all';

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (i: ShoppingItem) =>
      (q === '' || i.name.toLowerCase().includes(q) || (i.notes ?? '').toLowerCase().includes(q)) &&
      (category === 'all' || i.categoryId === category) &&
      (priority === 'all' || i.priority === priority) &&
      (store === 'all' || (i.storeId ?? '') === store);
  }, [query, category, priority, store]);

  const visible = sortItems(active.filter(matches), listSort, data.categories);
  const visibleDone = sortItems(purchased.filter(matches), 'added', data.categories);
  const { collapsedCategories: collapsed, showEmptyCategories } = data.settings;
  const groups = grouped ? groupByCategory(visible, data.categories, showEmptyCategories && !filtering) : null;
  const sortable = sortableOther(data);
  const toggleGroup = (id: string) =>
    apply((d) => {
      const now = d.settings.collapsedCategories;
      return updateSettings(d, { collapsedCategories: now.includes(id) ? now.filter((c) => c !== id) : [...now, id] });
    });
  const total = active.length + purchased.length;

  return (
    <>
      <PageHeader
        title="Shopping List"
        subtitle={
          total === 0
            ? 'Nothing on the list yet'
            : `${plural(active.length, 'item')} to buy, ${purchased.length} purchased`
        }
        actions={
          <>
            <button type="button" className="btn" onClick={() => go('shop')} disabled={total === 0}>
              <ShoppingCart size={17} aria-hidden="true" /> Start shopping
            </button>
            <button type="button" className="btn btn-primary" onClick={() => openModal({ type: 'item' })}>
              <Plus size={17} aria-hidden="true" /> Add item
            </button>
            <button type="button" className="btn" onClick={() => openModal({ type: 'paste' })}>
              <ClipboardList size={17} aria-hidden="true" /> Add several
            </button>
            <button type="button" className="btn" onClick={() => openModal({ type: 'scan' })}>
              <ScanBarcode size={17} aria-hidden="true" /> Scan
            </button>
          </>
        }
      />

      {total > 0 && (
        <section className="card list-summary">
          <div className="budget-line">
            <span>{purchased.length} of {total} purchased</span>
            <span>
              {budget !== null
                ? `${formatMoney(totals.total, currency)} of ${formatMoney(budget, currency)} budget`
                : `Estimated ${formatMoney(totals.total, currency)}`}
            </span>
          </div>
          <ProgressBar value={purchased.length} max={total} tone="good" label="Shopping list completion" />
          {budget !== null && (
            <>
              <ProgressBar value={totals.total} max={budget} tone={totals.total > budget ? 'alert' : 'accent'} label="Estimated spending against budget" />
              {totals.total > budget && (
                <p className="fine alert-text">Estimated spending is {formatMoney(totals.total - budget, currency)} over budget.</p>
              )}
            </>
          )}
        </section>
      )}

      {total > 0 && (
        <div className="filters">
          <label className="filter filter-search">
            <span className="sr-only">Search items</span>
            <Search size={16} aria-hidden="true" />
            <input type="search" value={query} placeholder="Search items and notes" onChange={(e) => setQuery(e.target.value)} />
          </label>
          <label className="filter">
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">All categories</option>
              {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="filter">
            <span>Priority</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value as 'all' | Priority)}>
              <option value="all">Any priority</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
          </label>
          {data.stores.length > 0 && (
            <label className="filter">
              <span>Store</span>
              <select value={store} onChange={(e) => setStore(e.target.value)}>
                <option value="all">All stores</option>
                <option value="">No store set</option>
                {data.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          )}
          <label className="filter">
            <span>Sort by</span>
            <select value={listSort} onChange={(e) => apply((d) => updateSettings(d, { listSort: e.target.value as SortKey }))}>
              <option value="category">Category</option>
              <option value="name">Name</option>
              <option value="added">Date added</option>
              <option value="priority">Priority</option>
            </select>
          </label>
          <label className="filter filter-check">
            <input type="checkbox" checked={grouped} onChange={(e) => apply((d) => updateSettings(d, { groupByCategory: e.target.checked }))} />
            <span>Group by category</span>
          </label>
        </div>
      )}

      {sortable > 0 && (
        <div className="card sort-offer">
          <span>{plural(sortable, 'item')} in Other can be sorted into {sortable === 1 ? 'its category' : 'categories'} automatically.</span>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => { apply(sortOther); toast(`Sorted ${plural(sortable, 'item')} into categories`); }}
          >
            Sort {sortable === 1 ? 'it' : 'them'}
          </button>
        </div>
      )}

      {total === 0 ? (
        <div className="card">
          <EmptyState
            icon={ListChecks}
            title="Your shopping list is empty"
            body="Add the things you need to buy. You can defer them, make them recurring, or tick them off as you shop."
            action={<button type="button" className="btn btn-primary" onClick={() => openModal({ type: 'item' })}>Add item</button>}
          />
        </div>
      ) : visible.length === 0 && visibleDone.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Search}
            title="No items match"
            body="Try a different search, or clear the filters."
            action={<button type="button" className="btn" onClick={() => { setQuery(''); setCategory('all'); setPriority('all'); setStore('all'); }}>Clear filters</button>}
          />
        </div>
      ) : (
        <>
          {visible.length === 0 && !filtering && (
            <div className="card">
              <EmptyState icon={Check} title="Everything is in the basket" body="Clear the purchased items when you are home, or add more." />
            </div>
          )}
          {groups
            ? groups.map((g) => (
                <section key={g.category.id} className="group">
                  <h2 className="group-head">
                    <button
                      type="button"
                      className="disclosure group-toggle"
                      aria-expanded={!collapsed.includes(g.category.id)}
                      onClick={() => toggleGroup(g.category.id)}
                    >
                      <ChevronDown size={18} className={collapsed.includes(g.category.id) ? 'is-closed' : ''} aria-hidden="true" />
                      <CategoryIcon category={g.category} size={26} />
                      {g.category.name}
                      <span className="count">{g.items.length}</span>
                    </button>
                  </h2>
                  {!collapsed.includes(g.category.id) && g.items.length > 0 && (
                    <ul className="card rows">
                      {g.items.map((i) => <ItemRow key={i.id} item={i} showIcon={false} />)}
                    </ul>
                  )}
                </section>
              ))
            : visible.length > 0 && (
                <ul className="card rows">
                  {visible.map((i) => <ItemRow key={i.id} item={i} showIcon />)}
                </ul>
              )}

          {visibleDone.length > 0 && (
            <section className="group">
              <div className="group-head group-head-split">
                <button type="button" className="disclosure" aria-expanded={showDone} onClick={() => setShowDone((s) => !s)}>
                  <ChevronDown size={18} className={showDone ? '' : 'is-closed'} aria-hidden="true" />
                  Purchased <span className="count">{visibleDone.length}</span>
                </button>
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    openModal({
                      type: 'confirm',
                      title: 'Clear purchased items?',
                      body: `${plural(purchased.length, 'purchased item')} will be removed from the list. They stay in your purchase history.`,
                      confirmLabel: 'Clear purchased',
                      onConfirm: () => { apply(clearPurchased); toast('Purchased items cleared'); },
                    })
                  }
                >
                  Clear purchased
                </button>
              </div>
              {showDone && (
                <ul className="card rows">
                  {visibleDone.map((i) => <ItemRow key={i.id} item={i} showIcon={false} />)}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
