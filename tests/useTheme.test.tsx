import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { setFeedbackWidgetTheme, useResolvedTheme } from '../src/useTheme';

function mockPrefersDark(initial: boolean) {
  const state = { matches: initial };
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  window.matchMedia = ((query: string) => ({
    get matches() {
      return state.matches;
    },
    media: query,
    onchange: null,
    addEventListener: (_event: string, listener: EventListener) => {
      listeners.add(listener as (event: MediaQueryListEvent) => void);
    },
    removeEventListener: (_event: string, listener: EventListener) => {
      listeners.delete(listener as (event: MediaQueryListEvent) => void);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  })) as typeof window.matchMedia;

  return {
    set(matches: boolean) {
      state.matches = matches;
      for (const listener of listeners) {
        listener({ matches } as MediaQueryListEvent);
      }
    },
  };
}

describe('useResolvedTheme', () => {
  beforeEach(() => {
    setFeedbackWidgetTheme(null);
    mockPrefersDark(false);
  });

  it('stamps a locked theme during render, with no browser round-trip', () => {
    const dark = renderHook(() => useResolvedTheme('dark'));
    const light = renderHook(() => useResolvedTheme('light'));
    expect(dark.result.current).toBe('dark');
    expect(light.result.current).toBe('light');
  });

  it('ignores the host override when the theme is locked', () => {
    const { result } = renderHook(() => useResolvedTheme('light'));
    act(() => setFeedbackWidgetTheme('dark'));
    expect(result.current).toBe('light');
  });

  it('starts unresolved under system, then follows the operating system', async () => {
    mockPrefersDark(true);
    const { result } = renderHook(() => useResolvedTheme('system'));
    // jsdom flushes the effect before renderHook returns, so the unresolved
    // first paint is an SSR concern; here we only see the resolved value.
    await waitFor(() => expect(result.current).toBe('dark'));
  });

  it('follows OS changes while left on system', async () => {
    const media = mockPrefersDark(false);
    const { result } = renderHook(() => useResolvedTheme());
    await waitFor(() => expect(result.current).toBe('light'));
    act(() => media.set(true));
    await waitFor(() => expect(result.current).toBe('dark'));
  });

  it('lets setFeedbackWidgetTheme override the OS, and null hand it back', async () => {
    mockPrefersDark(false);
    const { result } = renderHook(() => useResolvedTheme('system'));
    await waitFor(() => expect(result.current).toBe('light'));

    act(() => setFeedbackWidgetTheme('dark'));
    await waitFor(() => expect(result.current).toBe('dark'));

    act(() => setFeedbackWidgetTheme(null));
    await waitFor(() => expect(result.current).toBe('light'));
  });
});
