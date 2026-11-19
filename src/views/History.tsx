import { useState } from 'react';
import { Pencil, Plus, ReceiptText, Repeat, Search, Trash, TrendingDown, TrendingUp } from 'lucide-react';
import type { PurchaseRecord } from '../types';
import { defaultRange, filterHistory, type RangeFilter } from '../lib/analytics';
import { categoryById } from '../lib/categories';
import { asDay, formatDate, formatTime, longDate } from '../lib/dates';
import { formatMoney, formatQty, plural } from '../lib/format';
import { buildItemStats, priceFlag } from '../lib/replenishment';
import { addItem, deleteHistory, resolveCategory } from '../state/actions';
import { useStore } from '../state/store';
import { RangeControls } from '../components/RangeControls';
import { CategoryIcon, Chip, EmptyState, PageHeader } from '../components/ui';

export function History() {
  const { data, today, apply, go, openModal, toast } = useStore();
  const { currency, dateFormat, time24 } = data.settings;
  const [filter, setFilter] = useState<RangeFilter>(() => defaultRange(today));
  const [query, setQuery] = useState('');

  const stats = new Map(buildItemStats(data.history).map((s) => [s.key, s]));
  const q = query.trim().toLowerCase();
  const records = filterHistory(data.history, filter, today)
    .filter((r) => q === '' || r.name.toLowerCase().includes(q))
    .sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt));
  const spent = records.reduce((s, r) => s + (r.price ?? 0), 0);

  const days = new Map<string, PurchaseRecord[]>();
  for (const r of records) {
    const day = asDay(r.purchasedAt);
    days.set(day, [...(days.get(day) ?? []), r]);
  }

  return (
    <>
      <PageHeader
        title="Purchase History"
        subtitle={
          data.history.length === 0
            ? 'Everything you tick off is recorded here'
            : `${plural(records.length, 'purchase')}, ${formatMoney(spent, currency)} in this view`
        }
      />
      {data.history.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={ReceiptText}
            title="No purchases recorded"
            body="When you mark an item as purchased, it is saved here with its date, quantity and price. This history is what powers suggestions and analytics."
            action={<button type="button" className="btn" onClick={() => go('list')}>Open shopping list</button>}
          />
        </div>
      ) : (
        <>
          <div className="filters">
            <label className="filter filter-search">
              <span className="sr-only">Search purchases</span>
              <Search size={16} aria-hidden="true" />
              <input type="search" value={query} placeholder="Search purchases" onChange={(e) => setQuery(e.target.value)} />
            </label>
          </div>
          <RangeControls filter={filter} onChange={setFilter} categories={data.categories} />
          {records.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={Search}
                title="No purchases match"
                body="Try a longer period, another category or a different search."
                action={
                  <button type="button" className="btn" onClick={() => { setQuery(''); setFilter({ ...defaultRange(today), preset: 'all' }); }}>
                    Show all purchases
                  </button>
                }
              />
            </div>
          ) : (
            [...days].map(([day, list]) => (
              <section key={day} className="group">
                <h2 className="group-head">
                  {longDate(day)}
                  <span className="count">{formatDate(day, dateFormat)}</span>
                  <span className="group-total">{formatMoney(list.reduce((s, r) => s + (r.price ?? 0), 0), currency)}</span>
                </h2>
                <ul className="card rows">
                  {list.map((r) => (
                    <li key={r.id} className="row row-tight">
                      <span className="hide-s"><CategoryIcon category={categoryById(data.categories, r.categoryId)} size={32} /></span>
                      <div className="row-body">
                        <button type="button" className="row-title title-link" onClick={() => openModal({ type: 'product', productKey: r.key })}>
                          {r.name}
                        </button>
                        <span className="row-meta">
                          <span>{formatQty(r.quantity, r.unit)}</span>
                          <span>{formatTime(r.purchasedAt, time24)}</span>
                          <span className="hide-s">{categoryById(data.categories, r.categoryId).name}</span>
                        </span>
                        {(r.recurring || priceFlag(r.price, r.quantity, r.unit, stats.get(r.key))) && (
                          <span className="row-chips">
                            {r.recurring && <Chip tone="accent"><Repeat size={12} aria-hidden="true" /> Recurring</Chip>}
                            {priceFlag(r.price, r.quantity, r.unit, stats.get(r.key)) === 'above' && (
                              <Chip tone="warn"><TrendingUp size={12} aria-hidden="true" /> Above usual price</Chip>
                            )}
                            {priceFlag(r.price, r.quantity, r.unit, stats.get(r.key)) === 'below' && (
                              <Chip tone="good"><TrendingDown size={12} aria-hidden="true" /> Below usual price</Chip>
                            )}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="price-btn"
                        aria-label={`Edit price paid for ${r.name}`}
                        onClick={() => openModal({ type: 'price', historyId: r.id })}
                      >
                        {r.price !== undefined ? formatMoney(r.price, currency) : 'Add price'}
                        <Pencil size={13} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Add ${r.name} to the shopping list again`}
                        title="Buy again"
                        onClick={() => {
                          apply((d) =>
                            addItem(d, {
                              name: r.name, quantity: r.quantity, unit: r.unit, estimatedPrice: r.price,
                              categoryId: resolveCategory(d, r.name, r.categoryId), priority: 'normal',
                            }, new Date()),
                          );
                          toast(`Added ${r.name} to your list`);
                        }}
                      >
                        <Plus size={19} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Delete the record of ${r.name}`}
                        title="Delete record"
                        onClick={() =>
                          openModal({
                            type: 'confirm',
                            title: 'Delete this purchase record?',
                            body: `${r.name}, bought on ${formatDate(r.purchasedAt, dateFormat)}, will be removed from history and no longer counted in suggestions or analytics.`,
                            confirmLabel: 'Delete record',
                            danger: true,
                            onConfirm: () => { apply((d) => deleteHistory(d, r.id)); toast('Purchase record deleted'); },
                          })
                        }
                      >
                        <Trash size={17} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </>
  );
}
