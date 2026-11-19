import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ClipboardPaste, Copy, Download, FileUp, ListTodo, Mail, MessageSquare, NotebookPen, Share2, Undo2, Zap,
} from 'lucide-react';
import { UNITS, type ImportSource, type Unit } from '../types';
import { categoryById } from '../lib/categories';
import { formatDate, formatTime } from '../lib/dates';
import {
  buildShare, FORMAT_LABELS, selectItems, type ShareFormat, type ShareOptions, type ShareScope,
} from '../lib/exportList';
import { formatQty, parseNumber, plural } from '../lib/format';
import { findMatches, parseImport, type DraftMatches, type ImportDraft, type ParsedImport } from '../lib/importParser';
import { importLinkBase, INCOMING_EVENT, takeIncoming } from '../lib/incoming';
import { canUndoImport, importItems, undoImport, type ImportEntry } from '../state/actions';
import { useStore } from '../state/store';
import { CategoryIcon, Chip, EmptyState, PageHeader, Section, Toggle } from '../components/ui';

type Panel =
  | { kind: 'home' }
  | { kind: 'import'; source: ImportSource; text?: string }
  | { kind: 'review'; source: ImportSource; parsed: ParsedImport }
  | { kind: 'export'; format: ShareFormat };

const SOURCE_LABEL: Record<ImportSource, string> = {
  reminders: 'Apple Reminders', notes: 'Apple Notes', file: 'a file', shared: 'the share sheet', shortcut: 'an Apple Shortcut',
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function Steps({ current }: { current: 1 | 2 }) {
  return (
    <ol className="steps-bar" aria-label="Import progress">
      {['Add your list', 'Review and confirm', 'Imported'].map((label, i) => (
        <li key={label} className={i + 1 === current ? 'is-current' : i + 1 < current ? 'is-done' : ''} aria-current={i + 1 === current ? 'step' : undefined}>
          <span>{i + 1}</span> {label}
        </li>
      ))}
    </ol>
  );
}

/* ---------- step 1: bring the list in ---------- */

function ImportPanel({ source, initial, onBack, onParsed }: {
  source: ImportSource; initial?: string; onBack: () => void; onParsed: (parsed: ParsedImport, source: ImportSource) => void;
}) {
  const { data } = useStore();
  const [text, setText] = useState(initial ?? '');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const fromNotes = source === 'notes';

  function review(raw: string, from: ImportSource, hint?: 'txt' | 'csv' | 'json') {
    try {
      const parsed = parseImport(raw, data, hint);
      if (!parsed.drafts.length) return setError('No shopping items were found in that. Check that each item is on its own line.');
      setError('');
      onParsed(parsed, from);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be read.');
    }
  }

  async function paste() {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip.trim()) return setError('The clipboard is empty. Copy your list first.');
      setText(clip);
      setError('');
    } catch {
      setError('This browser did not allow reading the clipboard. Tap in the box, then choose Paste.');
    }
  }

  async function chooseFile(file: File) {
    if (file.size > 1_000_000) return setError('That file is larger than 1 MB. Shopping lists are much smaller; check you picked the right file.');
    const ext = file.name.toLowerCase().split('.').pop() ?? '';
    if (!['txt', 'text', 'md', 'csv', 'json'].includes(ext) && !/^text\/|json|csv/.test(file.type)) {
      return setError('Choose a TXT, CSV or JSON file. Other documents (such as PDF or Pages) cannot be read; copy and paste their text instead.');
    }
    try {
      review(await file.text(), 'file', ext === 'csv' ? 'csv' : ext === 'json' ? 'json' : 'txt');
    } catch {
      setError('That file could not be read.');
    }
  }

  return (
    <>
      <button type="button" className="btn btn-quiet back-link" onClick={onBack}><ArrowLeft size={17} aria-hidden="true" /> Import &amp; Share</button>
      <PageHeader title={`Import from ${source === 'reminders' || source === 'notes' ? SOURCE_LABEL[source] : 'a list'}`} />
      <Steps current={1} />
      <section className="card form">
        <ol className="steps">
          {fromNotes ? (
            <>
              <li>In Notes, open the note with your shopping list.</li>
              <li>Tap in the list, choose Select All, then Copy. (Or use Share, then Copy.)</li>
              <li>Come back here and tap Paste from clipboard.</li>
            </>
          ) : (
            <>
              <li>In Reminders, open your shopping list.</li>
              <li>Tap the More button (three dots), choose Select Reminders, select the ones you want, then use Share or Copy. On a Mac, select the reminders and press Command-C.</li>
              <li>Come back here and tap Paste from clipboard.</li>
            </>
          )}
        </ol>
        <p className="fine">
          A website cannot read {fromNotes ? 'Notes' : 'Reminders'} directly, so the list comes across by copy and paste, a file, or an Apple Shortcut.
          Bullets, numbers, checkboxes, quantities and headings are all understood. Nothing is added until you have reviewed it.
        </p>
        <label className="field">
          <span className="field-label">Your list</span>
          <textarea
            rows={8}
            value={text}
            placeholder={'Shopping List\n- 2L milk\n- Bread\n- [x] Eggs\n- 500g chicken mince'}
            onChange={(e) => { setText(e.target.value); setError(''); }}
          />
          {error && <span className="field-error" role="alert">{error}</span>}
        </label>
        <div className="row-wrap">
          <button type="button" className="btn" onClick={() => void paste()}><ClipboardPaste size={16} aria-hidden="true" /> Paste from clipboard</button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}><FileUp size={16} aria-hidden="true" /> Choose a file</button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.text,.md,.csv,.json,text/plain,text/csv,application/json"
            className="sr-only"
            tabIndex={-1}
            aria-label="Choose a TXT, CSV or JSON file to import"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void chooseFile(file);
            }}
          />
          <button type="button" className="btn btn-primary" disabled={!text.trim()} onClick={() => review(text, source)}>Review items</button>
        </div>
        <p className="fine">Files: TXT, CSV (with or without a header row) and JSON.</p>
      </section>
    </>
  );
}

/* ---------- step 2: review, edit, choose ---------- */

interface Row extends ImportDraft {
  selected: boolean;
  action: 'add' | 'merge' | 'replace';
  matches: DraftMatches;
  autoCategory: string;
  qtyText: string;
}

function ReviewPanel({ parsed, source, onBack, onDone }: {
  parsed: ParsedImport; source: ImportSource; onBack: () => void; onDone: () => void;
}) {
  const { data, apply, toast, openModal } = useStore();
  const [listName, setListName] = useState(parsed.listName ?? '');
  const [rows, setRows] = useState<Row[]>(() =>
    parsed.drafts.map((d) => {
      const matches = findMatches(d, data, parsed.drafts);
      const duplicate = Boolean(matches.existing) || matches.repeated;
      return {
        ...d, matches, autoCategory: d.categoryId, qtyText: String(d.quantity),
        // Ticked-off items and anything already in Replenish start unselected: the user opts in.
        selected: !duplicate && !d.completed,
        action: matches.existing ? (matches.existing.unit === d.unit ? 'merge' : 'add') : 'add',
      };
    }),
  );
  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const isDup = (r: Row) => Boolean(r.matches.existing) || r.matches.repeated;
  const chosen = rows.filter((r) => r.selected);
  const invalid = chosen.filter((r) => !r.name.trim() || !(Number(parseNumber(r.qtyText)) > 0));
  const counts = {
    present: rows.filter((r) => r.matches.existing).length,
    possible: rows.filter((r) => !r.matches.existing && (r.matches.repeated || r.matches.purchased || r.matches.recurring)).length,
    completed: rows.filter((r) => r.completed).length,
  };
  const fresh = rows.length - rows.filter(isDup).length;

  function confirm() {
    const entries: ImportEntry[] = chosen.map((r) => ({
      name: r.name, quantity: Number(parseNumber(r.qtyText)), unit: r.unit, notes: r.notes, categoryId: r.categoryId,
      action: r.matches.existing ? r.action : 'add', existingId: r.matches.existing?.id,
      corrected: r.categoryId !== r.autoCategory,
    }));
    const skipped = rows.length - chosen.length;
    apply((d) => {
      const next = importItems(d, entries, { source, listName }, new Date());
      const record = next.imports[next.imports.length - 1];
      return { ...next, imports: [...next.imports.slice(0, -1), { ...record, skipped: record.skipped + skipped }] };
    });
    toast(`Imported ${plural(chosen.length, 'item')}`, {
      label: 'Undo',
      run: () => apply((d) => { const last = d.imports[d.imports.length - 1]; return last ? undoImport(d, last.id) : d; }),
    });
    onDone();
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-quiet back-link"
        onClick={() =>
          openModal({
            type: 'confirm', title: 'Cancel this import?', body: 'Nothing has been added to Replenish. The list you pasted will be discarded.',
            confirmLabel: 'Cancel import', onConfirm: onBack,
          })
        }
      >
        <ArrowLeft size={17} aria-hidden="true" /> Cancel import
      </button>
      <PageHeader title="Review import" subtitle={`From ${SOURCE_LABEL[source]}. Nothing is added until you confirm.`} />
      <Steps current={2} />

      <section className="card form">
        <label className="field">
          <span className="field-label">List name</span>
          <input value={listName} maxLength={80} placeholder="No name detected" onChange={(e) => setListName(e.target.value)} />
        </label>
        <dl className="facts import-facts">
          <div><dt>Items detected</dt><dd>{rows.length}</dd></div>
          <div><dt>New</dt><dd>{fresh}</dd></div>
          <div><dt>Already in Replenish</dt><dd>{counts.present}</dd></div>
          <div><dt>Possible duplicates</dt><dd>{counts.possible}</dd></div>
          <div><dt>Ticked off in the original</dt><dd>{counts.completed}</dd></div>
          <div><dt>Lines not treated as items</dt><dd>{parsed.ignored}</dd></div>
        </dl>
        <div className="row-wrap">
          <button type="button" className="btn btn-small" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, selected: true })))}>Select all</button>
          <button type="button" className="btn btn-small" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, selected: false })))}>Select none</button>
          <button type="button" className="btn btn-small" onClick={() => setRows((rs) => rs.map((r) => (isDup(r) ? { ...r, selected: false } : r)))}>Exclude duplicates</button>
          <button type="button" className="btn btn-small" onClick={() => setRows((rs) => rs.map((r) => (r.completed ? { ...r, selected: false } : r)))}>Exclude ticked off</button>
        </div>
      </section>

      <ul className="import-rows">
        {rows.map((r) => {
          const category = categoryById(data.categories, r.categoryId);
          const m = r.matches;
          return (
            <li key={r.key} className={`card import-row ${r.selected ? '' : 'is-off'}`}>
              <div className="import-top">
                <input
                  type="checkbox"
                  className="pick"
                  checked={r.selected}
                  aria-label={`Import ${r.name}`}
                  onChange={(e) => update(r.key, { selected: e.target.checked })}
                />
                <CategoryIcon category={category} size={30} />
                <input className="import-name" value={r.name} maxLength={80} aria-label="Item name" onChange={(e) => update(r.key, { name: e.target.value })} />
              </div>
              <div className="import-fields">
                <input className="import-qty" value={r.qtyText} inputMode="decimal" aria-label={`Quantity of ${r.name}`} onChange={(e) => update(r.key, { qtyText: e.target.value })} />
                <select value={r.unit} aria-label={`Unit for ${r.name}`} onChange={(e) => update(r.key, { unit: e.target.value as Unit })}>
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
                <select value={r.categoryId} aria-label={`Category for ${r.name}`} onChange={(e) => update(r.key, { categoryId: e.target.value })}>
                  {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="row-chips">
                {!isDup(r) && <Chip tone="good">New</Chip>}
                {m.existing && <Chip tone="warn">{m.existing.status === 'deferred' ? 'Already deferred' : 'Already on your list'}: {m.existing.name} {formatQty(m.existing.quantity, m.existing.unit)}</Chip>}
                {m.repeated && <Chip tone="warn">Repeated in this list</Chip>}
                {m.purchased && <Chip>Bought on this list: {m.purchased.name}</Chip>}
                {m.recurring && <Chip tone="accent">Has a recurring purchase</Chip>}
                {r.completed && <Chip>Ticked off in the original</Chip>}
                {r.categorySource === 'none' && r.categoryId === r.autoCategory && <Chip>Category not recognised</Chip>}
                {r.categorySource === 'heading' && <Chip>Category from heading: {r.heading}</Chip>}
              </div>
              {r.notes && <p className="fine">Note: {r.notes}</p>}
              {m.existing && r.selected && (
                <label className="filter import-action">
                  <span>Because it is already there</span>
                  <select value={r.action} onChange={(e) => update(r.key, { action: e.target.value as Row['action'] })}>
                    {m.existing.unit === r.unit && <option value="merge">Add this quantity to it</option>}
                    <option value="add">Import as a separate item</option>
                    <option value="replace">Replace it with this one</option>
                  </select>
                </label>
              )}
            </li>
          );
        })}
      </ul>

      <div className="import-bar">
        {invalid.length > 0 && <span className="field-error" role="alert">{plural(invalid.length, 'selected item needs', 'selected items need')} a name and a quantity above zero.</span>}
        <button type="button" className="btn btn-primary" disabled={chosen.length === 0 || invalid.length > 0} onClick={confirm}>
          {chosen.length ? `Import ${plural(chosen.length, 'item')}` : 'Select items to import'}
        </button>
      </div>
    </>
  );
}

/* ---------- export and share ---------- */

function ExportPanel({ initial, onBack }: { initial: ShareFormat; onBack: () => void }) {
  const { data, today, toast } = useStore();
  const [format, setFormat] = useState<ShareFormat>(initial);
  const [scopeKind, setScopeKind] = useState<ShareScope['kind']>('remaining');
  const [categoryId, setCategoryId] = useState(data.categories[0].id);
  const [ids, setIds] = useState<string[]>([]);
  const [title, setTitle] = useState('Shopping list');
  const [headings, setHeadings] = useState(initial !== 'reminders');
  const [quantities, setQuantities] = useState(true);
  const [summary, setSummary] = useState(false);

  const onList = data.items.filter((i) => i.status !== 'deferred');
  const scope: ShareScope =
    scopeKind === 'category' ? { kind: 'category', categoryId } : scopeKind === 'selected' ? { kind: 'selected', ids } : { kind: scopeKind };
  const options: ShareOptions = { format, title, headings, quantities, summary };
  const items = selectItems(data, scope);
  const output = buildShare(data, items, options, today);
  const canShare = typeof navigator.share === 'function';
  const isFile = format === 'csv' || format === 'json';
  const usedCategories = data.categories.filter((c) => onList.some((i) => i.status === 'active' && i.categoryId === c.id));

  async function share() {
    try {
      const file = new File([output.text], output.filename, { type: output.mime });
      if (isFile && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title });
      else await navigator.share({ title, text: output.text });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) toast('Sharing was not available here. Use Copy instead.');
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([output.text], { type: output.mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = output.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Saved ${output.filename}`);
  }

  const body = encodeURIComponent(output.text);
  return (
    <>
      <button type="button" className="btn btn-quiet back-link" onClick={onBack}><ArrowLeft size={17} aria-hidden="true" /> Import &amp; Share</button>
      <PageHeader title="Share your list" subtitle="Choose what to send and where it is going" />

      <section className="card settings">
        <label className="setting">
          <span className="setting-label">Send as</span>
          <select value={format} onChange={(e) => { const f = e.target.value as ShareFormat; setHeadings(f !== 'reminders'); setFormat(f); }}>
            {(Object.keys(FORMAT_LABELS) as ShareFormat[]).map((f) => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
          </select>
        </label>
        <label className="setting">
          <span className="setting-label">What to include</span>
          <select value={scopeKind} onChange={(e) => setScopeKind(e.target.value as ShareScope['kind'])}>
            <option value="remaining">Items still to buy</option>
            <option value="all">Whole list, including bought items</option>
            <option value="category">One category</option>
            <option value="selected">Items I choose</option>
          </select>
        </label>
        {scopeKind === 'category' && (
          <label className="setting">
            <span className="setting-label">Category</span>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {(usedCategories.length ? usedCategories : data.categories).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        {scopeKind === 'selected' && (
          <div className="setting-block choose-items">
            {onList.length === 0 ? <p className="muted">Your list is empty.</p> : onList.map((i) => (
              <label key={i.id} className="choose-item">
                <input type="checkbox" checked={ids.includes(i.id)} onChange={(e) => setIds((cur) => (e.target.checked ? [...cur, i.id] : cur.filter((x) => x !== i.id)))} />
                <span>{i.name}</span>
                <span className="muted">{formatQty(i.quantity, i.unit)}{i.status === 'purchased' ? ', bought' : ''}</span>
              </label>
            ))}
          </div>
        )}
        {!isFile && format !== 'reminders' && (
          <label className="setting">
            <span className="setting-label">Title</span>
            <input className="hex title-input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
          </label>
        )}
        {format !== 'csv' && format !== 'json' && (
          <Toggle
            label="Category headings"
            description={format === 'reminders' ? 'Each heading becomes a reminder of its own, so this is usually best left off. A grocery list in Reminders sorts items into sections by itself.' : undefined}
            checked={headings}
            onChange={setHeadings}
          />
        )}
        {!isFile && <Toggle label="Quantities" checked={quantities} onChange={setQuantities} />}
        {format !== 'reminders' && format !== 'csv' && (
          <Toggle label="Summary line" description="The number of items and the estimated total. Individual prices are never shared." checked={summary} onChange={setSummary} />
        )}
      </section>

      <Section title={`Preview (${plural(output.itemCount, 'item')})`}>
        {output.itemCount === 0 ? (
          <div className="card"><p className="muted">Nothing to share with these choices.</p></div>
        ) : (
          <pre className="card share-preview" tabIndex={0} aria-label="What will be shared">{output.text}</pre>
        )}
        <div className="row-wrap share-actions">
          {canShare && (
            <button type="button" className="btn btn-primary" disabled={!output.itemCount} onClick={() => void share()}>
              <Share2 size={16} aria-hidden="true" /> Share
            </button>
          )}
          <button
            type="button"
            className={`btn ${canShare ? '' : 'btn-primary'}`}
            disabled={!output.itemCount}
            onClick={() => void copyText(output.text).then((ok) => toast(ok ? 'Copied. Paste it where you want it.' : 'Copying was not allowed. Select the preview text and copy it by hand.'))}
          >
            <Copy size={16} aria-hidden="true" /> Copy
          </button>
          <button type="button" className="btn" disabled={!output.itemCount} onClick={download}>
            <Download size={16} aria-hidden="true" /> Save as file
          </button>
          {!isFile && output.itemCount > 0 && (
            <>
              <a className="btn" href={`sms:?&body=${body}`}><MessageSquare size={16} aria-hidden="true" /> Messages</a>
              <a className="btn" href={`mailto:?subject=${encodeURIComponent(title)}&body=${body}`}><Mail size={16} aria-hidden="true" /> Email</a>
            </>
          )}
        </div>
        {!canShare && <p className="fine">This browser has no share sheet, so use Copy, Save as file, Messages or Email.</p>}
      </Section>

      <Section title={format === 'reminders' ? 'Getting it into Reminders' : 'Getting it into Notes'}>
        <div className="card">
          {format === 'reminders' ? (
            <>
              <ol className="steps">
                <li>Tap Copy.</li>
                <li>Open Reminders and open (or create) your shopping list. A list of type Groceries sorts items into sections by itself.</li>
                <li>Tap New Reminder, then paste.</li>
              </ol>
              <p className="fine">
                On iPhone, pasting several lines usually makes one reminder per line, but this varies between versions. If everything lands in a single reminder,
                use the "Replenish to Reminders" shortcut in the guide on the Import &amp; Share page, which always makes one reminder per item.
                Replenish cannot create reminders by itself: a website has no access to Reminders.
              </p>
            </>
          ) : (
            <>
              <ol className="steps">
                <li>Tap Share and choose Notes, or tap Copy and paste into a note.</li>
                <li>For a tick-off checklist in Notes: select the item lines, then tap the checklist button in the toolbar.</li>
              </ol>
              <p className="fine">
                The checkbox symbols and Markdown tick boxes are plain text. Notes does not convert them into its own checklist automatically, which is why step 2 is needed.
                CSV and JSON are best saved to Files or attached to a note with Share.
              </p>
            </>
          )}
        </div>
      </Section>
    </>
  );
}

/* ---------- Apple Shortcuts guide ---------- */

function ShortcutsGuide() {
  const { toast } = useStore();
  const link = importLinkBase();
  const site = link.replace(/#import=$/, '');
  return (
    <div className="card settings shortcuts">
      <div className="setting-block">
        <p>
          Shortcuts is Apple's automation app. It can read Reminders and Notes, which a website cannot, and hand the list to Replenish.
          You build each shortcut once in the Shortcuts app; Replenish cannot install one for you. Action names can differ slightly between iOS versions.
        </p>
        <p className="fine">Replenish's import link, used below:</p>
        <div className="link-row">
          <code>{link}</code>
          <button type="button" className="btn btn-small" onClick={() => void copyText(link).then((ok) => toast(ok ? 'Import link copied' : 'Copy the link by hand'))}>
            <Copy size={14} aria-hidden="true" /> Copy
          </button>
        </div>
        <p className="fine">
          Whatever follows <code>#import=</code> is read as a list, shown for review, and never added without your confirmation. That part of an address stays on your device; it is not sent to any server.
        </p>
      </div>

      <details className="why">
        <summary>A. Import Reminders into Replenish</summary>
        <ol className="steps">
          <li>In Shortcuts, tap + and name the shortcut "Reminders to Replenish".</li>
          <li>Add <strong>Find Reminders</strong>. Add the filter List is (your shopping list). Add Is Not Completed to leave out ticked items.</li>
          <li>Add <strong>Repeat with Each</strong>. Inside it add a <strong>Text</strong> action containing the Title of the Repeat Item. To bring notes too, type a space, a hyphen and a space after it, then add Notes.</li>
          <li>After End Repeat, add <strong>Combine Text</strong> and choose New Lines.</li>
          <li>Add <strong>URL Encode</strong>.</li>
          <li>Add another <strong>Text</strong> action: paste the import link above, then insert the URL Encoded Text straight after it.</li>
          <li>Add <strong>Open URLs</strong>.</li>
        </ol>
        <p className="fine">
          Running it opens Replenish on the review screen. If you use Replenish from its Home Screen icon, replace steps 5 to 7 with <strong>Copy to Clipboard</strong>, open Replenish yourself and tap Paste from clipboard.
          Links from Shortcuts open in Safari, and on iPhone the Home Screen app keeps its data separately from Safari unless you have sync switched on.
        </p>
        <p className="fine">
          Structured version: inside the repeat, use a <strong>Dictionary</strong> with the keys title, completed and notes; after it, a Dictionary with list (the list's name) and items (the Repeat Results). Replenish accepts that JSON in the same link:
        </p>
        <pre className="share-preview">{'{"list":"Groceries","items":[\n  {"title":"Milk","quantity":2,"unit":"L","completed":false,"notes":"full cream"},\n  {"title":"Bread","completed":true}\n]}'}</pre>
      </details>

      <details className="why">
        <summary>B. Import a shopping list from Notes</summary>
        <p>No shortcut is needed for one list: copy it in Notes and paste it under Import from Apple Notes. To send text to Replenish from the share sheet in any app:</p>
        <ol className="steps">
          <li>Create a shortcut named "Send to Replenish". In its details, switch on Show in Share Sheet and set it to receive Text.</li>
          <li>Add <strong>URL Encode</strong> with the Shortcut Input.</li>
          <li>Add a <strong>Text</strong> action: the import link above followed by the URL Encoded Text.</li>
          <li>Add <strong>Open URLs</strong>.</li>
        </ol>
        <p className="fine">Then, in Notes, select the list text, tap Share and choose Send to Replenish. This is the iPhone stand-in for a share-sheet entry of Replenish's own, which iOS does not allow for websites.</p>
      </details>

      <details className="why">
        <summary>C. Send a Replenish list to Reminders</summary>
        <ol className="steps">
          <li>Create a shortcut named "Replenish to Reminders".</li>
          <li>Add <strong>Get Clipboard</strong>.</li>
          <li>Add <strong>Split Text</strong> and choose New Lines.</li>
          <li>Add <strong>Repeat with Each</strong>. Inside it add <strong>Add New Reminder</strong>, with the Repeat Item as the title and your shopping list as the list.</li>
        </ol>
        <p className="fine">To use it: under Share your list, choose Apple Reminders, tap Copy, then run the shortcut. Each line becomes its own reminder.</p>
      </details>

      <details className="why">
        <summary>D. Share a Replenish list through Messages</summary>
        <p>The Share button already offers Messages. For a one-tap version that always goes to the same person:</p>
        <ol className="steps">
          <li>Create a shortcut named "Send shopping list".</li>
          <li>Add <strong>Get Clipboard</strong>.</li>
          <li>Add <strong>Send Message</strong>, with the Clipboard as the message and your chosen recipient.</li>
        </ol>
        <p className="fine">To use it: under Share your list, tap Copy, then run the shortcut. Replenish's address for the last step of your own shortcuts: <code>{site}</code></p>
      </details>
    </div>
  );
}

/* ---------- hub ---------- */

export function Transfer() {
  const { data, apply, toast } = useStore();
  const [panel, setPanel] = useState<Panel>({ kind: 'home' });
  const { dateFormat, time24 } = data.settings;
  const home = () => { setPanel({ kind: 'home' }); window.scrollTo({ top: 0 }); };

  // A list handed over by a Shortcut or the share sheet goes straight to review.
  useEffect(() => {
    const receive = () => {
      const incoming = takeIncoming();
      if (!incoming) return;
      try {
        const parsed = parseImport(incoming.text, data);
        if (parsed.drafts.length) setPanel({ kind: 'review', source: incoming.source, parsed });
        else setPanel({ kind: 'import', source: incoming.source, text: incoming.text });
      } catch {
        setPanel({ kind: 'import', source: incoming.source, text: incoming.text });
      }
    };
    receive();
    window.addEventListener(INCOMING_EVENT, receive);
    return () => window.removeEventListener(INCOMING_EVENT, receive);
    // Only the arrival matters here, not later changes to the data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (panel.kind === 'import') {
    return <ImportPanel source={panel.source} initial={panel.text} onBack={home} onParsed={(parsed, source) => { setPanel({ kind: 'review', source, parsed }); window.scrollTo({ top: 0 }); }} />;
  }
  if (panel.kind === 'review') return <ReviewPanel parsed={panel.parsed} source={panel.source} onBack={home} onDone={home} />;
  if (panel.kind === 'export') return <ExportPanel initial={panel.format} onBack={home} />;

  const history = [...data.imports].reverse();
  const shareSupported = typeof navigator.share === 'function';
  return (
    <>
      <PageHeader title="Import & Share" subtitle="Move shopping lists between Replenish, Apple Reminders and Apple Notes" />

      <div className="cards transfer-cards">
        <section className="card detail-card">
          <div className="detail-head">
            <span className="app-tile tile-reminders" aria-hidden="true"><ListTodo size={24} /></span>
            <div className="row-body">
              <span className="row-title">Apple Reminders</span>
              <span className="row-meta">Bring a Reminders list in, or send your list out as one reminder per item.</span>
            </div>
          </div>
          <div className="card-actions">
            <button type="button" className="btn btn-primary" onClick={() => setPanel({ kind: 'import', source: 'reminders' })}>Import from Reminders</button>
            <button type="button" className="btn" onClick={() => setPanel({ kind: 'export', format: 'reminders' })}>Send to Reminders</button>
          </div>
        </section>
        <section className="card detail-card">
          <div className="detail-head">
            <span className="app-tile tile-notes" aria-hidden="true"><NotebookPen size={24} /></span>
            <div className="row-body">
              <span className="row-title">Apple Notes</span>
              <span className="row-meta">Bring in a list from a note, or send yours as text, a checklist or Markdown.</span>
            </div>
          </div>
          <div className="card-actions">
            <button type="button" className="btn btn-primary" onClick={() => setPanel({ kind: 'import', source: 'notes' })}>Import from Notes</button>
            <button type="button" className="btn" onClick={() => setPanel({ kind: 'export', format: 'formatted' })}>Send to Notes</button>
          </div>
        </section>
        <section className="card detail-card">
          <div className="detail-head">
            <span className="app-tile tile-share" aria-hidden="true"><Share2 size={24} /></span>
            <div className="row-body">
              <span className="row-title">Share your list</span>
              <span className="row-meta">Messages, email, the share sheet, a file or the clipboard. Choose the whole list, a category or individual items.</span>
            </div>
          </div>
          <div className="card-actions">
            <button type="button" className="btn btn-primary" onClick={() => setPanel({ kind: 'export', format: 'plain' })}>Share list</button>
          </div>
        </section>
      </div>

      <Section title="What works on this device">
        <div className="card">
          <ul className="plain-list support-list">
            <li><Chip tone="good">Works</Chip> Copy and paste, and TXT, CSV and JSON files, in both directions.</li>
            <li><Chip tone={shareSupported ? 'good' : 'neutral'}>{shareSupported ? 'Works' : 'Not here'}</Chip> Sharing out through the system share sheet{shareSupported ? '.' : ': this browser does not offer it, so Copy and Save as file are used instead.'}</li>
            <li><Chip>Android and desktop Chrome</Chip> Receiving shares: once installed there, Replenish appears in the share sheet of other apps.</li>
            <li><Chip tone="warn">Not on iPhone or iPad</Chip> iOS does not let a website appear in the share sheet. Use paste, or the "Send to Replenish" shortcut below, which adds an entry of your own.</li>
            <li><Chip tone="warn">Not possible</Chip> Reading or writing Reminders and Notes directly. Only an Apple Shortcut or a native app can; Replenish never claims to.</li>
          </ul>
        </div>
      </Section>

      <Section title="Apple Shortcuts guide" action={<Zap size={18} className="muted" aria-hidden="true" />}>
        <ShortcutsGuide />
      </Section>

      <Section title="Import history">
        {history.length === 0 ? (
          <div className="card">
            <EmptyState icon={FileUp} title="No imports yet" body="Each import is listed here with its source, date and item count, and recent ones can be undone." />
          </div>
        ) : (
          <ul className="card rows">
            {history.map((r) => (
              <li key={r.id} className="row">
                <div className="row-body">
                  <span className="row-title">{r.listName ?? 'Shopping list'} <span className="count">from {SOURCE_LABEL[r.source]}</span></span>
                  <span className="row-meta">
                    <span>{formatDate(r.at, dateFormat)} at {formatTime(r.at, time24)}</span>
                    <span>
                      {plural(r.added, 'item')} added
                      {r.merged ? `, ${r.merged} merged` : ''}{r.replaced ? `, ${r.replaced} replaced` : ''}{r.skipped ? `, ${r.skipped} skipped` : ''}
                    </span>
                  </span>
                </div>
                {r.undone ? <Chip>Undone</Chip> : canUndoImport(r) ? (
                  <button
                    type="button"
                    className="btn btn-small"
                    aria-label={`Undo the import of ${r.listName ?? 'this list'}`}
                    onClick={() => { apply((d) => undoImport(d, r.id)); toast('Import undone. Items you had already bought were kept.'); }}
                  >
                    <Undo2 size={14} aria-hidden="true" /> Undo
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
