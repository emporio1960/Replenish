import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Recipe } from '../types';
import { formatDate, shortDate } from '../lib/dates';
import { isLikelyDuplicate } from '../lib/duplicates';
import { formatMoney, formatQty, plural, uid } from '../lib/format';
import { formatLine, parseList } from '../lib/parseList';
import { buildItemStats } from '../lib/replenishment';
import { cameraSupported, isBarcode, lookupBarcode, startScanner } from '../lib/scanner';
import { addParsed, learnBarcode, purchaseItem, saveRecipe } from '../state/actions';
import { useStore } from '../state/store';
import { TimeBars } from './charts';
import { Field, Modal } from './ui';

/** Adds a whole typed or pasted list in one go. */
export function PasteList() {
  const { data, apply, closeModal, toast } = useStore();
  const [text, setText] = useState('');
  const lines = useMemo(() => parseList(text), [text]);

  function add() {
    const after = addParsed(data, lines, new Date());
    const added = after.items.length - data.items.length;
    apply((d) => addParsed(d, lines, new Date()));
    const skipped = lines.length - added;
    toast(`Added ${plural(added, 'item')}${skipped ? `, ${skipped} already on your list` : ''}`);
    closeModal();
  }

  return (
    <Modal
      title="Add several items"
      onClose={closeModal}
      footer={
        <>
          <button type="button" className="btn btn-quiet" onClick={closeModal}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={lines.length === 0} onClick={add}>
            {lines.length ? `Add ${plural(lines.length, 'item')}` : 'Add items'}
          </button>
        </>
      }
    >
      <div className="form">
        <Field label="One item per line" hint="Quantities are picked up from lines such as 2 kg tomatoes, milk 2L or eggs x12.">
          <textarea
            data-autofocus
            rows={7}
            value={text}
            placeholder={'2 kg tomatoes\nmilk 2L\nbread\neggs x12'}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        {lines.length > 0 && (
          <ul className="parsed">
            {lines.slice(0, 30).map((l, i) => (
              <li key={i}><span>{l.name}</span><span className="muted">{formatQty(l.quantity, l.unit)}</span></li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

export function RecipeForm({ recipe }: { recipe?: Recipe }) {
  const { apply, closeModal, toast } = useStore();
  const [name, setName] = useState(recipe?.name ?? '');
  const [text, setText] = useState(recipe?.ingredients.map(formatLine).join('\n') ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ingredients = parseList(text);
    const err: Record<string, string> = {};
    if (!name.trim()) err.name = 'Enter a name for this meal.';
    if (ingredients.length === 0) err.text = 'Add at least one ingredient.';
    setErrors(err);
    if (Object.keys(err).length) return;
    apply((d) => saveRecipe(d, { id: recipe?.id ?? `meal-${uid()}`, name: name.trim(), ingredients, sample: recipe?.sample }));
    toast(`Saved ${name.trim()}`);
    closeModal();
  }

  return (
    <Modal
      title={recipe ? 'Edit meal' : 'New meal'}
      onClose={closeModal}
      footer={
        <>
          <button type="button" className="btn btn-quiet" onClick={closeModal}>Cancel</button>
          <button type="submit" form="recipe-form" className="btn btn-primary">Save meal</button>
        </>
      }
    >
      <form id="recipe-form" className="form" onSubmit={onSubmit} noValidate>
        <Field label="Meal" error={errors.name}>
          <input data-autofocus value={name} maxLength={80} autoComplete="off" placeholder="Such as chicken curry" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Ingredients, one per line" error={errors.text} hint="Include quantities where they matter, such as 500 g beef mince.">
          <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

/** What a product has cost over time. */
export function ProductModal({ productKey }: { productKey: string }) {
  const { data, closeModal } = useStore();
  const { currency, dateFormat } = data.settings;
  const stats = useMemo(() => buildItemStats(data.history).find((s) => s.key === productKey), [data.history, productKey]);
  if (!stats) return null;
  const money = (v: number) => formatMoney(v, currency);
  const prices = stats.prices;
  const paid = prices.map((p) => p.price);
  const recent = prices.slice(-12);
  const usual = stats.usualUnitPrice !== undefined ? stats.usualUnitPrice * stats.typicalQuantity : undefined;

  return (
    <Modal title={stats.name} onClose={closeModal}>
      <div className="form">
        <dl className="facts">
          <div><dt>Bought</dt><dd>{plural(stats.count, 'time')}, usually {formatQty(stats.typicalQuantity, stats.unit)}</dd></div>
          <div><dt>Usual price</dt><dd>{usual !== undefined ? money(usual) : 'No prices recorded'}</dd></div>
          {paid.length > 0 && (
            <>
              <div><dt>Lowest and highest paid</dt><dd>{money(Math.min(...paid))} to {money(Math.max(...paid))}</dd></div>
              <div><dt>Last paid</dt><dd>{money(paid[paid.length - 1])} on {formatDate(prices[prices.length - 1].day, dateFormat)}</dd></div>
            </>
          )}
        </dl>
        {recent.length >= 2 ? (
          <TimeBars
            label={`Price paid for ${stats.name}`}
            format={money}
            data={recent.map((p) => ({
              label: shortDate(p.day),
              detail: `${formatDate(p.day, dateFormat)}, ${formatQty(p.quantity, stats.unit)}`,
              value: p.price,
            }))}
          />
        ) : (
          <p className="muted">A price chart appears once this has been bought at least twice with a price recorded.</p>
        )}
        <p className="fine">The usual price is the middle (median) price per unit across your purchases, for your typical quantity.</p>
      </div>
    </Modal>
  );
}

/** Scan a product barcode to tick it off or add it to the list. */
export function ScanModal() {
  const { data, apply, closeModal, toast } = useStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [code, setCode] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [manual, setManual] = useState('');
  const [status, setStatus] = useState<'starting' | 'scanning' | 'unavailable'>('starting');
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState('');
  const barcodes = data.barcodes;
  const lookupOn = data.settings.barcodeLookup;

  const found = useRef<(c: string) => void>(() => {});
  found.current = (c: string) => {
    if (code) return;
    setCode(c);
    setError('');
    const known = barcodes[c];
    setName(known ?? '');
    if (!known && lookupOn) {
      setLooking(true);
      void lookupBarcode(c).then((result) => {
        setLooking(false);
        if (result) setName((current) => current || result);
      });
    }
  };

  useEffect(() => {
    if (code) return;
    const video = videoRef.current;
    if (!video || !cameraSupported()) {
      setStatus('unavailable');
      return;
    }
    let cancelled = false;
    let stop = () => {};
    setStatus('starting');
    startScanner(video, (c) => found.current(c))
      .then((s) => {
        if (cancelled) s();
        else {
          stop = s;
          setStatus('scanning');
        }
      })
      .catch(() => !cancelled && setStatus('unavailable'));
    return () => {
      cancelled = true;
      stop();
    };
  }, [code]);

  const match = name.trim()
    ? data.items.find((i) => i.status === 'active' && isLikelyDuplicate(i.name, name))
    : undefined;

  function finish(action: 'buy' | 'add') {
    const product = name.trim();
    if (!product || !code) return setError('Enter the product name.');
    const scanned = code;
    apply((d) => {
      let next = learnBarcode(d, scanned, product);
      if (action === 'buy' && match) next = purchaseItem(next, match.id, new Date());
      else next = addParsed(next, [{ name: product, quantity: 1, unit: 'units' }], new Date());
      return next;
    });
    if (action === 'buy' && match) toast(`Purchased ${match.name}`);
    else toast(data.items.some((i) => i.status !== 'purchased' && isLikelyDuplicate(i.name, product)) ? `${product} is already on your list` : `Added ${product}`);
    setCode(null);
    setName('');
    setManual('');
  }

  return (
    <Modal title="Scan a barcode" onClose={closeModal}>
      {code ? (
        <form className="form" onSubmit={(e) => { e.preventDefault(); finish(match ? 'buy' : 'add'); }}>
          <p className="lead">Barcode {code}</p>
          <Field
            label="Product"
            error={error}
            hint={
              looking ? 'Looking this barcode up…'
                : barcodes[code] ? 'Recognised from an earlier scan.'
                : 'New barcode. Name it once and Replenish remembers it.'
            }
          >
            <input data-autofocus value={name} maxLength={80} autoComplete="off" onChange={(e) => { setName(e.target.value); setError(''); }} />
          </Field>
          <div className="stack">
            {match && (
              <button type="submit" className="btn btn-primary">Mark {match.name} as purchased</button>
            )}
            <button type="button" className={`btn ${match ? '' : 'btn-primary'}`} onClick={() => finish('add')}>Add to list</button>
            <button type="button" className="btn btn-quiet" onClick={() => { setCode(null); setName(''); }}>Scan a different barcode</button>
          </div>
        </form>
      ) : (
        <div className="form">
          <div className={`scan-view ${status === 'unavailable' ? 'is-off' : ''}`}>
            <video ref={videoRef} playsInline muted aria-label="Camera view" />
            {status === 'scanning' && <span className="scan-line" aria-hidden="true" />}
            {status !== 'scanning' && (
              <p>{status === 'starting' ? 'Starting the camera…' : 'The camera is not available here. Allow camera access for this site, or type the number below.'}</p>
            )}
          </div>
          <p className="fine" role="status">{status === 'scanning' ? 'Hold the barcode steady inside the frame.' : ''}</p>
          <form
            className="form-row align-end"
            onSubmit={(e) => {
              e.preventDefault();
              const typed = manual.replace(/\s/g, '');
              if (isBarcode(typed)) found.current(typed);
              else setError('Enter the 6 to 14 digits printed under the barcode.');
            }}
          >
            <Field label="Or type the barcode number" error={error}>
              <input value={manual} inputMode="numeric" autoComplete="off" onChange={(e) => { setManual(e.target.value); setError(''); }} />
            </Field>
            <button type="submit" className="btn">Use number</button>
          </form>
        </div>
      )}
    </Modal>
  );
}
