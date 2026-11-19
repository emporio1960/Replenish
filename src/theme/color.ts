/** Small colour toolkit for the theme engine: conversion, mixing and WCAG contrast. */

export type RGB = [number, number, number];

export const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

export function toRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: RGB): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = toRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

export function fromHsl(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

/** Blends `amount` (0 to 1) of colour b into colour a. */
export function mix(a: string, b: string, amount: number): string {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * amount) as RGB);
}

export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Black or white, whichever reads better on the given colour (always at least 4.5:1). */
export function onColor(bg: string): string {
  return contrast('#ffffff', bg) >= contrast('#000000', bg) ? '#ffffff' : '#000000';
}

/**
 * Nudges a colour lighter or darker, keeping its hue, until it reaches the
 * target contrast against every background given. Used so that a theme can
 * never produce unreadable text, whatever colours it starts from.
 */
export function ensureContrast(color: string, backgrounds: string[], target: number): string {
  const worst = (c: string) => Math.min(...backgrounds.map((bg) => contrast(c, bg)));
  if (worst(color) >= target) return color;
  const [h, s, l] = toHsl(color);
  const darker = backgrounds.reduce((sum, bg) => sum + luminance(bg), 0) / backgrounds.length > 0.4;
  for (let step = 1; step <= 100; step++) {
    const next = fromHsl(h, s, Math.max(0, Math.min(100, l + (darker ? -step : step))));
    if (worst(next) >= target) return next;
  }
  // Out of range for this hue: fall back to plain black or white.
  return worst('#000000') >= worst('#ffffff') ? '#000000' : '#ffffff';
}
