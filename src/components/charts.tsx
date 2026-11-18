import { useState, type ReactNode } from 'react';
import { Table2 } from 'lucide-react';
import type { Bucket } from '../lib/analytics';

/** Rounds a maximum up to a tidy axis value (1, 2, 2.5, 5 x 10^n). */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const n = max / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}

interface ChartCardProps {
  title: string;
  subtitle?: string;
  /** Rows for the table view: every chart can also be read as plain numbers. */
  rows: { label: string; value: string }[];
  columns: [string, string];
  empty: string;
  children: ReactNode;
}

export function ChartCard({ title, subtitle, rows, columns, empty, children }: ChartCardProps) {
  const [table, setTable] = useState(false);
  return (
    <section className="card chart-card">
      <div className="chart-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {rows.length > 0 && (
          <button type="button" className="btn btn-small btn-quiet" aria-pressed={table} onClick={() => setTable((t) => !t)}>
            <Table2 size={15} aria-hidden="true" /> {table ? 'Chart' : 'Table'}
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="chart-empty">{empty}</p>
      ) : table ? (
        <table className="data-table">
          <thead><tr><th scope="col">{columns[0]}</th><th scope="col" className="num">{columns[1]}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}><th scope="row">{r.label}</th><td className="num">{r.value}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        children
      )}
    </section>
  );
}

/** Vertical bars over time. One series, one hue; hover, focus or tap a bar for its value. */
export function TimeBars({ data, format, label }: { data: Bucket[]; format: (v: number) => string; label: string }) {
  const [picked, setPicked] = useState<number | null>(null);
  const max = niceMax(Math.max(...data.map((d) => d.value)));
  const shown = picked !== null && picked < data.length ? picked : data.length - 1;
  const every = Math.ceil(data.length / 6);
  return (
    <div className="tbars">
      <p className="tbars-readout" aria-live="polite">
        <span>{data[shown].detail}</span>
        <strong>{format(data[shown].value)}</strong>
      </p>
      <div className="tbars-plot" role="group" aria-label={label} onMouseLeave={() => setPicked(null)}>
        <div className="tbars-grid" aria-hidden="true">
          {[1, 0.5, 0].map((f) => (
            <span key={f} style={{ bottom: `${f * 100}%` }}><em>{format(max * f)}</em></span>
          ))}
        </div>
        {data.map((d, i) => (
          <button
            key={i}
            type="button"
            className={`tbar ${i === shown ? 'is-on' : ''}`}
            aria-label={`${d.detail}: ${format(d.value)}`}
            onMouseEnter={() => setPicked(i)}
            onFocus={() => setPicked(i)}
            onClick={() => setPicked(i)}
          >
            <span style={{ height: `${(d.value / max) * 100}%` }} />
          </button>
        ))}
      </div>
      <div className="tbars-x" aria-hidden="true">
        {data.map((d, i) => (
          <span key={i}>{(data.length - 1 - i) % every === 0 ? d.label : ''}</span>
        ))}
      </div>
    </div>
  );
}

/** Ranked horizontal bars with the value written beside each one. */
export function RankBars({ data, format }: { data: Bucket[]; format: (v: number) => string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ul className="rbars">
      {data.map((d) => (
        <li key={d.label} title={`${d.label}: ${format(d.value)}`}>
          <span className="rbars-label">{d.label}</span>
          <span className="rbars-track"><span style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }} /></span>
          <span className="rbars-value">{format(d.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Two-part share bar with both parts labelled directly. */
export function ShareBar({ a, b }: { a: { label: string; value: number }; b: { label: string; value: number } }) {
  const total = a.value + b.value;
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);
  return (
    <div className="share">
      <div className="share-bar" role="img" aria-label={`${a.label} ${a.value}, ${b.label} ${b.value}`}>
        {a.value > 0 && <span className="share-a" style={{ flexGrow: a.value }} />}
        {b.value > 0 && <span className="share-b" style={{ flexGrow: b.value }} />}
      </div>
      <div className="share-legend">
        <span><i className="share-a" aria-hidden="true" /> {a.label} <strong>{a.value}</strong> <em>{pct(a.value)}%</em></span>
        <span><i className="share-b" aria-hidden="true" /> {b.label} <strong>{b.value}</strong> <em>{pct(b.value)}%</em></span>
      </div>
    </div>
  );
}
