import { useState } from 'react';
import { BellOff, CalendarClock, ChevronRight, Pencil, Repeat, Trash, X } from 'lucide-react';
import type { ShoppingItem } from '../types';
import { pluralDays } from '../lib/dates';
import { formatQty, parseNumber } from '../lib/format';
import { frequencyFromDays } from '../lib/recurrence';
import {
  clearNotices, deleteItem, dismissNotice, restoreDeletedItem, setHistoryPrice, setReplenishPref,
} from '../state/actions';
import { useStore } from '../state/store';
import { DeferSheet } from './DeferSheet';
import { ItemForm } from './ItemForm';
import { RecurringForm } from './RecurringForm';
import { SECONDARY_NAV } from './nav';
import { EmptyState, Field, Modal } from './ui';

/** Deletes an item and offers an undo, so a slip of the thumb is recoverable. */
export function useDeleteItem(): (item: ShoppingItem) => void {
  const { apply, toast } = useStore();
  return (item) => {
    apply((d) => deleteItem(d, item.id));
    toast(`Deleted ${item.name}`, { label: 'Undo', run: () => apply((d) => restoreDeletedItem(d, item)) });
  };
}

function ItemActions({ itemId }: { itemId: string }) {
  const { data, openModal, closeModal } = useStore();
  const remove = useDeleteItem();
  const item = data.items.find((i) => i.id === itemId);
  if (!item) return null;
  return (
    <Modal title={item.name} onClose={closeModal}>
      <p className="lead">{formatQty(item.quantity, item.unit)}{item.notes ? `. ${item.notes}` : ''}</p>
      <div className="option-list">
        <button type="button" className="option" data-autofocus onClick={() => openModal({ type: 'item', item })}>
          <span className="option-main"><Pencil size={18} aria-hidden="true" /> Edit</span>
        </button>
        <button type="button" className="option" onClick={() => openModal({ type: 'defer', itemId })}>
          <span className="option-main"><CalendarClock size={18} aria-hidden="true" /> Defer</span>
        </button>
        {!item.recurringId && (
          <button
            type="button"
            className="option"
            onClick={() =>
              openModal({
                type: 'recurring',
                linkItemId: item.id,
                preset: {
                  name: item.name, quantity: item.quantity, unit: item.unit,
                  estimatedPrice: item.estimatedPrice, categoryId: item.categoryId, notes: item.notes,
                },
              })
            }
          >
            <span className="option-main"><Repeat size={18} aria-hidden="true" /> Make recurring</span>
          </button>
        )}
        <button type="button" className="option option-danger" onClick={() => { remove(item); closeModal(); }}>
          <span className="option-main"><Trash size={18} aria-hidden="true" /> Delete</span>
        </button>
      </div>
    </Modal>
  );
}

function AdjustInterval({ productKey }: { productKey: string }) {
  const { data, recs, today, apply, closeModal, toast, openModal } = useStore();
  const rec = recs.find((r) => r.key === productKey);
  const [days, setDays] = useState(String(rec?.usedInterval ?? 7));
  const [error, setError] = useState('');
  if (!rec) return null;
  const learned = Math.max(1, Math.round(rec.avgInterval ?? 7));
  return (
    <Modal
      title={`Adjust ${rec.name}`}
      onClose={closeModal}
      footer={
        <>
          <button type="button" className="btn btn-quiet" onClick={closeModal}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              const n = parseNumber(days);
              if (n === undefined || Number.isNaN(n) || n < 1 || n > 730) {
                setError('Enter a number of days between 1 and 730.');
                return;
              }
              apply((d) => setReplenishPref(d, productKey, { customIntervalDays: Math.round(n) }));
              toast(`${rec.name} now estimated every ${pluralDays(Math.round(n))}`);
              closeModal();
            }}
          >
            Save interval
          </button>
        </>
      }
    >
      <div className="form">
        <p className="lead">{rec.explanation}</p>
        <Field label="Days between purchases" error={error} hint={`Learned from your history: ${pluralDays(learned)}`}>
          <input data-autofocus value={days} inputMode="numeric" onChange={(e) => { setDays(e.target.value); setError(''); }} />
        </Field>
        <div className="stack">
          {data.replenishPrefs[productKey]?.customIntervalDays !== undefined && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                apply((d) => setReplenishPref(d, productKey, { customIntervalDays: undefined }));
                toast(`${rec.name} is back to the learned interval`);
                closeModal();
              }}
            >
              Use the learned interval
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={() =>
              openModal({
                type: 'recurring',
                preset: {
                  name: rec.name, quantity: rec.typicalQuantity, unit: rec.unit, categoryId: rec.categoryId,
                  estimatedPrice: rec.avgPrice !== undefined ? Math.round(rec.avgPrice * 100) / 100 : undefined,
                  frequency: frequencyFromDays(rec.usedInterval),
                  nextDue: rec.nextEstimated > today ? rec.nextEstimated : undefined,
                },
              })
            }
          >
            Make this a recurring purchase instead
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PriceEditor({ historyId }: { historyId: string }) {
  const { data, apply, closeModal, toast } = useStore();
  const record = data.history.find((h) => h.id === historyId);
  const [price, setPrice] = useState(record?.price !== undefined ? String(record.price) : '');
  const [error, setError] = useState('');
  if (!record) return null;
  return (
    <Modal
      title={`Price paid: ${record.name}`}
      onClose={closeModal}
      footer={
        <>
          <button type="button" className="btn btn-quiet" onClick={closeModal}>Cancel</button>
          <button type="submit" form="price-form" className="btn btn-primary">Save price</button>
        </>
      }
    >
      <form
        id="price-form"
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const p = parseNumber(price);
          if (p !== undefined && Number.isNaN(p)) {
            setError('Enter a price such as 4.50, or leave it empty.');
            return;
          }
          apply((d) => setHistoryPrice(d, historyId, p));
          toast('Price saved');
          closeModal();
        }}
      >
        <Field label={`Actual price (${data.settings.currency})`} error={error} hint="For the whole quantity. Leave empty if unknown.">
          <input data-autofocus value={price} inputMode="decimal" onChange={(e) => { setPrice(e.target.value); setError(''); }} />
        </Field>
      </form>
    </Modal>
  );
}

function AlertsPanel() {
  const { alerts, data, apply, go, closeModal } = useStore();
  return (
    <Modal
      title="Notifications"
      onClose={closeModal}
      footer={
        data.notices.length > 0 ? (
          <button type="button" className="btn btn-quiet" onClick={() => apply(clearNotices)}>Clear dismissible notices</button>
        ) : undefined
      }
    >
      {alerts.length === 0 ? (
        <EmptyState icon={BellOff} title="Nothing needs your attention" body="Due recurring purchases, returning deferred items and replenishment reminders appear here." />
      ) : (
        <ul className="alert-list">
          {alerts.map((a) => (
            <li key={a.id} className={`alert tone-${a.tone}`}>
              <button type="button" className="alert-main" onClick={() => go(a.view)}>
                <strong>{a.title}</strong>
                <span>{a.body}</span>
              </button>
              {a.noticeId ? (
                <button type="button" className="icon-btn" aria-label={`Dismiss: ${a.title}`} onClick={() => apply((d) => dismissNotice(d, a.noticeId!))}>
                  <X size={18} />
                </button>
              ) : (
                <ChevronRight size={18} className="muted" aria-hidden="true" />
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function MoreSheet() {
  const { go, closeModal, view } = useStore();
  return (
    <Modal title="More" onClose={closeModal}>
      <nav className="option-list" aria-label="More sections">
        {SECONDARY_NAV.map((n, i) => (
          <button key={n.id} type="button" className="option" data-autofocus={i === 0 ? true : undefined} aria-current={view === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
            <span className="option-main"><n.icon size={19} aria-hidden="true" /> {n.label}</span>
            <ChevronRight size={18} className="muted" aria-hidden="true" />
          </button>
        ))}
      </nav>
    </Modal>
  );
}

export function ModalHost() {
  const { modal, closeModal } = useStore();
  if (!modal) return null;
  switch (modal.type) {
    case 'item':
      return <ItemForm key={modal.item?.id ?? 'new'} item={modal.item} preset={modal.preset} />;
    case 'itemActions':
      return <ItemActions itemId={modal.itemId} />;
    case 'defer':
      return <DeferSheet target="item" id={modal.itemId} />;
    case 'snooze':
      return <DeferSheet target="recurring" id={modal.recurringId} />;
    case 'recurring':
      return <RecurringForm recurring={modal.recurring} preset={modal.preset} linkItemId={modal.linkItemId} />;
    case 'adjust':
      return <AdjustInterval productKey={modal.productKey} />;
    case 'price':
      return <PriceEditor historyId={modal.historyId} />;
    case 'alerts':
      return <AlertsPanel />;
    case 'more':
      return <MoreSheet />;
    case 'confirm':
      return (
        <Modal
          title={modal.title}
          onClose={closeModal}
          footer={
            <>
              <button type="button" className="btn btn-quiet" data-autofocus onClick={closeModal}>Cancel</button>
              <button
                type="button"
                className={`btn ${modal.danger ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => { modal.onConfirm(); closeModal(); }}
              >
                {modal.confirmLabel}
              </button>
            </>
          }
        >
          <p className="lead">{modal.body}</p>
        </Modal>
      );
  }
}

export function Toasts() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.message}</span>
          {t.action && (
            <button type="button" onClick={() => { t.action!.run(); dismissToast(t.id); }}>
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
