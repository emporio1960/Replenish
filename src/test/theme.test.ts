import { describe, expect, it } from 'vitest';
import type { AppearanceSettings, CustomTheme } from '../types';
import { defaultData, exportJson, parseImport, sanitize } from '../lib/storage';
import { updateSettings } from '../state/actions';
import { contrast, ensureContrast, fromHsl, isHex, mix, onColor, toHsl } from '../theme/color';
import {
  allThemes, buildTokens, defaultAppearance, duplicateTheme, findTheme, resolveTheme, sanitizeAppearance,
  sanitizeCustomTheme, seasonFor,
} from '../theme/engine';
import { BUILT_IN_THEMES, GRADIENT_STYLES, type ThemeDefinition } from '../theme/themes';

const base = defaultAppearance();
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);
const hexes = (css: string) => css.match(/#[0-9a-f]{6}/gi) ?? [];

/** Every readability promise the engine makes, checked for one set of tokens. */
function readabilityProblems(label: string, v: Record<string, string>): string[] {
  const problems: string[] = [];
  const need = (what: string, fg: string, bg: string, min: number) => {
    const c = contrast(fg, bg);
    if (c < min - 0.01) problems.push(`${label}: ${what} is ${c.toFixed(2)}:1, needs ${min}:1`);
  };
  const grounds = [['background', v.bg], ['card', v.surface], ['raised surface', v['surface-2']]];
  for (const [name, bg] of grounds) {
    need(`text on ${name}`, v.ink, bg, 7);
    need(`secondary text on ${name}`, v['ink-2'], bg, 4.5);
    need(`faint text on ${name}`, v['ink-3'], bg, 4.5);
    for (const key of ['accent', 'secondary', 'tertiary', 'good', 'warn', 'alert']) need(`${key} on ${name}`, v[key], bg, 4.5);
  }
  for (const key of ['accent', 'secondary', 'tertiary', 'good', 'warn', 'alert']) need(`${key} on its soft tint`, v[key], v[`${key}-soft`], 4.5);
  need('text on primary button', v['accent-ink'], v.accent, 4.5);
  need('text on alert', v['on-alert'], v.alert, 4.5);
  need('switch knob on its track', '#ffffff', v['good-fill'], 3);
  const stops = hexes(v.gradient);
  for (const stop of stops) need(`text on gradient stop ${stop}`, v['on-gradient'], stop, 4.5);
  // The blend halfway between neighbouring stops must be readable too.
  for (let i = 1; i < stops.length; i++) need(`text on gradient blend ${i}`, v['on-gradient'], mix(stops[i - 1], stops[i], 0.5), 4.5);
  return problems;
}

describe('colour toolkit', () => {
  it('converts, mixes and measures contrast', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    const [h, s, l] = toHsl('#6b2d5c');
    expect(fromHsl(h, s, l)).toBe('#6b2d5c');
    expect(onColor('#fde047')).toBe('#000000');
    expect(onColor('#1d4ed8')).toBe('#ffffff');
    expect(isHex('#12ab9F')).toBe(true);
    expect(isHex('red')).toBe(false);
  });
  it('pushes a colour only as far as readability needs', () => {
    expect(ensureContrast('#1d1820', ['#ffffff'], 7)).toBe('#1d1820'); // already fine: untouched
    const fixed = ensureContrast('#fde047', ['#ffffff'], 4.5);
    expect(contrast(fixed, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs(toHsl(fixed)[0] - toHsl('#fde047')[0])).toBeLessThan(4); // same hue
  });
});

describe('built-in themes', () => {
  it('includes the twelve named themes, the original, and four seasonal themes', () => {
    const names = BUILT_IN_THEMES.map((t) => t.name);
    for (const n of ['Emerald Luxe', 'Ocean Pulse', 'Electric Violet', 'Sunset Fusion', 'Arctic Frost', 'Midnight Galaxy',
      'Tropical Bloom', 'Cherry Blossom', 'Solar Flare', 'Minimalist', 'Forest Canopy', 'Crimson Edge',
      'Summer', 'Autumn', 'Winter', 'Spring', 'Replenish']) expect(names).toContain(n);
    expect(new Set(BUILT_IN_THEMES.map((t) => t.id)).size).toBe(BUILT_IN_THEMES.length);
  });

  it('keeps every theme readable in light and dark, at every effect setting', () => {
    const problems: string[] = [];
    for (const theme of BUILT_IN_THEMES) {
      for (const mode of ['light', 'dark'] as const) {
        for (const style of ['auto', ...GRADIENT_STYLES.map((g) => g.value)] as const) {
          const tokens = buildTokens(theme, mode, { ...base, gradientStyle: style, glass: 'strong', intensity: 'vibrant' });
          problems.push(...readabilityProblems(`${theme.name} ${mode} ${style}`, tokens.vars));
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('gives each theme a full, distinct palette rather than a recoloured background', () => {
    const seen = new Set<string>();
    for (const theme of BUILT_IN_THEMES) {
      const v = buildTokens(theme, 'light', base).vars;
      for (const key of ['bg', 'surface', 'surface-2', 'ink', 'ink-2', 'line', 'accent', 'secondary', 'tertiary', 'good', 'warn', 'alert']) {
        expect(isHex(v[key]), `${theme.name} ${key}`).toBe(true);
      }
      expect(v.gradient).toContain('gradient(');
      seen.add(`${v.accent}${v.secondary}${v.bg}`);
    }
    expect(seen.size).toBe(BUILT_IN_THEMES.length);
  });

  it('renders each gradient style differently and honours the effect settings', () => {
    const theme = findTheme(base, 'ocean-pulse');
    const css = GRADIENT_STYLES.map((g) => buildTokens(theme, 'dark', { ...base, gradientStyle: g.value }).vars.gradient);
    expect(new Set(css).size).toBe(GRADIENT_STYLES.length);
    const t = buildTokens(theme, 'dark', { ...base, gradients: 'bold', glass: 'subtle', intensity: 'minimal', gradientStyle: 'animated' });
    expect(t.attrs).toMatchObject({ theme: 'dark', gradients: 'bold', glass: 'subtle', intensity: 'minimal', 'gradient-style': 'animated', motion: 'on' });
    expect(t.vars['card-bg']).toContain('rgba');
    expect(t.vars['ambient-a']).toContain(', 0)'); // minimal: no ambient light
    // Reduced motion and the animations switch both stop movement.
    expect(buildTokens(theme, 'dark', base, true).attrs.motion).toBe('off');
    expect(buildTokens(theme, 'dark', { ...base, animations: false }).attrs.motion).toBe('off');
    // A theme's preferred style is used on "auto", and a user choice overrides it.
    expect(buildTokens(findTheme(base, 'midnight-galaxy'), 'dark', base).attrs['gradient-style']).toBe('radial');
    expect(buildTokens(findTheme(base, 'midnight-galaxy'), 'dark', { ...base, gradientStyle: 'linear' }).attrs['gradient-style']).toBe('linear');
  });
});

describe('custom themes', () => {
  const mine: CustomTheme = duplicateTheme(findTheme(base, 'sunset-fusion'), 'custom-1', 'Mine');

  it('stay readable even with colours that clash', () => {
    const hostile: ThemeDefinition = {
      id: 'x', name: 'Hostile', blurb: '', group: 'custom', radius: 40, borders: 'strong',
      light: { primary: '#ffffff', secondary: '#fffff0', accent: '#fefefe', background: '#ffffff', surface: '#ffffff', text: '#ffffff' },
      dark: { primary: '#000000', secondary: '#050505', accent: '#0a0a0a', background: '#000000', surface: '#000000', text: '#000000' },
    };
    const light = buildTokens(hostile, 'light', base);
    expect(readabilityProblems('hostile light', light.vars)).toEqual([]);
    expect(readabilityProblems('hostile dark', buildTokens(hostile, 'dark', base).vars)).toEqual([]);
    expect(light.vars.radius).toBe('28px'); // clamped
    expect(light.vars['card-border']).toContain('solid');
  });

  it('are validated on the way in', () => {
    expect(sanitizeCustomTheme(mine)).toEqual(mine);
    expect(sanitizeCustomTheme({ ...mine, name: '   ' })).toBeNull();
    expect(sanitizeCustomTheme({ ...mine, id: 'ocean-pulse' })).toBeNull(); // cannot shadow a built-in theme
    const repaired = sanitizeCustomTheme({ id: 'c', name: 'Odd', light: { primary: 'red', text: '#123456' }, radius: 999, borders: 'wavy', gradientStyle: 'sparkly' })!;
    expect(repaired.light.primary).toBe(BUILT_IN_THEMES[0].light.primary);
    expect(repaired.light.text).toBe('#123456');
    expect(repaired).toMatchObject({ radius: 28, borders: 'none', gradientStyle: null });
  });

  it('can be created, selected, edited, duplicated and deleted through settings', () => {
    let a: AppearanceSettings = { ...base, customThemes: [mine], themeId: 'custom-1' };
    expect(allThemes(a).at(-1)).toMatchObject({ id: 'custom-1', group: 'custom' });
    expect(resolveTheme(a, at(2026, 11, 20)).themeId).toBe('custom-1');
    a = { ...a, customThemes: [{ ...mine, name: 'Renamed', light: { ...mine.light, primary: '#0b63ce' } }] };
    expect(findTheme(a, 'custom-1').name).toBe('Renamed');
    expect(buildTokens(findTheme(a, 'custom-1'), 'light', a).vars.accent).toBe('#0b63ce');
    const copy = duplicateTheme(findTheme(a, 'custom-1'), 'custom-2', 'Renamed copy');
    a = { ...a, customThemes: [...a.customThemes, copy] };
    expect(sanitizeAppearance(a).customThemes).toHaveLength(2);
    // Deleting the selected theme falls back to the default rather than breaking.
    const afterDelete = sanitizeAppearance({ ...a, customThemes: [copy] });
    expect(afterDelete.themeId).toBe('replenish');
  });
});

describe('automatic themes', () => {
  it('never override the chosen theme unless switched on', () => {
    const a = { ...base, themeId: 'forest-canopy' };
    for (const when of [at(2026, 12, 25, 22), at(2026, 2, 14, 8), at(2026, 7, 1, 3)]) {
      expect(resolveTheme(a, when)).toEqual({ themeId: 'forest-canopy', reason: null });
    }
  });
  it('follow the time of day', () => {
    const a = { ...base, autoTime: true };
    expect(resolveTheme(a, at(2026, 11, 20, 7))).toEqual({ themeId: 'solar-flare', reason: 'Morning' });
    expect(resolveTheme(a, at(2026, 11, 20, 14)).themeId).toBe('ocean-pulse');
    expect(resolveTheme(a, at(2026, 11, 20, 19)).themeId).toBe('sunset-fusion');
    expect(resolveTheme(a, at(2026, 11, 20, 23)).themeId).toBe('midnight-galaxy');
    expect(resolveTheme(a, at(2026, 11, 20, 2))).toEqual({ themeId: 'midnight-galaxy', reason: 'Night' });
  });
  it('follow the seasons for either hemisphere', () => {
    expect(seasonFor(at(2026, 1, 10), 'south')).toBe('summer');
    expect(seasonFor(at(2026, 1, 10), 'north')).toBe('winter');
    expect(seasonFor(at(2026, 4, 10), 'south')).toBe('autumn');
    expect(seasonFor(at(2026, 7, 10), 'south')).toBe('winter');
    expect(seasonFor(at(2026, 10, 10), 'south')).toBe('spring');
    expect(resolveTheme({ ...base, autoSeason: true }, at(2026, 11, 20))).toEqual({ themeId: 'spring', reason: 'Spring' });
    expect(resolveTheme({ ...base, autoSeason: true, hemisphere: 'north' }, at(2026, 11, 20)).themeId).toBe('autumn');
  });
  it('put special occasions first, then time of day, then season', () => {
    const all = { ...base, autoOccasion: true, autoTime: true, autoSeason: true };
    expect(resolveTheme(all, at(2026, 12, 25, 9))).toEqual({ themeId: 'crimson-edge', reason: 'Christmas' });
    expect(resolveTheme(all, at(2027, 1, 1, 9)).reason).toBe('New Year'); // range that wraps the year end
    expect(resolveTheme(all, at(2026, 11, 20, 9)).reason).toBe('Morning');
    expect(resolveTheme({ ...all, autoTime: false }, at(2026, 11, 20, 9)).reason).toBe('Spring');
  });
});

describe('persistence', () => {
  it('saves and restores every appearance setting, including custom themes', () => {
    const appearance: AppearanceSettings = {
      themeId: 'custom-1',
      customThemes: [duplicateTheme(findTheme(base, 'ocean-pulse'), 'custom-1', 'Deep sea')],
      gradientStyle: 'animated', gradients: 'bold', glass: 'strong', intensity: 'vibrant', animations: false,
      autoTime: true, autoSeason: true, autoOccasion: true, hemisphere: 'north',
    };
    const d = updateSettings(defaultData(), { appearance, theme: 'dark' });
    const saved = sanitize(JSON.parse(JSON.stringify(d)));
    expect(saved.settings.appearance).toEqual(appearance);
    expect(saved.settings.theme).toBe('dark');
    const back = parseImport(exportJson(d));
    expect(back.ok && back.data.settings.appearance).toEqual(appearance);
  });
  it('upgrades older saves without changing how they look, and survives damaged settings', () => {
    const old = sanitize({ version: 3, items: [{ id: 'a', name: 'Milk' }], settings: { theme: 'dark', currency: 'NZD' } });
    expect(old.version).toBeGreaterThanOrEqual(4);
    expect(old.items).toHaveLength(1);
    expect(old.settings).toMatchObject({ theme: 'dark', currency: 'NZD' });
    expect(old.settings.appearance).toEqual(defaultAppearance());
    expect(sanitizeAppearance({ themeId: 'gone', gradients: 'max', glass: 7, customThemes: 'nope', autoTime: 'yes' })).toEqual(defaultAppearance());
  });
});
