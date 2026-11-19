import { useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, Copy, Pencil, Plus, Trash } from 'lucide-react';
import type { AppearanceSettings, CustomTheme, GradientStyle, Theme, ThemeColors } from '../types';
import { uid } from '../lib/format';
import { updateSettings } from '../state/actions';
import { useStore } from '../state/store';
import { contrast, isHex } from '../theme/color';
import {
  allThemes, buildTokens, defaultAppearance, duplicateTheme, findTheme, OCCASIONS, seasonFor, TIME_THEMES,
  tokenStyle, type Mode,
} from '../theme/engine';
import { useTheme } from '../theme/ThemeProvider';
import { BUILT_IN_THEMES, GRADIENT_STYLES, SWATCHES, type ThemeDefinition } from '../theme/themes';
import { Field, Modal, PageHeader, Section, Segmented, Toggle } from '../components/ui';

/** A miniature of the app drawn with a theme's own tokens, so it shows exactly how the theme looks. */
export function ThemePreview({ theme, mode, appearance, large = false }: {
  theme: ThemeDefinition; mode: Mode; appearance: AppearanceSettings; large?: boolean;
}) {
  const tokens = useMemo(() => buildTokens(theme, mode, appearance, true), [theme, mode, appearance]);
  return (
    <div className={`tp ${large ? 'tp-large' : ''}`} style={tokenStyle(tokens)} data-theme={mode} aria-hidden="true">
      <div className="tp-hero">
        <span><strong>3</strong> of 8 in the basket</span>
        <span className="tp-bar"><i /></span>
      </div>
      <div className="tp-card">
        <span className="tp-check" />
        <span className="tp-lines"><b>Milk</b><em>2 L, Dairy and eggs</em></span>
        <span className="tp-chip">Due</span>
      </div>
      <div className="tp-row">
        <span className="tp-btn">Add item</span>
        <span className="tp-dot" style={{ background: 'var(--secondary)' }} />
        <span className="tp-dot" style={{ background: 'var(--tertiary)' }} />
        <span className="tp-dot" style={{ background: 'var(--good)' }} />
      </div>
    </div>
  );
}

const COLOR_FIELDS: { key: keyof ThemeColors; label: string; hint: string }[] = [
  { key: 'primary', label: 'Primary', hint: 'Buttons, links and highlights' },
  { key: 'secondary', label: 'Secondary', hint: 'Gradients and supporting accents' },
  { key: 'accent', label: 'Accent', hint: 'Third gradient colour and small details' },
  { key: 'background', label: 'Background', hint: 'Behind everything' },
  { key: 'surface', label: 'Card', hint: 'Cards, sheets and bars' },
  { key: 'text', label: 'Text', hint: 'Main text' },
];

function ThemeEditor({ initial, isNew, onClose }: { initial: CustomTheme; isNew: boolean; onClose: () => void }) {
  const { data, apply, toast } = useStore();
  const { mode: currentMode } = useTheme();
  const appearance = data.settings.appearance;
  const [draft, setDraft] = useState(initial);
  const [editing, setEditing] = useState<Mode>(currentMode);
  const [active, setActive] = useState<keyof ThemeColors>('primary');
  const [hex, setHex] = useState<Partial<Record<string, string>>>({});
  const [error, setError] = useState('');

  const definition: ThemeDefinition = {
    ...draft, blurb: 'Your theme', group: 'custom', gradientStyle: draft.gradientStyle ?? undefined,
  };
  const tokens = buildTokens(definition, editing, appearance, true);
  const colors = draft[editing];
  const setColor = (key: keyof ThemeColors, value: string) =>
    setDraft((d) => ({ ...d, [editing]: { ...d[editing], [key]: value.toLowerCase() } }));
  const ratio = contrast(colors.text, colors.background);
  const adjusted = tokens.vars.accent.toLowerCase() !== colors.primary || tokens.vars.ink.toLowerCase() !== colors.text;

  function save(e: FormEvent) {
    e.preventDefault();
    const name = draft.name.trim();
    if (!name) return setError('Give the theme a name.');
    if (appearance.customThemes.some((t) => t.id !== draft.id && t.name.toLowerCase() === name.toLowerCase())) {
      return setError('Another of your themes already has this name.');
    }
    const saved = { ...draft, name };
    apply((d) => {
      const a = d.settings.appearance;
      const exists = a.customThemes.some((t) => t.id === saved.id);
      return updateSettings(d, {
        appearance: {
          ...a,
          customThemes: exists ? a.customThemes.map((t) => (t.id === saved.id ? saved : t)) : [...a.customThemes, saved],
          // A new theme is applied straight away, which also means leaving automatic themes.
          ...(isNew ? { themeId: saved.id, autoTime: false, autoSeason: false, autoOccasion: false } : {}),
        },
      });
    });
    toast(isNew ? `${name} saved and applied` : `${name} saved`);
    onClose();
  }

  return (
    <Modal
      title={isNew ? 'New theme' : 'Edit theme'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
          <button type="submit" form="theme-form" className="btn btn-primary">Save theme</button>
        </>
      }
    >
      <form id="theme-form" className="form" onSubmit={save} noValidate>
        <div className="editor-preview">
          <ThemePreview theme={definition} mode={editing} appearance={appearance} large />
        </div>
        <Field label="Theme name" error={error}>
          <input data-autofocus value={draft.name} maxLength={40} onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setError(''); }} />
        </Field>
        <div className="field">
          <span className="field-label">Colours for</span>
          <Segmented<Mode>
            label="Appearance being edited"
            value={editing}
            onChange={(m) => { setEditing(m); setHex({}); }}
            options={[{ value: 'light', label: 'Light appearance' }, { value: 'dark', label: 'Dark appearance' }]}
          />
        </div>

        <ul className="color-rows">
          {COLOR_FIELDS.map((f) => (
            <li key={f.key} className={active === f.key ? 'is-active' : ''}>
              <label className="color-well">
                <input
                  type="color"
                  value={colors[f.key]}
                  aria-label={`${f.label} colour`}
                  onFocus={() => setActive(f.key)}
                  onChange={(e) => { setColor(f.key, e.target.value); setHex((h) => ({ ...h, [f.key]: undefined })); }}
                />
                <span style={{ background: colors[f.key] }} />
              </label>
              <span className="color-name">
                <strong>{f.label}</strong>
                <em>{f.hint}</em>
              </span>
              <input
                className="hex"
                aria-label={`${f.label} hex value`}
                value={hex[f.key] ?? colors[f.key]}
                maxLength={7}
                spellCheck={false}
                autoCapitalize="off"
                onFocus={() => setActive(f.key)}
                onChange={(e) => {
                  const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
                  setHex((h) => ({ ...h, [f.key]: v }));
                  if (isHex(v)) setColor(f.key, v);
                }}
                onBlur={() => setHex((h) => ({ ...h, [f.key]: undefined }))}
              />
            </li>
          ))}
        </ul>
        <div className="field">
          <span className="field-label">Quick picks for {COLOR_FIELDS.find((f) => f.key === active)!.label.toLowerCase()}</span>
          <div className="swatches" role="group" aria-label="Quick colour picks">
            {SWATCHES.map((s) => (
              <button
                key={s}
                type="button"
                style={{ background: s }}
                aria-label={`Use ${s}`}
                aria-pressed={colors[active] === s}
                onClick={() => { setColor(active, s); setHex({}); }}
              />
            ))}
          </div>
        </div>
        <p className="fine">
          Text on background contrast: {ratio.toFixed(1)}:1 ({ratio >= 4.5 ? 'meets' : 'below'} the 4.5:1 guideline).
          {adjusted ? ' Replenish has shifted some colours slightly where they are used as text, to keep it readable.' : ''}
        </p>

        <div className="form-row">
          <Field label="Gradient">
            <select
              value={draft.gradientStyle ?? ''}
              onChange={(e) => setDraft({ ...draft, gradientStyle: (e.target.value || null) as GradientStyle | null })}
            >
              <option value="">Follow my setting</option>
              {GRADIENT_STYLES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </Field>
          <Field label={`Corner radius: ${draft.radius}px`}>
            <input type="range" min={4} max={28} step={1} value={draft.radius} onChange={(e) => setDraft({ ...draft, radius: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="field">
          <span className="field-label">Borders</span>
          <Segmented
            label="Border appearance"
            value={draft.borders}
            onChange={(borders) => setDraft({ ...draft, borders })}
            options={[{ value: 'none', label: 'None' }, { value: 'subtle', label: 'Subtle' }, { value: 'strong', label: 'Strong' }]}
          />
        </div>
      </form>
    </Modal>
  );
}

export function Appearance() {
  const { data, apply, go, openModal, toast } = useStore();
  const { theme: showing, mode, autoReason } = useTheme();
  const a = data.settings.appearance;
  const [editor, setEditor] = useState<{ theme: CustomTheme; isNew: boolean } | null>(null);
  const set = (patch: Partial<AppearanceSettings>) =>
    apply((d) => updateSettings(d, { appearance: { ...d.settings.appearance, ...patch } }));
  const automatic = a.autoTime || a.autoSeason || a.autoOccasion;
  const themes = allThemes(a);
  const now = new Date();

  function choose(t: ThemeDefinition) {
    const before = { themeId: a.themeId, autoTime: a.autoTime, autoSeason: a.autoSeason, autoOccasion: a.autoOccasion };
    // Picking a theme by hand is a clear instruction, so automatic switching steps aside.
    set({ themeId: t.id, autoTime: false, autoSeason: false, autoOccasion: false });
    toast(`${t.name} applied${automatic ? '. Automatic themes are now off' : ''}`, { label: 'Undo', run: () => set(before) });
  }

  const startNew = (from: ThemeDefinition) => {
    const base = `${from.name} copy`;
    let name = base;
    for (let n = 2; a.customThemes.some((t) => t.name === name); n++) name = `${base} ${n}`;
    setEditor({ theme: duplicateTheme(from, `custom-${uid()}`, name), isNew: true });
  };

  const card = (t: ThemeDefinition) => {
    const selected = a.themeId === t.id;
    const custom = a.customThemes.find((c) => c.id === t.id);
    return (
      <li key={t.id} className={`theme-card ${selected ? 'is-selected' : ''}`}>
        <button type="button" className="theme-pick" aria-pressed={selected} onClick={() => choose(t)}>
          <ThemePreview theme={t} mode={mode} appearance={a} />
          <span className="theme-meta">
            <span className="theme-name">
              {t.name}
              {selected && <span className="theme-tick"><Check size={13} strokeWidth={3} aria-hidden="true" /> Selected</span>}
            </span>
            <span className="theme-blurb">{t.blurb}</span>
            <span className="theme-swatches" aria-hidden="true">
              {[t[mode].primary, t[mode].secondary, t[mode].accent, t[mode].background, t[mode].surface].map((c, i) => (
                <i key={i} style={{ background: c }} />
              ))}
              <em>{mode === 'dark' ? 'Dark' : 'Light'}</em>
            </span>
          </span>
        </button>
        <div className="theme-actions">
          {custom ? (
            <>
              <button type="button" className="btn btn-small" onClick={() => setEditor({ theme: custom, isNew: false })}>
                <Pencil size={14} aria-hidden="true" /> Edit
              </button>
              <button type="button" className="btn btn-small" onClick={() => startNew(t)} aria-label={`Duplicate ${t.name}`}>
                <Copy size={14} aria-hidden="true" /> Duplicate
              </button>
              <button
                type="button"
                className="btn btn-small btn-quiet danger-text"
                aria-label={`Delete ${t.name}`}
                onClick={() =>
                  openModal({
                    type: 'confirm',
                    title: `Delete ${t.name}?`,
                    body: selected ? 'This theme is in use, so the app will go back to the Replenish theme.' : 'This removes your custom theme.',
                    confirmLabel: 'Delete theme',
                    danger: true,
                    onConfirm: () => {
                      apply((d) => {
                        const ap = d.settings.appearance;
                        return updateSettings(d, {
                          appearance: {
                            ...ap,
                            customThemes: ap.customThemes.filter((c) => c.id !== t.id),
                            themeId: ap.themeId === t.id ? defaultAppearance().themeId : ap.themeId,
                          },
                        });
                      });
                      toast(`Deleted ${t.name}`);
                    },
                  })
                }
              >
                <Trash size={14} aria-hidden="true" /> Delete
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-small btn-quiet" onClick={() => startNew(t)} aria-label={`Customise ${t.name}`}>
              <Copy size={14} aria-hidden="true" /> Customise
            </button>
          )}
        </div>
      </li>
    );
  };

  const season = seasonFor(now, a.hemisphere);
  return (
    <>
      <button type="button" className="btn btn-quiet back-link" onClick={() => go('settings')}>
        <ArrowLeft size={17} aria-hidden="true" /> Settings
      </button>
      <PageHeader title="Appearance" subtitle="Themes, colours and effects" />

      <section className="card now-showing">
        <ThemePreview theme={showing} mode={mode} appearance={a} large />
        <div>
          <h2>{showing.name}</h2>
          <p>{showing.blurb}</p>
          <p className="fine">
            {autoReason
              ? `Chosen automatically for ${autoReason.toLowerCase()}. Your own pick is ${findTheme(a, a.themeId).name}.`
              : `${mode === 'dark' ? 'Dark' : 'Light'} appearance.`}
          </p>
        </div>
      </section>

      <Section title="Light or dark">
        <div className="card settings">
          <div className="setting">
            <span className="setting-label">
              Appearance mode
              <span className="toggle-desc">Works with every theme. Each theme has its own light and dark colours.</span>
            </span>
            <Segmented<Theme>
              label="Appearance mode"
              value={data.settings.theme}
              onChange={(theme) => apply((d) => updateSettings(d, { theme }))}
              options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]}
            />
          </div>
        </div>
      </Section>

      <Section title="Theme gallery">
        <ul className="theme-grid">{themes.filter((t) => t.group === 'core').map(card)}</ul>
      </Section>

      <Section title="Seasonal themes">
        <ul className="theme-grid">{themes.filter((t) => t.group === 'seasonal').map(card)}</ul>
      </Section>

      <Section
        title="Your themes"
        action={
          <button type="button" className="btn btn-small" onClick={() => startNew(showing)}>
            <Plus size={15} aria-hidden="true" /> New theme
          </button>
        }
      >
        {a.customThemes.length === 0 ? (
          <div className="card">
            <p className="muted">
              Make your own theme by choosing its colours, gradient, borders and corners. New themes start as a copy of the
              one on screen, or use Customise on any theme above.
            </p>
          </div>
        ) : (
          <ul className="theme-grid">{themes.filter((t) => t.group === 'custom').map(card)}</ul>
        )}
      </Section>

      <Section title="Effects">
        <div className="card settings">
          <div className="setting">
            <span className="setting-label">
              Interface intensity
              <span className="toggle-desc">How strong shadows, ambient background light and glow are.</span>
            </span>
            <Segmented
              label="Interface intensity"
              value={a.intensity}
              onChange={(intensity) => set({ intensity })}
              options={[{ value: 'minimal', label: 'Minimal' }, { value: 'balanced', label: 'Balanced' }, { value: 'vibrant', label: 'Vibrant' }]}
            />
          </div>
          <div className="setting">
            <span className="setting-label">
              Gradients
              <span className="toggle-desc">Subtle colours the basket card, progress bars and the active tab. Bold adds main buttons, statistic cards and due reminders.</span>
            </span>
            <Segmented
              label="Gradient intensity"
              value={a.gradients}
              onChange={(gradients) => set({ gradients })}
              options={[{ value: 'off', label: 'Off' }, { value: 'subtle', label: 'Subtle' }, { value: 'bold', label: 'Bold' }]}
            />
          </div>
          <label className="setting">
            <span className="setting-label">Gradient style</span>
            <select value={a.gradientStyle} onChange={(e) => set({ gradientStyle: e.target.value as AppearanceSettings['gradientStyle'] })}>
              <option value="auto">Theme's own</option>
              {GRADIENT_STYLES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </label>
          <div className="setting">
            <span className="setting-label">
              Glass effect
              <span className="toggle-desc">Translucent, softly blurred cards. Looks best with Balanced or Vibrant intensity.</span>
            </span>
            <Segmented
              label="Glass effect intensity"
              value={a.glass}
              onChange={(glass) => set({ glass })}
              options={[{ value: 'off', label: 'Off' }, { value: 'subtle', label: 'Subtle' }, { value: 'strong', label: 'Strong' }]}
            />
          </div>
          <Toggle
            label="Animations"
            description="Smooth colour changes when the theme switches, and movement in animated gradients. Always off when your device asks for reduced motion."
            checked={a.animations}
            onChange={(animations) => set({ animations })}
          />
        </div>
      </Section>

      <Section title="Automatic themes">
        <div className="card settings">
          <p className="fine">
            Off unless you switch them on. While any is on it takes the place of your chosen theme; choosing a theme from the gallery switches them off again.
            If more than one is on, a special occasion comes first, then time of day, then season.
          </p>
          <Toggle
            label="Change with the time of day"
            description={TIME_THEMES.map((t) => `${t.part}: ${BUILT_IN_THEMES.find((b) => b.id === t.themeId)!.name}`).join('. ')}
            checked={a.autoTime}
            onChange={(autoTime) => set({ autoTime })}
          />
          <Toggle
            label="Change with the seasons"
            description={`Uses the Summer, Autumn, Winter and Spring themes. It is ${season} now.`}
            checked={a.autoSeason}
            onChange={(autoSeason) => set({ autoSeason })}
          />
          <div className="setting">
            <span className="setting-label">Seasons for</span>
            <Segmented
              label="Hemisphere"
              value={a.hemisphere}
              onChange={(hemisphere) => set({ hemisphere })}
              options={[{ value: 'south', label: 'Southern hemisphere' }, { value: 'north', label: 'Northern hemisphere' }]}
            />
          </div>
          <Toggle
            label="Dress up for special occasions"
            description={OCCASIONS.map((o) => o.name).join(', ')}
            checked={a.autoOccasion}
            onChange={(autoOccasion) => set({ autoOccasion })}
          />
        </div>
      </Section>

      <Section title="Reset">
        <div className="card settings">
          <div className="setting">
            <span className="setting-label">
              Restore default appearance
              <span className="toggle-desc">Back to the Replenish theme with standard effects and automatic themes off. Your own themes are kept.</span>
            </span>
            <button
              type="button"
              className="btn"
              onClick={() =>
                openModal({
                  type: 'confirm',
                  title: 'Restore the default appearance?',
                  body: 'The theme, effects and automatic theme settings go back to their defaults. Themes you made are kept, and light or dark mode is not changed.',
                  confirmLabel: 'Restore defaults',
                  onConfirm: () => { set({ ...defaultAppearance(), customThemes: a.customThemes }); toast('Default appearance restored'); },
                })
              }
            >
              Restore defaults
            </button>
          </div>
        </div>
      </Section>

      {editor && <ThemeEditor key={editor.theme.id} initial={editor.theme} isNew={editor.isNew} onClose={() => setEditor(null)} />}
    </>
  );
}
