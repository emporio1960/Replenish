import { useState, type FormEvent } from 'react';
import { UNITS, type FrequencyKind, type RecurringPurchase, type Unit } from '../types';
import { isValidDay } from '../lib/dates';
import { normalizeName } from '../lib/duplicates';
import { parseNumber } from '../lib/format';
import { FREQUENCIES } from '../lib/recurrence';
import { addRecurring, updateRecurring, type RecurringInput } from '../state/actions';
import { useStore } from '../state/store';
import { Field, Modal } from './ui';

interface Props {
  recurring?: RecurringPurchase;
  preset?: Partial<RecurringInput>;
  linkItemId?: string;
}

export function RecurringForm({ recurring, preset, linkItemId }: Props) {
  const { data, today, apply, closeModal, toast } = useStore();
  const base = recurring ?? preset ?? {};
  const [name, setName] = useState(base.name ?? '');
  const [quantity, setQuantity] = useState(String(base.quantity ?? 1));
  const [unit, setUnit] = useState<Unit>(base.unit ?? 'units');
  const [price, setPrice] = useState(base.estimatedPrice !== undefined ? String(base.estimatedPrice) : '');
  const [categoryId, setCategoryId] = useState(base.categoryId ?? data.settings.defaultCategoryId);
  const [freq, setFreq] = useState<FrequencyKind>(base.frequency?.kind ?? 'weekly');
  const [every, setEvery] = useState(String(base.frequency?.customDays ?? 10));
  const [nextDue, setNextDue] = useState(base.nextDue ?? today);
  const [reminder, setReminder] = useState(base.reminderDate ?? '');
  const [notes, setNotes] = useState(base.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const err: Record<string, string> = {};
    const q = parseNumber(quantity);
    const p = parseNumber(price);
    const n = parseNumber(every);
    const key = normalizeName(name);
    if (!name.trim()) err.name = 'Enter a product name.';
    else if (data.recurring.some((r) => r.id !== recurring?.id && normalizeName(r.name) === key)) {
      err.name = 'This product already has a recurring purchase.';
    }
    if (q === undefined || Number.isNaN(q) || q <= 0) err.quantity = 'Enter a quantity above zero.';
    if (p !== undefined && Number.isNaN(p)) err.price = 'Enter a price such as 4.50, or leave it empty.';
    if (freq === 'custom' && (n === undefined || Number.isNaN(n) || n < 1 || n > 730)) {
      err.every = 'Enter a number of days between 1 and 730.';
    }
    if (!isValidDay(nextDue)) err.nextDue = 'Pick the next purchase date.';
    if (reminder && !isValidDay(reminder)) err.reminder = 'Pick a valid date, or clear it.';
    else if (reminder && isValidDay(nextDue) && reminder > nextDue) {
      err.reminder = 'Set the reminder on or before the next purchase date.';
    }
    setErrors(err);
    if (Object.keys(err).length) return;

    const input: RecurringInput = {
      name: name.trim(),
      quantity: q!,
      unit,
      estimatedPrice: p,
      categoryId,
      notes: notes.trim() || undefined,
      frequency: freq === 'custom' ? { kind: freq, customDays: Math.round(n!) } : { kind: freq },
      nextDue,
      reminderDate: reminder || undefined,
    };
    apply((d) => (recurring ? updateRecurring(d, recurring.id, input) : addRecurring(d, input, new Date(), linkItemId)));
    toast(recurring ? `Saved ${input.name}` : `${input.name} will now recur`);
    closeModal();
  }

  return (
    <Modal
      title={recurring ? 'Edit recurring purchase' : 'New recurring purchase'}
      onClose={closeModal}
      footer={
        <>
          <button type="button" className="btn btn-quiet" onClick={closeModal}>Cancel</button>
          <button type="submit" form="recurring-form" className="btn btn-primary">
            {recurring ? 'Save changes' : 'Create recurring purchase'}
          </button>
        </>
      }
    >
      <form id="recurring-form" className="form" onSubmit={onSubmit} noValidate>
        <Field label="Product" error={errors.name}>
          <input data-autofocus value={name} maxLength={80} autoComplete="off" onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(errors.name)} />
        </Field>
        <div className="form-row">
          <Field label="Quantity" error={errors.quantity}>
            <input value={quantity} inputMode="decimal" onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Field label="Unit">
            <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </Field>
        </div>
        <div className="form-row">
          <Field label={`Estimated price (${data.settings.currency})`} error={errors.price}>
            <input value={price} inputMode="decimal" placeholder="Optional" onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="Category">
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="form-row">
          <Field label="How often">
            <select value={freq} onChange={(e) => setFreq(e.target.value as FrequencyKind)}>
              {FREQUENCIES.map((f) => <option key={f.kind} value={f.kind}>{f.label}</option>)}
            </select>
          </Field>
          {freq === 'custom' && (
            <Field label="Days between purchases" error={errors.every}>
              <input value={every} inputMode="numeric" onChange={(e) => setEvery(e.target.value)} />
            </Field>
          )}
        </div>
        <div className="form-row">
          <Field label="Next purchase date" error={errors.nextDue}>
            <input type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
          </Field>
          <Field label="Reminder date" error={errors.reminder} hint="Optional">
            <input type="date" value={reminder} max={nextDue} onChange={(e) => setReminder(e.target.value)} />
          </Field>
        </div>
        <Field label="Notes">
          <textarea value={notes} rows={2} maxLength={500} placeholder="Optional" onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
