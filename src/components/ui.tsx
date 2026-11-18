import { useEffect, useId, useRef, type ReactNode } from 'react';
import {
  Apple, Bath, Croissant, CupSoda, Fish, Milk, PawPrint, Pill, ShoppingBasket, Snowflake,
  SprayCan, Tag, Wheat, X, type LucideIcon,
} from 'lucide-react';
import type { Category } from '../types';

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  apple: Apple, fish: Fish, milk: Milk, croissant: Croissant, wheat: Wheat, snowflake: Snowflake,
  cup: CupSoda, spray: SprayCan, bath: Bath, paw: PawPrint, pill: Pill, basket: ShoppingBasket, tag: Tag,
};

export function CategoryIcon({ category, size = 36 }: { category: Category; size?: number }) {
  const Icon = CATEGORY_ICONS[category.icon] ?? Tag;
  return (
    <span
      className="cat-icon"
      style={{ width: size, height: size, ['--cat' as string]: category.color }}
      aria-hidden="true"
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={2} />
    </span>
  );
}

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/** Bottom sheet on phones, centred dialog on larger screens. */
export function Modal({ title, onClose, children, footer }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusable = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    (node?.querySelector<HTMLElement>('[data-autofocus]') ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Tab') {
        const els = focusable();
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
      previous?.focus?.();
    };
    // The dialog is mounted once per opening; onClose identity changes are irrelevant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon, title, body, action,
}: { icon: LucideIcon; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden="true"><Icon size={26} /></span>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function Field({
  label, error, hint, children, className = '',
}: { label: string; error?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error" role="alert">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Segmented<T extends string>({
  label, options, value, onChange,
}: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? 'is-on' : ''}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  label, description, checked, onChange,
}: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span>
        <span className="toggle-label">{label}</span>
        {description && <span className="toggle-desc">{description}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

export function ProgressBar({ value, max, tone = 'accent', label }: { value: number; max: number; tone?: 'accent' | 'alert' | 'good'; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      className={`bar bar-${tone}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Section({
  title, action, children, className = '',
}: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`section ${className}`}>
      <div className="section-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Chip({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'alert' | 'accent'; children: ReactNode }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}
