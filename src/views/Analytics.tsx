import { useState } from 'react';
import { ChartColumn } from 'lucide-react';
import {
  budgetStatus, categorySpend, defaultRange, filterDeferrals, filterHistory, monthlySpend, summarize, topItems,
  weeklySpend, type RangeFilter,
} from '../lib/analytics';
import { pluralDays } from '../lib/dates';
import { formatMoney, plural } from '../lib/format';
import { useStore } from '../state/store';
import { ChartCard, RankBars, ShareBar, TimeBars } from '../components/charts';
import { RangeControls } from '../components/RangeControls';
import { EmptyState, PageHeader, ProgressBar } from '../components/ui';
import { formatDate } from '../lib/dates';

export function Analytics() {
  const { data, today, go } = useStore();
  const { currency } = data.settings;
  const [filter, setFilter] = useState<RangeFilter>(() => defaultRange(today));
  const money = (v: number) => formatMoney(v, currency);
  const wholeMoney = (v: number) => formatMoney(v, currency).replace(/[.,]00$/, '');

  const records = filterHistory(data.history, filter, today);
  const deferrals = filterDeferrals(data.deferrals, filter, today);
  const sum = summarize(records, data.history, filter, today);
  const weekly = weeklySpend(records, filter, today);
  const monthly = monthlySpend(records, filter, today);
  const byCategory = categorySpend(records, data.categories);
  const top = topItems(records);
  const hasSpend = records.some((r) => (r.price ?? 0) > 0);
  const spending = budgetStatus(data, today);

  if (data.history.length === 0) {
    return (
      <>
        <PageHeader title="Analytics" subtitle="Spending and purchasing habits" />
        <div className="card">
          <EmptyState
            icon={ChartColumn}
            title="No purchases to analyse yet"
            body="Spending charts and purchasing habits appear after you tick off items from your shopping list."
            action={<button type="button" className="btn" onClick={() => go('list')}>Open shopping list</button>}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Analytics" subtitle="Spending and purchasing habits" />
      <RangeControls filter={filter} onChange={setFilter} categories={data.categories} />

      <dl className="stats">
        <div className="stat"><dt>Spent this week</dt><dd>{money(sum.thisWeek)}</dd></div>
        <div className="stat"><dt>Spent this month</dt><dd>{money(sum.thisMonth)}</dd></div>
        <div className="stat"><dt>Spent in this period</dt><dd>{money(sum.totalSpent)}</dd></div>
        <div className="stat"><dt>Total purchases</dt><dd>{sum.totalPurchases}</dd></div>
        <div className="stat"><dt>Purchases per week</dt><dd>{sum.perWeek.toFixed(1)}</dd></div>
        <div className="stat">
          <dt>Average gap between repeat buys</dt>
          <dd>{sum.avgRepeatGap !== null ? pluralDays(sum.avgRepeatGap) : 'Not enough data'}</dd>
        </div>
      </dl>
      {sum.unpriced > 0 && (
        <p className="fine">
          {plural(sum.unpriced, 'purchase has', 'purchases have')} no price recorded, so spending figures are a minimum.
        </p>
      )}

      <section className="card budget-card">
        <div className="chart-head">
          <div>
            <h2>Budget this {spending.period}</h2>
            <p>Actual spending since {formatDate(spending.start, data.settings.dateFormat)}, whatever period is selected above</p>
          </div>
          <button type="button" className="btn btn-small btn-quiet" onClick={() => go('settings')}>Set budgets</button>
        </div>
        {spending.lines.length === 0 ? (
          <p className="chart-empty">No spending budgets set. Add a weekly or monthly limit, overall or per category, in Settings.</p>
        ) : (
          <ul className="budget-lines">
            {spending.lines.map((line) => {
              const over = line.spent > line.budget;
              return (
                <li key={line.id}>
                  <div className="budget-line">
                    <span>{line.label}</span>
                    <span>
                      <strong>{money(line.spent)}</strong> of {money(line.budget)}
                      {over ? `, ${money(line.spent - line.budget)} over` : ''}
                    </span>
                  </div>
                  <ProgressBar value={line.spent} max={line.budget} tone={over ? 'alert' : 'accent'} label={`${line.label} spending against budget`} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="chart-grid">
        <ChartCard
          title="Weekly spending"
          subtitle="Weeks start on Monday"
          columns={['Week starting', 'Spent']}
          rows={hasSpend ? weekly.map((b) => ({ label: b.label, value: money(b.value) })) : []}
          empty="No priced purchases in this period."
        >
          <TimeBars data={weekly} format={wholeMoney} label="Weekly spending" />
        </ChartCard>

        <ChartCard
          title="Monthly spending"
          columns={['Month', 'Spent']}
          rows={hasSpend ? monthly.map((b) => ({ label: b.label, value: money(b.value) })) : []}
          empty="No priced purchases in this period."
        >
          <TimeBars data={monthly} format={wholeMoney} label="Monthly spending" />
        </ChartCard>

        <ChartCard
          title="Most expensive categories"
          subtitle="Total spent per category"
          columns={['Category', 'Spent']}
          rows={byCategory.map((b) => ({ label: b.label, value: money(b.value) }))}
          empty="No priced purchases in this period."
        >
          <RankBars data={byCategory} format={money} />
        </ChartCard>

        <ChartCard
          title="Most frequently purchased"
          subtitle="Number of purchases per product"
          columns={['Product', 'Purchases']}
          rows={top.map((b) => ({ label: b.label, value: String(b.value) }))}
          empty="No purchases in this period."
        >
          <RankBars data={top} format={(v) => String(v)} />
        </ChartCard>

        <ChartCard
          title="Deferred versus completed"
          subtitle="Purchases completed against times a purchase was put off, in this period"
          columns={['Outcome', 'Count']}
          rows={
            records.length + deferrals.length > 0
              ? [
                  { label: 'Completed purchases', value: String(records.length) },
                  { label: 'Deferrals', value: String(deferrals.length) },
                ]
              : []
          }
          empty="No purchases or deferrals in this period."
        >
          <ShareBar
            a={{ label: 'Completed', value: records.length }}
            b={{ label: 'Deferred', value: deferrals.length }}
          />
        </ChartCard>
      </div>
    </>
  );
}
