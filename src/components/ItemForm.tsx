import { useMemo, useState, type FormEvent } from 'react';
import { Repeat } from 'lucide-react';
import { PRIORITIES, UNITS, type FrequencyKind, type Priority, type ShoppingItem, type Unit } from '../types';
import { findDuplicates, normalizeName } from '../lib/duplicates';
import { buildItemStats, type ItemStats } from '../lib/replenishment';
import { formatMoney, formatQty, parseNumber, uid } from '../lib/format';
import { FREQUENCIES } from '../lib/recurrence';
import { addItem, addRecurring, updateItem, type ItemInput } from '../state/actions';
import { useStore } from '../state/store';
import { Field, Modal, Segmented, Toggle } from './ui';

const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', normal: 'Normal', high: 'High' };

export function ItemForm({ item, preset }: { item?: ShoppingItem; preset?: Partial<ItemInput> }) {
  const { data, today, apply, closeModal, toast } = useStore();
  const base = item ?? preset ?? {};
  const [name, setName] = useState(base.name ?? '');
  const [quantity, setQuantity] = useState(String(base.quantity ?? 1));
  const [unit, setUnit] = useState<Unit>(base.unit ?? 'units');
  const [price, setPrice] = useState(base.estimatedPrice !== undefined ? String(base.estimatedPrice) : '');
  const [paid, setPaid] = useState(item?.actualPrice !== undefined ? String(item.actualPrice) : '');
  const [categoryId, setCategoryId] = useState(base.categoryId ?? data.settings.defaultCategoryId);
  const [priority, setPriority] = useState<Priority>(base.priority ?? 'normal');
  const [notes, setNotes] = useState(base.notes ?? '');
  const [storeId, setStoreId] = useState(base.storeId ?? '');

  // Suggest products you have bought before, filling in the usual details.
  const stats = useMemo(() => buildItemStats(data.history), [data.history]);
  const typed = normalizeName(name);
  const matches = item || typed.length < 2
    ? []
    : stats
        .filter((s) => s.key !== typed && s.key.includes(typed))
        .sort((a, b) => Number(b.key.startsWith(typed)) - Number(a.key.startsWith(typed)) || b.count - a.count)
        .slice(0, 4);
  const known = item ? undefined : stats.find((s) => s.key === typed);

  function fill(s: ItemStats) {
    setName(s.name);
    setQuantity(String(s.typicalQuantity));
    setUnit(s.unit);
    setCategoryId(s.categoryId);
    setPrice(s.usualUnitPrice !== undefined ? (s.usualUnitPrice * s.typicalQuantity).toFixed(2) : '');
  }
  const [repeat, setRepeat] = useState(false);
  const [freq, setFreq] = useState<FrequencyKind>('weekly');
  const [every, setEvery] = useState('10');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<{ dups: ShoppingItem[]; input: ItemInput } | null>(null);

  const purchased = item?.status === 'purchased';
  const canRepeat = !purchased && !(item?.recurringId ?? preset?.recurringId);

  function validate(): ItemInput | null {
    const e: Record<string, string> = {};
    const q = parseNumber(quantity);
    const p = parseNumber(price);
    const a = parseNumber(paid);
    const n = parseNumber(every);
    if (!name.trim()) e.name = 'Enter a name for this item.';
    if (q === undefined || Number.isNaN(q) || q <= 0) e.quantity = 'Enter a quantity above zero.';
    if (p !== undefined && Number.isNaN(p)) e.price = 'Enter a price such as 4.50, or leave it empty.';
    if (a !== undefined && Number.isNaN(a)) e.paid = 'Enter a price such as 4.50, or leave it empty.';
    if (repeat && freq === 'custom' && (n === undefined || Number.isNaN(n) || n < 1 || n > 730)) {
      e.every = 'Enter a number of days between 1 and 730.';
    }
    setErrors(e);
    if (Object.keys(e).length) return null;
    return {
      name: name.trim(),
      quantity: q!,
      unit,
      estimatedPrice: p,
      categoryId,
      notes,
      priority,
      recurringId: preset?.recurringId,
      storeId: storeId || undefined,
    };
  }

  function save(input: ItemInput) {
    const now = new Date();
    const schedule = repeat && canRepeat
      ? {
          name: input.name, quantity: input.quantity, unit: input.unit, estimatedPrice: input.estimatedPrice,
          categoryId: input.categoryId, notes: input.notes,
          frequency: freq === 'custom' ? { kind: freq, customDays: Math.round(parseNumber(every)!) } : { kind: freq },
          nextDue: today,
        }
      : null;
    const id = item?.id ?? uid();
    apply((d) => {
      let next = item
        ? updateItem(d, id, {
            name: input.name, quantity: input.quantity, unit: input.unit, estimatedPrice: input.estimatedPrice,
            categoryId: input.categoryId, notes: input.notes?.trim() || undefined, priority: input.priority,
            storeId: input.storeId,
            ...(purchased ? { actualPrice: parseNumber(paid) } : {}),
          })
        : addItem(d, input, now, id);
      if (schedule) next = addRecurring(next, schedule, now, id);
      return next;
    });
    toast(item ? `Saved ${input.name}` : `Added ${input.name}`);
    closeModal();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const input = validate();
    if (!input) return;
    const renamed = !item || item.name.trim().toLowerCase() !== input.name.toLowerCase();
    const found = renamed && !purchased ? findDuplicates(input.name, data.items, item?.id) : [];
    if (found.length) setPending({ dups: found, input });
    else save(input);
  }

  if (pending) {
    const { dups, input } = pending;
    const match = dups[0];
    const sameUnit = match.unit === input.unit;
    return (
      <Modal title="Possible duplicate" onClose={closeModal}>
        <p className="lead">
          {dups.length === 1 ? 'An item that looks the same is ' : 'Items that look the same are '}
          already on your list:
        </p>
        <ul className="plain-list">
          {dups.map((d) => (
            <li key={d.id}>
              <strong>{d.name}</strong> {formatQty(d.quantity, d.unit)}
              {d.status === 'deferred' ? ' (deferred)' : ''}
            </li>
          ))}
        </ul>
        <div className="stack">
          {!item && sameUnit && (
            <button
              type="button"
              className="btn btn-primary"
              data-autofocus
              onClick={() => {
                apply((d) => updateItem(d, match.id, { quantity: match.quantity + input.quantity }));
                toast(`${match.name} is now ${formatQty(match.quantity + input.quantity, match.unit)}`);
                closeModal();
              }}
            >
              Increase {match.name} to {formatQty(match.quantity + input.quantity, match.unit)}
            </button>
          )}
          <button type="button" className="btn" onClick={() => save(input)}>
            {item ? 'Save anyway' : 'Add as a separate item'}
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setPending(null)}>
            Go back
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={item ? 'Edit item' : 'Add item'}
      onClose={closeModal}
      footer={
        <>
          <button type="button" className="btn btn-quiet" onClick={closeModal}>Cancel</button>
          <button type="submit" form="item-form" className="btn btn-primary">
            {item ? 'Save changes' : 'Add to list'}
          </button>
        </>
      }
    >
      <form id="item-form" className="form" onSubmit={onSubmit} noValidate>
        <Field label="Item" error={errors.name}>
          <input
            data-autofocus
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            placeholder="Such as milk or dishwasher tablets"
            autoComplete="off"
            aria-invalid={Boolean(errors.name)}
          />
        </Field>
        {matches.length > 0 && (
          <div className="suggest" role="group" aria-label="Products you have bought before">
            {matches.map((s) => (
              <button key={s.key} type="button" onClick={() => fill(s)}>
                <strong>{s.name}</strong>
                <span>{formatQty(s.typicalQuantity, s.unit)}</span>
              </button>
            ))}
          </div>
        )}
        {known && (
          <p className="note">
            You usually buy {formatQty(known.typicalQuantity, known.unit)}
            {known.usualUnitPrice !== undefined ? ` for about ${formatMoney(known.usualUnitPrice * known.typicalQuantity, data.settings.currency)}` : ''}.
            <button type="button" className="link" onClick={() => fill(known)}>Use these</button>
          </p>
        )}
        <div className="form-row">
          <Field label="Quantity" error={errors.quantity}>
            <input value={quantity} inputMode="decimal" onChange={(e) => setQuantity(e.target.value)} aria-invalid={Boolean(errors.quantity)} />
          </Field>
          <Field label="Unit">
            <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </Field>
        </div>
        <div className="form-row">
          <Field label={`Estimated price (${data.settings.currency})`} error={errors.price} hint="For the whole quantity">
            <input value={price} inputMode="decimal" placeholder="Optional" onChange={(e) => setPrice(e.target.value)} aria-invalid={Boolean(errors.price)} />
          </Field>
          {purchased && (
            <Field label="Price paid" error={errors.paid} hint="Saved to purchase history">
              <input value={paid} inputMode="decimal" placeholder="Optional" onChange={(e) => setPaid(e.target.value)} aria-invalid={Boolean(errors.paid)} />
            </Field>
          )}
        </div>
        <Field label="Category">
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        {data.stores.length > 0 && (
          <Field label="Store">
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">Any store</option>
              {data.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        )}
        <div className="field">
          <span className="field-label">Priority</span>
          <Segmented
            label="Priority"
            value={priority}
            onChange={setPriority}
            options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
          />
        </div>
        <Field label="Notes">
          <textarea value={notes} rows={2} maxLength={500} placeholder="Brand, size, where to find it" onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {canRepeat && (
          <div className="inset">
            <Toggle
              label="Buy this regularly"
              description="Creates a recurring purchase that reminds you when it is due again."
              checked={repeat}
              onChange={setRepeat}
            />
            {repeat && (
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
            )}
          </div>
        )}
        {item?.recurringId && (
          <p className="note"><Repeat size={15} aria-hidden="true" /> Part of a recurring purchase. Change its schedule under Recurring.</p>
        )}
      </form>
    </Modal>
  );
}
