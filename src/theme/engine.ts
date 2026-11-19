/**
 * The theme engine: turns a theme definition plus the user's appearance
 * settings into the design tokens (CSS custom properties) the whole app is
 * styled with. Components never hold colours of their own.
 */
import type { AppearanceSettings, CustomTheme, GradientStyle, Level, ThemeColors } from '../types';
import { contrast, ensureContrast, isHex, mix, onColor, toRgb } from './color';
import { BUILT_IN_THEMES, DEFAULT_THEME_ID, type ThemeDefinition } from './themes';

export type Mode = 'light' | 'dark';
export const THEME_CACHE_KEY = 'replenish:theme';

export function defaultAppearance(): AppearanceSettings {
  return {
    themeId: DEFAULT_THEME_ID,
    customThemes: [],
    gradientStyle: 'auto',
    gradients: 'subtle',
    glass: 'off',
    intensity: 'balanced',
    animations: true,
    autoTime: false,
    autoSeason: false,
    autoOccasion: false,
    hemisphere: 'south',
  };
}

/* ---------- validation ---------- */

const COLOR_KEYS: (keyof ThemeColors)[] = ['primary', 'secondary', 'accent', 'background', 'surface', 'text'];
const STYLES: GradientStyle[] = ['linear', 'radial', 'atmospheric', 'multicolour', 'animated'];
const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function sanitizeColors(raw: unknown, fallback: ThemeColors): ThemeColors {
  const src = isObj(raw) ? raw : {};
  const out = { ...fallback };
  for (const key of COLOR_KEYS) if (isHex(src[key])) out[key] = (src[key] as string).toLowerCase();
  return out;
}

/** Returns a well-formed custom theme, or null if it has no usable id or name. */
export function sanitizeCustomTheme(raw: unknown): CustomTheme | null {
  if (!isObj(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id.slice(0, 80) : '';
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 40) : '';
  if (!id || !name || BUILT_IN_THEMES.some((t) => t.id === id)) return null;
  const base = BUILT_IN_THEMES[0];
  const radius = typeof raw.radius === 'number' && Number.isFinite(raw.radius) ? Math.round(raw.radius) : base.radius;
  return {
    id,
    name,
    light: sanitizeColors(raw.light, base.light),
    dark: sanitizeColors(raw.dark, base.dark),
    radius: Math.max(4, Math.min(28, radius)),
    borders: pick(raw.borders, ['none', 'subtle', 'strong'] as const, 'none'),
    gradientStyle: STYLES.includes(raw.gradientStyle as GradientStyle) ? (raw.gradientStyle as GradientStyle) : null,
  };
}

export function sanitizeAppearance(raw: unknown): AppearanceSettings {
  const d = defaultAppearance();
  if (!isObj(raw)) return d;
  const seen = new Set<string>();
  const customThemes = (Array.isArray(raw.customThemes) ? raw.customThemes : [])
    .map(sanitizeCustomTheme)
    .filter((t): t is CustomTheme => t !== null && !seen.has(t.id) && Boolean(seen.add(t.id)))
    .slice(0, 40);
  const known = new Set([...BUILT_IN_THEMES.map((t) => t.id), ...customThemes.map((t) => t.id)]);
  const flag = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  return {
    themeId: typeof raw.themeId === 'string' && known.has(raw.themeId) ? raw.themeId : d.themeId,
    customThemes,
    gradientStyle: pick(raw.gradientStyle, ['auto', ...STYLES] as const, d.gradientStyle),
    gradients: pick(raw.gradients, ['off', 'subtle', 'bold'] as const, d.gradients),
    glass: pick(raw.glass, ['off', 'subtle', 'strong'] as const, d.glass),
    intensity: pick<Level>(raw.intensity, ['minimal', 'balanced', 'vibrant'], d.intensity),
    animations: flag(raw.animations, d.animations),
    autoTime: flag(raw.autoTime, false),
    autoSeason: flag(raw.autoSeason, false),
    autoOccasion: flag(raw.autoOccasion, false),
    hemisphere: pick(raw.hemisphere, ['south', 'north'] as const, d.hemisphere),
  };
}

/* ---------- theme lookup and automatic selection ---------- */

export function allThemes(a: AppearanceSettings): ThemeDefinition[] {
  return [
    ...BUILT_IN_THEMES,
    ...a.customThemes.map((t): ThemeDefinition => ({
      ...t, blurb: 'Your theme', group: 'custom', gradientStyle: t.gradientStyle ?? undefined,
    })),
  ];
}

export function findTheme(a: AppearanceSettings, id: string): ThemeDefinition {
  return allThemes(a).find((t) => t.id === id) ?? BUILT_IN_THEMES[0];
}

export const TIME_THEMES = [
  { part: 'Morning', from: 5, to: 12, themeId: 'solar-flare' },
  { part: 'Afternoon', from: 12, to: 17, themeId: 'ocean-pulse' },
  { part: 'Evening', from: 17, to: 21, themeId: 'sunset-fusion' },
  { part: 'Night', from: 21, to: 29, themeId: 'midnight-galaxy' },
];

export const OCCASIONS = [
  { name: 'New Year', from: '12-31', to: '01-01', themeId: 'solar-flare' },
  { name: "Valentine's Day", from: '02-14', to: '02-14', themeId: 'cherry-blossom' },
  { name: "St Patrick's Day", from: '03-17', to: '03-17', themeId: 'emerald-luxe' },
  { name: 'Halloween', from: '10-31', to: '10-31', themeId: 'midnight-galaxy' },
  { name: 'Christmas', from: '12-20', to: '12-26', themeId: 'crimson-edge' },
];

export function seasonFor(now: Date, hemisphere: 'south' | 'north'): 'summer' | 'autumn' | 'winter' | 'spring' {
  const southern = (['summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter', 'winter', 'winter', 'spring', 'spring', 'spring', 'summer'] as const)[now.getMonth()];
  if (hemisphere === 'south') return southern;
  return ({ summer: 'winter', autumn: 'spring', winter: 'summer', spring: 'autumn' } as const)[southern];
}

export interface Resolved {
  themeId: string;
  /** Why this theme is showing: the user's pick, or the automatic rule that chose it. */
  reason: string | null;
}

/**
 * The theme to show right now. The user's own choice always applies unless
 * they have switched on an automatic option; then a special occasion wins
 * over time of day, which wins over the season.
 */
export function resolveTheme(a: AppearanceSettings, now: Date): Resolved {
  if (a.autoOccasion) {
    const md = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const hit = OCCASIONS.find((o) => (o.from <= o.to ? md >= o.from && md <= o.to : md >= o.from || md <= o.to));
    if (hit) return { themeId: hit.themeId, reason: hit.name };
  }
  if (a.autoTime) {
    const h = now.getHours() < 5 ? now.getHours() + 24 : now.getHours();
    const hit = TIME_THEMES.find((t) => h >= t.from && h < t.to) ?? TIME_THEMES[3];
    return { themeId: hit.themeId, reason: hit.part };
  }
  if (a.autoSeason) {
    const season = seasonFor(now, a.hemisphere);
    return { themeId: season, reason: season.charAt(0).toUpperCase() + season.slice(1) };
  }
  return { themeId: findTheme(a, a.themeId).id, reason: null };
}

/* ---------- tokens ---------- */

export interface Tokens {
  mode: Mode;
  /** CSS custom properties, without the leading dashes. */
  vars: Record<string, string>;
  /** data-* attributes set on the root element to switch effects on and off. */
  attrs: Record<string, string>;
}

const rgba = (hex: string, alpha: number) => `rgba(${toRgb(hex).join(', ')}, ${alpha})`;

const STATUS = {
  light: { good: '#2c7a50', warn: '#8a5d00', alert: '#b3261e' },
  dark: { good: '#7fd0a0', warn: '#ecc462', alert: '#f39a93' },
};

function gradientCss(style: GradientStyle, [a, b, c]: string[], on: string): string {
  switch (style) {
    case 'radial':
      return `radial-gradient(circle at 12% 8%, ${b} 0%, ${a} 72%)`;
    case 'atmospheric':
      return `linear-gradient(165deg, ${a} 0%, ${ensureContrast(mix(a, b, 0.4), [on], on === '#000000' ? 6 : 4.5)} 100%)`;
    case 'multicolour':
      return `linear-gradient(120deg, ${a} 0%, ${b} 55%, ${c} 100%)`;
    case 'animated':
      return `linear-gradient(120deg, ${a}, ${b}, ${c}, ${a})`;
    default:
      return `linear-gradient(135deg, ${a} 0%, ${b} 100%)`;
  }
}

export function buildTokens(theme: ThemeDefinition, mode: Mode, a: AppearanceSettings, reducedMotion = false): Tokens {
  const c = theme[mode];
  const dark = mode === 'dark';
  const bg = c.background;
  const surface = c.surface;
  const elevated = mix(surface, c.text, dark ? 0.07 : 0.04);
  const grounds = [bg, surface, elevated];

  // Text colours are held to WCAG AA or better on every surface they sit on.
  const ink = ensureContrast(c.text, grounds, 7);
  const ink2 = ensureContrast(mix(ink, surface, 0.3), grounds, 4.5);
  const ink3 = ensureContrast(mix(ink, surface, 0.45), grounds, 4.5);
  const line = mix(surface, ink, dark ? 0.17 : 0.11);

  const softOf = (col: string) => mix(surface, col, dark ? 0.22 : 0.12);
  /** A colour used for text, icons and fills, plus its soft tint for chips and highlights. */
  const tone = (raw: string) => {
    let col = ensureContrast(raw, grounds, 4.5);
    for (let i = 0; i < 4; i++) col = ensureContrast(col, [...grounds, softOf(col)], 4.5);
    return { col, soft: softOf(col) };
  };
  const primary = tone(c.primary);
  const secondary = tone(c.secondary);
  const tertiary = tone(c.accent);
  const good = tone(STATUS[mode].good);
  const warn = tone(STATUS[mode].warn);
  const alert = tone(STATUS[mode].alert);

  // Gradients keep the theme's vivid colours; each stop is adjusted only as far
  // as needed for the text drawn on top to stay readable.
  const raw = [c.primary, c.secondary, c.accent];
  const worst = (on: string) => Math.min(...raw.map((s) => contrast(on, s)));
  const onGradient = worst('#ffffff') >= worst('#000000') ? '#ffffff' : '#000000';
  // Colours blended between two bright stops can dip darker than either, so
  // stops under dark text are held to a higher bar to keep the whole sweep readable.
  const stops = raw.map((s) => ensureContrast(s, [onGradient], onGradient === '#000000' ? 6 : 4.5));
  const style: GradientStyle = a.gradientStyle === 'auto' ? (theme.gradientStyle ?? 'linear') : a.gradientStyle;
  const motion = a.animations && !reducedMotion;

  const strength = { minimal: 0, balanced: 1, vibrant: 2 }[a.intensity];
  const shadow = [
    dark ? '0 1px 2px rgba(0, 0, 0, 0.3)' : '0 1px 2px rgba(20, 20, 30, 0.06)',
    dark
      ? '0 1px 2px rgba(0, 0, 0, 0.3), 0 10px 28px -14px rgba(0, 0, 0, 0.6)'
      : `0 1px 2px ${rgba(ink, 0.05)}, 0 8px 24px -12px ${rgba(ink, 0.16)}`,
    dark
      ? `0 1px 2px rgba(0, 0, 0, 0.35), 0 14px 34px -14px ${rgba(c.primary, 0.42)}`
      : `0 1px 2px ${rgba(ink, 0.06)}, 0 14px 32px -14px ${rgba(c.primary, 0.38)}`,
  ][strength];
  const ambient = [0, dark ? 0.1 : 0.07, dark ? 0.2 : 0.14][strength];
  const glassAlpha = { off: 1, subtle: dark ? 0.72 : 0.78, strong: dark ? 0.5 : 0.58 }[a.glass];
  const border = {
    none: '0 solid transparent',
    subtle: `1px solid ${line}`,
    strong: `1.5px solid ${mix(surface, ink, dark ? 0.34 : 0.26)}`,
  }[theme.borders];
  const radius = Math.max(4, Math.min(28, theme.radius));

  return {
    mode,
    vars: {
      bg, surface, 'surface-2': elevated, ink, 'ink-2': ink2, 'ink-3': ink3, line,
      accent: primary.col, 'accent-ink': onColor(primary.col), 'accent-soft': primary.soft,
      secondary: secondary.col, 'secondary-soft': secondary.soft, tertiary: tertiary.col, 'tertiary-soft': tertiary.soft,
      good: good.col, 'good-soft': good.soft, 'good-fill': ensureContrast(good.col, ['#ffffff'], 3),
      warn: warn.col, 'warn-soft': warn.soft,
      alert: alert.col, 'alert-soft': alert.soft, 'on-alert': onColor(alert.col),
      gradient: gradientCss(style, stops, onGradient), 'on-gradient': onGradient,
      'gradient-border': `linear-gradient(135deg, ${stops[0]}, ${stops[2]})`,
      shadow,
      glow: strength === 2 ? `0 6px 22px -6px ${rgba(c.primary, dark ? 0.6 : 0.5)}` : '0 0 0 transparent',
      'ambient-a': rgba(c.secondary, ambient),
      'ambient-b': rgba(c.accent, ambient),
      'card-bg': glassAlpha === 1 ? surface : rgba(surface, glassAlpha),
      'card-border': border,
      radius: `${radius}px`,
      'radius-s': `${Math.round(radius * 0.67)}px`,
      'radius-btn': `${Math.round(radius * 0.72)}px`,
      backdrop: dark ? 'rgba(0, 0, 0, 0.6)' : rgba(ink, 0.45),
    },
    attrs: {
      theme: mode,
      'theme-id': theme.id,
      gradients: a.gradients,
      'gradient-style': style,
      glass: a.glass,
      intensity: a.intensity,
      motion: motion ? 'on' : 'off',
    },
  };
}

/** Inline style object that themes just one element and its children (used by previews). */
export function tokenStyle(tokens: Tokens): Record<string, string> {
  return Object.fromEntries(Object.entries(tokens.vars).map(([k, v]) => [`--${k}`, v]));
}

/** Applies tokens to the whole document and remembers them so the next launch paints correctly straight away. */
export function applyTokens(tokens: Tokens, animate: boolean): void {
  const root = document.documentElement;
  if (animate && tokens.attrs.motion === 'on') {
    root.dataset.switching = 'true';
    window.setTimeout(() => delete root.dataset.switching, 450);
  }
  for (const [k, v] of Object.entries(tokens.vars)) root.style.setProperty(`--${k}`, v);
  for (const [k, v] of Object.entries(tokens.attrs)) root.setAttribute(`data-${k}`, v);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens.vars.bg);
  try {
    window.localStorage.setItem(THEME_CACHE_KEY, JSON.stringify({ vars: tokens.vars, attrs: tokens.attrs }));
  } catch {
    /* the cache only avoids a first-paint flash; it is safe to go without */
  }
}

export function duplicateTheme(from: ThemeDefinition, id: string, name: string): CustomTheme {
  return {
    id, name,
    light: { ...from.light }, dark: { ...from.dark },
    radius: from.radius, borders: from.borders, gradientStyle: from.gradientStyle ?? null,
  };
}
