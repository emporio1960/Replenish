import { useState } from 'react';
import { addDays, formatDate, longDate, nextMonday } from '../lib/dates';
import { deferItem, snoozeRecurring } from '../state/actions';
import { useStore } from '../state/store';
import { Field, Modal } from './ui';

/** Defers a shopping item, or pushes back the due date of a recurring purchase. */
export function DeferSheet({ target, id }: { target: 'item' | 'recurring'; id: string }) {
  const { data, today, apply, closeModal, toast } = useStore();
  const item = target === 'item' ? data.items.find((i) => i.id === id) : undefined;
  const schedule = target === 'recurring' ? data.recurring.find((r) => r.id === id) : undefined;
  const [reason, setReason] = useState(item?.deferral?.reason ?? '');
  const tomorrow = addDays(today, 1);
  const [custom, setCustom] = useState(item?.deferral?.until ?? addDays(today, 14));
  const [error, setError] = useState('');

  const name = item?.name ?? schedule?.name;
  if (!name) return null;
  const changing = item?.status === 'deferred';

  const options = [
    { label: 'Tomorrow', until: tomorrow },
    { label: 'In 3 days', until: addDays(today, 3) },
    { label: 'In 7 days', until: addDays(today, 7) },
    { label: 'Next week', until: nextMonday(today) },
  ];

  function choose(until: string | null) {
    if (target === 'item') {
      apply((d) => deferItem(d, id, until, reason, new Date()));
    } else if (until) {
      apply((d) => snoozeRecurring(d, id, until));
    }
    toast(
      until
        ? `${name} deferred until ${formatDate(until, data.settings.dateFormat)}`
        : `${name} deferred indefinitely`,
    );
    closeModal();
  }

  return (
    <Modal title={changing ? `Change deferral: ${name}` : `Defer ${name}`} onClose={closeModal}>
      <div className="form">
        {target === 'item' ? (
          <Field label="Reason (optional)">
            <input
              value={reason}
              maxLength={200}
              placeholder="Such as waiting for a special"
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        ) : (
          <p className="lead">Moves the next due date. The schedule itself does not change.</p>
        )}
        <div className="option-list" role="group" aria-label="Defer until">
          {options.map((o, i) => (
            <button key={o.label} type="button" className="option" data-autofocus={i === 0 ? true : undefined} onClick={() => choose(o.until)}>
              <span>{o.label}</span>
              <span className="muted">{longDate(o.until)}</span>
            </button>
          ))}
          {target === 'item' && (
            <button type="button" className="option" onClick={() => choose(null)}>
              <span>Indefinitely</span>
              <span className="muted">Until you restore it</span>
            </button>
          )}
        </div>
        <div className="form-row align-end">
          <Field label="Or pick a date" error={error}>
            <input type="date" value={custom} min={tomorrow} onChange={(e) => { setCustom(e.target.value); setError(''); }} />
          </Field>
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (!custom || custom < tomorrow) setError('Pick a date after today.');
              else choose(custom);
            }}
          >
            Defer until this date
          </button>
        </div>
      </div>
    </Modal>
  );
}
