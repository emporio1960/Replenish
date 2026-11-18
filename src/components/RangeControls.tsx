import type { Category } from '../types';
import { RANGE_LABELS, type RangeFilter, type RangePreset } from '../lib/analytics';

interface Props {
  filter: RangeFilter;
  onChange: (f: RangeFilter) => void;
  categories: Category[];
}

/** Date-range and category filters shared by Purchase History and Analytics. */
export function RangeControls({ filter, onChange, categories }: Props) {
  return (
    <div className="filters">
      <label className="filter">
        <span>Period</span>
        <select value={filter.preset} onChange={(e) => onChange({ ...filter, preset: e.target.value as RangePreset })}>
          {(Object.keys(RANGE_LABELS) as RangePreset[]).map((p) => (
            <option key={p} value={p}>{RANGE_LABELS[p]}</option>
          ))}
        </select>
      </label>
      {filter.preset === 'custom' && (
        <>
          <label className="filter">
            <span>From</span>
            <input type="date" value={filter.from} max={filter.to || undefined} onChange={(e) => onChange({ ...filter, from: e.target.value })} />
          </label>
          <label className="filter">
            <span>To</span>
            <input type="date" value={filter.to} min={filter.from || undefined} onChange={(e) => onChange({ ...filter, to: e.target.value })} />
          </label>
        </>
      )}
      <label className="filter">
        <span>Category</span>
        <select value={filter.categoryId} onChange={(e) => onChange({ ...filter, categoryId: e.target.value })}>
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
    </div>
  );
}
