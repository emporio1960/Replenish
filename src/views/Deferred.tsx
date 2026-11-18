import { CalendarClock, Undo2 } from 'lucide-react';
import type { ShoppingItem } from '../types';
import { categoryById } from '../lib/categories';
import { formatDate, relativeDay } from '../lib/dates';
import { formatQty, plural, times } from '../lib/format';
import { deleteItem, restoreItem } from '../state/actions';
import { useStore } from '../state/store';
import { CategoryIcon, Chip, EmptyState, PageHeader } from '../components/ui';

export function Deferred() {
  const { data, today, apply, go, openModal, toast } = useStore();
  const fmt = data.settings.dateFormat;
  const items = data.items
    .filter((i) => i.status === 'deferred')
    .sort((a, b) => {
      const x = a.deferral?.until ?? '9999-12-31';
      const y = b.deferral?.until ?? '9999-12-31';
      return x.localeCompare(y) || a.name.localeCompare(b.name);
    });

  const confirmDelete = (item: ShoppingItem) =>
    openModal({
      type: 'confirm',
      title: `Delete ${item.name}?`,
      body: 'This removes the deferred item permanently. It will not return to your shopping list.',
      confirmLabel: 'Delete permanently',
      danger: true,
      onConfirm: () => { apply((d) => deleteItem(d, item.id)); toast(`Deleted ${item.name}`); },
    });

  return (
    <>
      <PageHeader
        title="Deferred"
        subtitle={
          items.length === 0
            ? 'Purchases you have put off until later'
            : `${plural(items.length, 'purchase')} put off until later`
        }
      />
      {items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={CalendarClock}
            title="Nothing is deferred"
            body="When you would rather buy something later, defer it from the shopping list. It waits here and returns to the list automatically on the date you choose."
            action={<button type="button" className="btn" onClick={() => go('list')}>Open shopping list</button>}
          />
        </div>
      ) : (
        <ul className="cards">
          {items.map((item) => {
            const until = item.deferral?.until ?? null;
            return (
              <li key={item.id} className="card detail-card">
                <div className="detail-head">
                  <CategoryIcon category={categoryById(data.categories, item.categoryId)} />
                  <div className="row-body">
                    <span className="row-title">{item.name}</span>
                    <span className="row-meta">{formatQty(item.quantity, item.unit)}</span>
                  </div>
                  {item.deferCount >= 2 && <Chip tone="warn">Deferred {times(item.deferCount)}</Chip>}
                </div>
                <dl className="facts">
                  <div><dt>Added</dt><dd>{formatDate(item.createdAt, fmt)}</dd></div>
                  <div><dt>Deferred</dt><dd>{item.deferral ? formatDate(item.deferral.deferredAt, fmt) : 'Unknown'}</dd></div>
                  <div>
                    <dt>Returns</dt>
                    <dd>{until ? `${formatDate(until, fmt)} (${relativeDay(until, today)})` : 'Not scheduled (indefinite)'}</dd>
                  </div>
                  <div><dt>Reason</dt><dd>{item.deferral?.reason ?? 'None given'}</dd></div>
                </dl>
                <div className="card-actions">
                  <button
                    type="button"
                    className="btn btn-small btn-primary"
                    onClick={() => { apply((d) => restoreItem(d, item.id)); toast(`${item.name} restored to your list`); }}
                  >
                    <Undo2 size={15} aria-hidden="true" /> Restore now
                  </button>
                  <button type="button" className="btn btn-small" onClick={() => openModal({ type: 'defer', itemId: item.id })}>
                    Change date
                  </button>
                  <button type="button" className="btn btn-small btn-quiet danger-text" onClick={() => confirmDelete(item)}>
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
