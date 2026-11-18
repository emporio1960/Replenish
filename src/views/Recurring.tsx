import { Pause, Pencil, Play, Plus, Repeat, SkipForward } from 'lucide-react';
import type { RecurringPurchase } from '../types';
import { categoryById } from '../lib/categories';
import { formatDate, relativeDay } from '../lib/dates';
import { formatMoney, formatQty, plural } from '../lib/format';
import { frequencyLabel } from '../lib/recurrence';
import {
  addRecurringToList, deleteRecurring, itemForRecurring, skipRecurring, updateRecurring,
} from '../state/actions';
import { useStore } from '../state/store';
import { CategoryIcon, Chip, EmptyState, PageHeader, Section } from '../components/ui';

function RecurringCard({ r }: { r: RecurringPurchase }) {
  const { data, today, apply, openModal, toast } = useStore();
  const { dateFormat, currency } = data.settings;
  const listed = itemForRecurring(data, r);
  const due = !r.paused && r.nextDue <= today;
  const reminding = !r.paused && !due && r.reminderDate !== undefined && r.reminderDate <= today;

  return (
    <li className={`card detail-card ${due ? 'is-due' : ''}`}>
      <div className="detail-head">
        <CategoryIcon category={categoryById(data.categories, r.categoryId)} />
        <div className="row-body">
          <span className="row-title">{r.name}</span>
          <span className="row-meta">
            <span>{formatQty(r.quantity, r.unit)}</span>
            <span>{frequencyLabel(r.frequency)}</span>
            {r.estimatedPrice !== undefined && <span>{formatMoney(r.estimatedPrice, currency)}</span>}
          </span>
        </div>
        {r.paused ? <Chip>Paused</Chip> : due ? <Chip tone="warn">Due</Chip> : reminding ? <Chip tone="accent">Reminder</Chip> : null}
        {listed && <Chip tone="good">{listed.status === 'deferred' ? 'Deferred' : 'On list'}</Chip>}
      </div>
      <dl className="facts">
        <div>
          <dt>{r.paused ? 'Would be due' : 'Next purchase'}</dt>
          <dd>{formatDate(r.nextDue, dateFormat)} ({relativeDay(r.nextDue, today)})</dd>
        </div>
        <div>
          <dt>Last purchased</dt>
          <dd>{r.lastPurchasedAt ? formatDate(r.lastPurchasedAt, dateFormat) : 'Not yet'}</dd>
        </div>
        {r.reminderDate && <div><dt>Reminder</dt><dd>{formatDate(r.reminderDate, dateFormat)}</dd></div>}
        <div>
          <dt>So far</dt>
          <dd>Bought {r.completedCount}, skipped {r.skippedCount}</dd>
        </div>
        {r.notes && <div className="wide"><dt>Notes</dt><dd>{r.notes}</dd></div>}
      </dl>
      <div className="card-actions">
        {!r.paused && !listed && (
          <button
            type="button"
            className={`btn btn-small ${due ? 'btn-primary' : ''}`}
            onClick={() => { apply((d) => addRecurringToList(d, r.id, new Date())); toast(`Added ${r.name} to your list`); }}
          >
            <Plus size={15} aria-hidden="true" /> Add to list
          </button>
        )}
        {!r.paused && (
          <>
            <button type="button" className="btn btn-small" onClick={() => openModal({ type: 'snooze', recurringId: r.id })}>
              Defer
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => { apply((d) => skipRecurring(d, r.id, new Date())); toast(`Skipped one ${r.name} purchase`); }}
            >
              <SkipForward size={15} aria-hidden="true" /> Skip once
            </button>
          </>
        )}
        <button
          type="button"
          className="btn btn-small"
          onClick={() => {
            apply((d) => updateRecurring(d, r.id, { paused: !r.paused }));
            toast(r.paused ? `${r.name} resumed` : `${r.name} paused`);
          }}
        >
          {r.paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
          {r.paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="btn btn-small" onClick={() => openModal({ type: 'recurring', recurring: r })}>
          <Pencil size={15} aria-hidden="true" /> Edit
        </button>
        <button
          type="button"
          className="btn btn-small btn-quiet danger-text"
          onClick={() =>
            openModal({
              type: 'confirm',
              title: `Remove ${r.name}?`,
              body: 'This permanently removes the recurring purchase and its schedule. Items already on your list and your purchase history are kept.',
              confirmLabel: 'Remove recurring purchase',
              danger: true,
              onConfirm: () => { apply((d) => deleteRecurring(d, r.id)); toast(`Removed ${r.name}`); },
            })
          }
        >
          Remove
        </button>
      </div>
    </li>
  );
}

export function Recurring() {
  const { data, today, openModal } = useStore();
  const byDue = (a: RecurringPurchase, b: RecurringPurchase) => a.nextDue.localeCompare(b.nextDue) || a.name.localeCompare(b.name);
  const due = data.recurring.filter((r) => !r.paused && r.nextDue <= today).sort(byDue);
  const upcoming = data.recurring.filter((r) => !r.paused && r.nextDue > today).sort(byDue);
  const paused = data.recurring.filter((r) => r.paused).sort(byDue);

  return (
    <>
      <PageHeader
        title="Recurring"
        subtitle={
          data.recurring.length === 0
            ? 'Things you buy on a schedule'
            : `${plural(data.recurring.length, 'recurring purchase')}, ${due.length} due now`
        }
        actions={
          <button type="button" className="btn btn-primary" onClick={() => openModal({ type: 'recurring' })}>
            <Plus size={17} aria-hidden="true" /> New recurring purchase
          </button>
        }
      />
      {data.recurring.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Repeat}
            title="No recurring purchases"
            body="Set up the things you buy on a regular schedule. Replenish tells you when each one is due and works out the next date every time you buy it."
            action={<button type="button" className="btn btn-primary" onClick={() => openModal({ type: 'recurring' })}>New recurring purchase</button>}
          />
        </div>
      ) : (
        <>
          {due.length > 0 && (
            <Section title="Due now"><ul className="cards">{due.map((r) => <RecurringCard key={r.id} r={r} />)}</ul></Section>
          )}
          {upcoming.length > 0 && (
            <Section title="Upcoming"><ul className="cards">{upcoming.map((r) => <RecurringCard key={r.id} r={r} />)}</ul></Section>
          )}
          {paused.length > 0 && (
            <Section title="Paused"><ul className="cards">{paused.map((r) => <RecurringCard key={r.id} r={r} />)}</ul></Section>
          )}
        </>
      )}
    </>
  );
}
