import {
  CalendarClock, ChevronRight, CircleCheck, Hourglass, Lightbulb, PackageCheck, PiggyBank, Plus, Repeat,
  ShoppingBasket, ShoppingCart, TrendingUp, Undo2, Wallet, type LucideIcon,
} from 'lucide-react';
import { listTotals } from '../lib/analytics';
import { categoryById } from '../lib/categories';
import { formatDate, longDate, pluralDays, relativeDay } from '../lib/dates';
import { formatMoney, formatQty, plural } from '../lib/format';
import { buildInsights, upcomingRecurring, type Insight } from '../lib/insights';
import { frequencyLabel } from '../lib/recurrence';
import { actionable, LEVEL_LABEL } from '../lib/replenishment';
import { addItem, addRecurringToList, itemForRecurring, loadSample, resolveCategory } from '../state/actions';
import { useStore } from '../state/store';
import { CategoryIcon, Chip, EmptyState, PageHeader, ProgressBar, Section } from '../components/ui';

const INSIGHT_ICON: Record<Insight['icon'], LucideIcon> = {
  replenish: Hourglass, pattern: TrendingUp, deferred: CalendarClock, recurring: Repeat,
  budget: Wallet, progress: CircleCheck, return: Undo2, spend: PiggyBank,
};

export function Dashboard() {
  const { data, today, recs, apply, go, openModal, toast } = useStore();
  const { currency, budget, dateFormat } = data.settings;
  const active = data.items.filter((i) => i.status === 'active');
  const purchased = data.items.filter((i) => i.status === 'purchased');
  const deferred = data.items.filter((i) => i.status === 'deferred');
  const onList = active.length + purchased.length;
  const pct = onList ? Math.round((purchased.length / onList) * 100) : 0;
  const totals = listTotals(data);
  const need = actionable(recs);
  const insights = buildInsights(data, today, recs);
  const upcoming = upcomingRecurring(data, today, 7);
  const isNew = !data.onboarded && data.items.length + data.recurring.length + data.history.length === 0;

  const tiles: { label: string; value: number; view: 'list' | 'deferred' | 'suggestions'; icon: LucideIcon }[] = [
    { label: 'To buy', value: active.length, view: 'list', icon: ShoppingBasket },
    { label: 'Purchased', value: purchased.length, view: 'list', icon: PackageCheck },
    { label: 'Deferred', value: deferred.length, view: 'deferred', icon: CalendarClock },
    { label: 'May be running low', value: need.length, view: 'suggestions', icon: Hourglass },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={longDate(today)}
        actions={
          <>
            <button type="button" className="btn" onClick={() => go('shop')} disabled={onList === 0}>
              <ShoppingCart size={17} aria-hidden="true" /> Start shopping
            </button>
            <button type="button" className="btn btn-primary" onClick={() => openModal({ type: 'item' })}>
              <Plus size={17} aria-hidden="true" /> Add item
            </button>
          </>
        }
      />

      {isNew && (
        <section className="card welcome">
          <h2>Welcome to Replenish</h2>
          <p>
            Keep a shopping list, put purchases off until later, set up things you buy on a schedule,
            and let your purchase history estimate when the essentials are due again.
          </p>
          <div className="row-wrap">
            <button type="button" className="btn btn-primary" onClick={() => openModal({ type: 'item' })}>
              Add your first item
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => { apply((d) => loadSample(d, new Date())); toast('Demo data loaded. Remove it any time in Settings.'); }}
            >
              Explore with demo data
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => apply((d) => ({ ...d, onboarded: true }))}>
              Dismiss
            </button>
          </div>
        </section>
      )}

      <section className="card basket" aria-label="Shopping progress">
        {onList === 0 ? (
          <div className="basket-empty">
            <p className="basket-figure">Your list is empty</p>
            <p className="muted">Add what you need, or pick from your suggestions.</p>
          </div>
        ) : (
          <>
            <p className="basket-figure">
              <span>{purchased.length}</span> of {onList} in the basket
            </p>
            <div className="basket-strip" role="img" aria-label={`${pct}% of the shopping list is complete`}>
              {[...purchased, ...active].map((i) => (
                <span
                  key={i.id}
                  className={i.status === 'purchased' ? 'is-done' : ''}
                  style={{ ['--cat' as string]: categoryById(data.categories, i.categoryId).color }}
                />
              ))}
            </div>
            <dl className="basket-meta">
              <div><dt>Complete</dt><dd>{pct}%</dd></div>
              <div><dt>Still to buy</dt><dd>{formatMoney(totals.remaining, currency)}</dd></div>
              <div><dt>Estimated total</dt><dd>{formatMoney(totals.total, currency)}</dd></div>
            </dl>
            {totals.unpriced > 0 && (
              <p className="fine">{plural(totals.unpriced, 'item has', 'items have')} no estimated price, so the total is a minimum.</p>
            )}
          </>
        )}
        {budget !== null && (
          <div className="budget">
            <div className="budget-line">
              <span>Budget</span>
              <span>
                {formatMoney(totals.total, currency)} of {formatMoney(budget, currency)}
              </span>
            </div>
            <ProgressBar value={totals.total} max={budget} tone={totals.total > budget ? 'alert' : 'accent'} label="Estimated spending against budget" />
          </div>
        )}
      </section>

      <div className="tiles">
        {tiles.map((t) => (
          <button key={t.label} type="button" className="tile" onClick={() => go(t.view)}>
            <t.icon size={18} aria-hidden="true" />
            <strong>{t.value}</strong>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <Section title="Shopping summary">
        {insights.length === 0 ? (
          <div className="card">
            <p className="muted">
              Observations appear here as you use the app: what may be running low, what you keep
              putting off, and what is due next.
            </p>
          </div>
        ) : (
          <ul className="card insight-list">
            {insights.map((i) => {
              const Icon = INSIGHT_ICON[i.icon];
              return (
                <li key={i.id}>
                  <button type="button" className={`insight tone-${i.tone}`} onClick={() => go(i.view)}>
                    <span className="insight-icon" aria-hidden="true"><Icon size={17} /></span>
                    <span>{i.text}</span>
                    <ChevronRight size={17} className="muted" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <div className="two-col">
        <Section
          title="Upcoming recurring purchases"
          action={<button type="button" className="link" onClick={() => go('recurring')}>All recurring</button>}
        >
          {upcoming.length === 0 ? (
            <div className="card">
              <EmptyState icon={Repeat} title="Nothing due this week" body="Recurring purchases due in the next 7 days show up here." />
            </div>
          ) : (
            <ul className="card rows">
              {upcoming.slice(0, 5).map((r) => {
                const listed = itemForRecurring(data, r);
                const due = r.nextDue <= today;
                return (
                  <li key={r.id} className="row">
                    <CategoryIcon category={categoryById(data.categories, r.categoryId)} />
                    <div className="row-body">
                      <span className="row-title">{r.name}</span>
                      <span className="row-meta">
                        {frequencyLabel(r.frequency)}, due {relativeDay(r.nextDue, today)} ({formatDate(r.nextDue, dateFormat)})
                      </span>
                    </div>
                    {listed ? (
                      <Chip tone="good">{listed.status === 'deferred' ? 'Deferred' : 'On list'}</Chip>
                    ) : (
                      <button
                        type="button"
                        className={`btn btn-small ${due ? 'btn-primary' : ''}`}
                        aria-label={`Add ${r.name} to the shopping list`}
                        onClick={() => { apply((d) => addRecurringToList(d, r.id, new Date())); toast(`Added ${r.name}`); }}
                      >
                        Add
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section
          title="Replenishment reminders"
          action={<button type="button" className="link" onClick={() => go('suggestions')}>All suggestions</button>}
        >
          {need.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={Lightbulb}
                title="No reminders yet"
                body="Once you have bought something at least twice, Replenish estimates when you may need it again."
              />
            </div>
          ) : (
            <ul className="card rows">
              {need.slice(0, 5).map((r) => (
                <li key={r.key} className="row">
                  <CategoryIcon category={categoryById(data.categories, r.categoryId)} />
                  <div className="row-body">
                    <span className="row-title">{r.name}</span>
                    <span className="row-meta">
                      Every {pluralDays(r.usedInterval)}, last bought {relativeDay(r.lastPurchased, today)}
                    </span>
                  </div>
                  <Chip tone={r.level === 'due' ? 'warn' : 'neutral'}>{LEVEL_LABEL[r.level]}</Chip>
                  <button
                    type="button"
                    className="btn btn-small"
                    aria-label={`Add ${r.name} to the shopping list`}
                    onClick={() => {
                      apply((d) =>
                        addItem(d, {
                          name: r.name, quantity: r.typicalQuantity, unit: r.unit, categoryId: resolveCategory(d, r.name, r.categoryId), priority: 'normal',
                          estimatedPrice: r.avgPrice !== undefined ? Math.round(r.avgPrice * 100) / 100 : undefined,
                        }, new Date()),
                      );
                      toast(`Added ${r.name} ${formatQty(r.typicalQuantity, r.unit)}`);
                    }}
                  >
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
