import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { applyTokens, buildTokens, findTheme, resolveTheme, type Mode, type Tokens } from './engine';
import type { ThemeDefinition } from './themes';

interface ThemeValue {
  /** The theme on screen now (which may have been chosen automatically). */
  theme: ThemeDefinition;
  mode: Mode;
  /** Set when an automatic rule picked the theme, such as "Evening" or "Christmas". */
  autoReason: string | null;
  tokens: Tokens;
}

const ThemeContext = createContext<ThemeValue | null>(null);

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => Boolean(window.matchMedia?.(query).matches));
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, [query]);
  return matches;
}

/**
 * Works out the current theme and writes its tokens to the document as CSS
 * variables. Because styling flows through those variables, switching theme
 * repaints the app without re-rendering its components.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { data } = useStore();
  const { theme: modeSetting, appearance } = data.settings;
  const systemDark = useMedia('(prefers-color-scheme: dark)');
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)');
  const [clock, setClock] = useState(() => Date.now());
  const first = useRef(true);

  // Automatic themes follow the clock; check when the app is opened again and every few minutes.
  const automatic = appearance.autoTime || appearance.autoSeason || appearance.autoOccasion;
  useEffect(() => {
    if (!automatic) return;
    const tick = () => setClock(Date.now());
    const interval = window.setInterval(tick, 5 * 60_000);
    const onVisible = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [automatic]);

  const value = useMemo<ThemeValue>(() => {
    const mode: Mode = modeSetting === 'dark' || (modeSetting === 'system' && systemDark) ? 'dark' : 'light';
    const resolved = resolveTheme(appearance, new Date(clock));
    const theme = findTheme(appearance, resolved.themeId);
    return { theme, mode, autoReason: resolved.reason, tokens: buildTokens(theme, mode, appearance, reducedMotion) };
  }, [appearance, modeSetting, systemDark, reducedMotion, clock]);

  useEffect(() => {
    applyTokens(value.tokens, !first.current);
    first.current = false;
  }, [value.tokens]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
