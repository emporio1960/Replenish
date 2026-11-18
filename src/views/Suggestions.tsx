import { CalendarClock, Lightbulb, Plus, Repeat, TrendingUp } from 'lucide-react';
import { categoryById } from '../lib/categories';
import { formatDate, pluralDays, relativeDay } from '../lib/dates';
import { normalizeName } from '../lib/duplicates';
import { formatMoney, formatQty, times } from '../lib/format';
import { frequencyFromDays } from '../lib/recurrence';
import {
  buildItemStats, LEVEL_LABEL, type ItemStats, type Recommendation, type ReplenishLevel,
} from '../lib/replenishment';
import { addItem, deleteItem, restoreItem, setReplenishPref } from '../state/actions';
import { useStore } from '../state/store';
import { CategoryIcon, Chip, EmptyState, PageHeader, Section } from '../components/ui';

const LEVEL_TONE: Record<ReplenishLevel, 'warn' | 'accent' | 'neutral'> = {
  due: 'warn', approaching: 'accent', low: 'neutral',
};

const LEVEL_NOTE: Record<ReplenishLevel, string> = {
  due: 'The usual gap since the last purchase has passed.',
  approaching: 'Getting close to the usual gap between purchases.',
  low: 'Bought recently, so probably not needed yet.',
};

export function Suggestions() {
  const { data, today, recs, apply, go, openModal, toast } = useStore();
  const { currency, dateFormat } = data.settings;

  const addFrom = (s: ItemStats) => {
    apply((d) =>
      addItem(d, {
        name: s.name, quantity: s.typicalQuantity, unit: s.unit, categoryId: s.categoryId, priority: 'normal',
        estimatedPrice: s.avgPrice !== undefined ? Math.round(s.avgPrice * 100) / 100 : undefined,
      }, new Date()),
    );
    toast(`Added ${s.name} ${formatQty(s.typicalQuantity, s.unit)}`);
  };

  const stats = buildItemStats(data.history);
  const wanted = new Set(data.items.filter((i) => i.status !== 'purchased').map((i) => normalizeName(i.name)));
  const scheduled = new Set(data.recurring.map((r) => normalizeName(r.name)));
  const frequent = stats.filter((s) => s.count >= 2 && !wanted.has(s.key)).slice(0, 10);
  const patterns = stats.filter((s) => s.predictable && !scheduled.has(s.key));
  const postponed = data.items
    .filter((i) => i.status !== 'purchased' && i.deferCount >= 2)
    .sort((a, b) => b.deferCount - a.deferCount);
  const levels: ReplenishLevel[] = ['due', 'approaching', 'low'];
  const nothing = recs.length === 0 && frequent.length === 0 && patterns.length === 0 && postponed.length === 0;

  const recCard = (r: Recommendation) => (
    <li key={r.key} className="card detail-card">
      <div className="detail-head">
        <CategoryIcon category={categoryById(data.categories, r.categoryId)} />
        <div className="row-body">
          <span className="row-title">{r.name}</span>
          <span className="row-meta">
            <span>Every {pluralDays(r.usedInterval)}{r.adjusted ? ' (set by you)' : ''}</span>
            <span>Estimated {formatDate(r.nextEstimated, dateFormat)}</span>
          </span>
        </div>
        {r.onList ? <Chip tone="good">On list</Chip> : <Chip tone={LEVEL_TONE[r.level]}>{LEVEL_LABEL[r.level]}</Chip>}
      </div>
      <details className="why">
        <summary>How this was estimated</summary>
        <p>{r.explanation}</p>
        <p>
          Usually {formatQty(r.typicalQuantity, r.unit)}
          {r.avgPrice !== undefined ? `, averaging ${formatMoney(r.avgPrice, currency)}` : ''}. This is an estimate
          from purchase dates only. Replenish does not know how much you have left at home.
        </p>
      </details>
      <div className="card-actions">
        {!r.onList && (
          <button type="button" className="btn btn-small btn-primary" onClick={() => addFrom(r)}>
            <Plus size={15} aria-hidden="true" /> Add to list
          </button>
        )}
        <button type="button" className="btn btn-small" onClick={() => openModal({ type: 'adjust', productKey: r.key })}>
          Adjust
        </button>
        <button
          type="button"
          className="btn btn-small btn-quiet"
          onClick={() => {
            apply((d) => setReplenishPref(d, r.key, { dismissedAtPurchase: r.lastPurchased }));
            toast(`Dismissed ${r.name} until you next buy it`, {
              label: 'Undo',
              run: () => apply((d) => setReplenishPref(d, r.key, { dismissedAtPurchase: undefined })),
            });
          }}
        >
          Dismiss
        </button>
      </div>
    </li>
  );

  return (
    <>
      <PageHeader title="Suggestions" subtitle="Worked out from your own purchase history, on this device" />
      {nothing ? (
        <div className="card">
          <EmptyState
            icon={Lightbulb}
            title="No suggestions yet"
            body="Tick items off your shopping list as you buy them. After you have bought something twice, Replenish estimates when you may need it again and explains how."
            action={<button type="button" className="btn" onClick={() => go('list')}>Open shopping list</button>}
          />
        </div>
      ) : (
        <>
          {levels.map((level) => {
            const group = recs.filter((r) => r.level === level);
            if (!group.length) return null;
            return (
              <Section key={level} title={LEVEL_LABEL[level]}>
                <p className="section-note">{LEVEL_NOTE[level]}</p>
                <ul className="cards">{group.map(recCard)}</ul>
              </Section>
            );
          })}

          {postponed.length > 0 && (
            <Section title="Repeatedly postponed">
              <p className="section-note">You have put these off more than once. Buy them, or let them go.</p>
              <ul className="card rows">
                {postponed.map((i) => (
                  <li key={i.id} className="row">
                    <CalendarClock size={20} className="muted" aria-hidden="true" />
                    <div className="row-body">
                      <span className="row-title">{i.name}</span>
                      <span className="row-meta">
                        Deferred {times(i.deferCount)}
                        {i.status === 'deferred'
                          ? i.deferral?.until ? `, returns ${relativeDay(i.deferral.until, today)}` : ', deferred indefinitely'
                          : ', now back on your list'}
                      </span>
                    </div>
                    {i.status === 'deferred' && (
                      <button type="button" className="btn btn-small" onClick={() => { apply((d) => restoreItem(d, i.id)); toast(`${i.name} restored to your list`); }}>
                        Restore
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-small btn-quiet danger-text"
                      onClick={() =>
                        openModal({
                          type: 'confirm',
                          title: `Delete ${i.name}?`,
                          body: 'This removes the item permanently.',
                          confirmLabel: 'Delete permanently',
                          danger: true,
                          onConfirm: () => { apply((d) => deleteItem(d, i.id)); toast(`Deleted ${i.name}`); },
                        })
                      }
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {patterns.length > 0 && (
            <Section title="Predictable purchase cycles">
              <p className="section-note">These are bought at steady intervals. A recurring purchase would track them for you.</p>
              <ul className="card rows">
                {patterns.map((s) => (
                  <li key={s.key} className="row">
                    <TrendingUp size={20} className="muted" aria-hidden="true" />
                    <div className="row-body">
                      <span className="row-title">{s.name}</span>
                      <span className="row-meta">
                        About every {pluralDays(Math.round(s.avgInterval ?? 0))}, from {s.days.length} purchases (gaps: {s.intervals.slice(-5).join(', ')} days)
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() =>
                        openModal({
                          type: 'recurring',
                          preset: {
                            name: s.name, quantity: s.typicalQuantity, unit: s.unit, categoryId: s.categoryId,
                            estimatedPrice: s.avgPrice !== undefined ? Math.round(s.avgPrice * 100) / 100 : undefined,
                            frequency: frequencyFromDays(s.avgInterval ?? 7),
                          },
                        })
                      }
                    >
                      <Repeat size={15} aria-hidden="true" /> Make recurring
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {frequent.length > 0 && (
            <Section title="Frequently purchased">
              <p className="section-note">Your most-bought products that are not on the list. Tap to add your usual quantity.</p>
              <div className="quick-adds">
                {frequent.map((s) => (
                  <button key={s.key} type="button" className="quick-add" onClick={() => addFrom(s)} aria-label={`Add ${s.name} to the shopping list`}>
                    <Plus size={15} aria-hidden="true" />
                    <span>{s.name}</span>
                    <em>bought {times(s.count)}</em>
                  </button>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </>
  );
}
