import type { GradientStyle, ThemeColors } from '../types';

/** A complete theme: the six colours a person chooses, for each appearance, plus its shape. */
export interface ThemeDefinition {
  id: string;
  name: string;
  blurb: string;
  group: 'core' | 'seasonal' | 'custom';
  light: ThemeColors;
  dark: ThemeColors;
  /** Corner radius of cards in pixels. */
  radius: number;
  borders: 'none' | 'subtle' | 'strong';
  /** A gradient style this theme prefers; otherwise the user's setting is used. */
  gradientStyle?: GradientStyle;
}

const colors = (primary: string, secondary: string, accent: string, background: string, surface: string, text: string): ThemeColors =>
  ({ primary, secondary, accent, background, surface, text });

const theme = (
  id: string, name: string, blurb: string, light: ThemeColors, dark: ThemeColors,
  extra: Partial<ThemeDefinition> = {},
): ThemeDefinition => ({ id, name, blurb, group: 'core', light, dark, radius: 18, borders: 'none', ...extra });

export const DEFAULT_THEME_ID = 'replenish';

export const BUILT_IN_THEMES: ThemeDefinition[] = [
  theme('replenish', 'Replenish', 'The original aubergine on cool paper',
    colors('#6b2d5c', '#b3558f', '#2c7a50', '#f3f1f4', '#ffffff', '#1d1820'),
    colors('#dba6cf', '#b37aa6', '#7fd0a0', '#17141a', '#221e26', '#f2eef4')),
  theme('emerald-luxe', 'Emerald Luxe', 'Deep emerald, lime green and polished dark surfaces',
    colors('#047857', '#4d7c0f', '#0f766e', '#eef5f1', '#ffffff', '#0c1f18'),
    colors('#34d399', '#a3e635', '#2dd4bf', '#06120e', '#0e1e18', '#ecfdf5')),
  theme('ocean-pulse', 'Ocean Pulse', 'Electric blue, turquoise and deep navy',
    colors('#0b63ce', '#0891b2', '#0e7490', '#eef4fb', '#ffffff', '#0b1b33'),
    colors('#4da3ff', '#22d3ee', '#5eead4', '#050f1f', '#0c1a30', '#eaf3ff')),
  theme('electric-violet', 'Electric Violet', 'Purple, indigo and vibrant lavender',
    colors('#6d28d9', '#4f46e5', '#a855f7', '#f4f1fd', '#ffffff', '#1b1433'),
    colors('#a78bfa', '#818cf8', '#d8b4fe', '#0f0a1f', '#1a1330', '#f1ecff')),
  theme('sunset-fusion', 'Sunset Fusion', 'Coral, orange and pink in warm gradients',
    colors('#d9480f', '#db2777', '#ea580c', '#fff4ee', '#ffffff', '#2b1408'),
    colors('#ff8a5c', '#f472b6', '#fdba74', '#1c0f0c', '#2a1814', '#fff1ea'),
    { gradientStyle: 'multicolour' }),
  theme('arctic-frost', 'Arctic Frost', 'Icy blue, silver and clean white',
    colors('#2f6f9f', '#64748b', '#38bdf8', '#f0f6fa', '#ffffff', '#10212e'),
    colors('#8fd3f4', '#cbd5e1', '#7dd3fc', '#0b141a', '#132029', '#eaf6fc'),
    { borders: 'subtle' }),
  theme('midnight-galaxy', 'Midnight Galaxy', 'Deep black, violet and luminous blue',
    colors('#5b21b6', '#1d4ed8', '#7c3aed', '#f1f0fa', '#ffffff', '#12102a'),
    colors('#a78bfa', '#60a5fa', '#c084fc', '#05050c', '#0e0e1c', '#eeeaff'),
    { gradientStyle: 'radial' }),
  theme('tropical-bloom', 'Tropical Bloom', 'Vibrant green, teal and tropical yellow',
    colors('#15803d', '#0d9488', '#ca8a04', '#f0f8ef', '#ffffff', '#0e2414'),
    colors('#4ade80', '#2dd4bf', '#fde047', '#07150d', '#0f2117', '#effdf2'),
    { gradientStyle: 'multicolour' }),
  theme('cherry-blossom', 'Cherry Blossom', 'Soft pink, rose and elegant mauve',
    colors('#be185d', '#a8558f', '#e11d48', '#fdf2f6', '#ffffff', '#2d0f1c'),
    colors('#f9a8d4', '#d8b4e2', '#fda4af', '#1c0d14', '#2a1620', '#ffeef5'),
    { radius: 22 }),
  theme('solar-flare', 'Solar Flare', 'Golden yellow, orange and amber',
    colors('#b45309', '#c2410c', '#ca8a04', '#fff8e8', '#ffffff', '#2a1a04'),
    colors('#fbbf24', '#fb923c', '#fde047', '#171003', '#241a08', '#fff7e0')),
  theme('minimalist', 'Minimalist', 'Neutral grey, white and charcoal',
    colors('#27272a', '#52525b', '#71717a', '#f4f4f5', '#ffffff', '#18181b'),
    colors('#e4e4e7', '#a1a1aa', '#d4d4d8', '#0f0f10', '#1a1a1c', '#fafafa'),
    { radius: 12, borders: 'subtle' }),
  theme('forest-canopy', 'Forest Canopy', 'Deep forest green, sage and natural tones',
    colors('#2f5d3a', '#6b7f4f', '#8a6d3b', '#f1f4ec', '#fdfdf9', '#172117'),
    colors('#8fbf8f', '#b5c99a', '#d6b98c', '#0c130d', '#151f16', '#eef4ea')),
  theme('crimson-edge', 'Crimson Edge', 'Rich red, burgundy and dark charcoal',
    colors('#b91c1c', '#7f1d1d', '#be123c', '#f8f1f1', '#ffffff', '#1f1113'),
    colors('#f87171', '#fca5a5', '#fb7185', '#120a0b', '#1e1214', '#fdeeee'),
    { radius: 14 }),

  theme('summer', 'Summer', 'Clear sky blue with sun and coral',
    colors('#0284c7', '#d97706', '#e11d48', '#f0f9ff', '#ffffff', '#0c2233'),
    colors('#38bdf8', '#fbbf24', '#fb7185', '#071520', '#0f2030', '#e8f6ff'),
    { group: 'seasonal', gradientStyle: 'multicolour' }),
  theme('autumn', 'Autumn', 'Burnt orange, rust and ochre',
    colors('#b4530f', '#92400e', '#a16207', '#faf3ea', '#fffdf9', '#2a180c'),
    colors('#f0a060', '#d98c5f', '#e5b84b', '#170f09', '#241810', '#fbefe2'),
    { group: 'seasonal' }),
  theme('winter', 'Winter', 'Slate blue, steel and frost',
    colors('#3b5b92', '#5b7083', '#7c93c3', '#eff3f8', '#ffffff', '#131c2b'),
    colors('#9db8e8', '#b6c4d6', '#c3d3f2', '#0a0f18', '#121a27', '#edf2fb'),
    { group: 'seasonal', borders: 'subtle' }),
  theme('spring', 'Spring', 'Fresh green with blossom pink',
    colors('#4d7c0f', '#db2777', '#0d9488', '#f6faee', '#ffffff', '#1a2410'),
    colors('#a3e635', '#f9a8d4', '#5eead4', '#0d1407', '#17200e', '#f3fbe8'),
    { group: 'seasonal', gradientStyle: 'multicolour' }),
];

export const GRADIENT_STYLES: { value: GradientStyle; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'radial', label: 'Radial' },
  { value: 'atmospheric', label: 'Subtle atmospheric' },
  { value: 'multicolour', label: 'Multicolour' },
  { value: 'animated', label: 'Animated' },
];

/** Colours offered as quick picks beside the colour picker. */
export const SWATCHES = [
  '#b91c1c', '#d9480f', '#b45309', '#ca8a04', '#4d7c0f', '#15803d', '#047857', '#0d9488', '#0891b2', '#0b63ce',
  '#4f46e5', '#6d28d9', '#a855f7', '#be185d', '#6b2d5c', '#27272a', '#64748b', '#ffffff',
];
