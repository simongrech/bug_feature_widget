import { useEffect, useState } from 'react';
import type { FeedbackTheme } from './types';

const THEME_EVENT = 'mtfw:theme';

/**
 * The runtime override, set by `setFeedbackWidgetTheme`. Module state rather
 * than React context on purpose: the widget is usually mounted in a layout,
 * far from whatever component owns the host site's theme toggle, and an addon
 * has no business demanding that a provider be wrapped around the app.
 */
let override: 'light' | 'dark' | null = null;

/**
 * Tell every mounted widget which theme the host site is currently showing.
 *
 * Only affects widgets left on the default `theme="system"` — one given an
 * explicit `light` or `dark` is locked and ignores this. Pass `null` to hand
 * control back to the operating system.
 */
export function setFeedbackWidgetTheme(theme: 'light' | 'dark' | null): void {
  override = theme;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(THEME_EVENT));
  }
}

function osTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Resolves the theme actually to be painted.
 *
 * Returns `undefined` while `system` is still unresolved — during the server
 * render and the first client paint. The stylesheet answers for that window
 * with a `prefers-color-scheme` rule scoped to the un-stamped root, so the
 * first paint is already correct and there is nothing for hydration to
 * disagree about.
 *
 * Precedence under `system`: an override set by the host, otherwise the OS,
 * both of them live.
 */
export function useResolvedTheme(theme: FeedbackTheme = 'system'): 'light' | 'dark' | undefined {
  const locked = theme === 'light' || theme === 'dark';
  const [resolved, setResolved] = useState<'light' | 'dark' | undefined>(undefined);

  useEffect(() => {
    if (locked) return;

    const apply = () => setResolved(override ?? osTheme());
    apply();

    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener('change', apply);
    window.addEventListener(THEME_EVENT, apply);
    return () => {
      media?.removeEventListener('change', apply);
      window.removeEventListener(THEME_EVENT, apply);
    };
  }, [locked]);

  // A locked theme needs no browser API, so it is stamped during render and
  // survives SSR intact.
  return locked ? theme : resolved;
}
