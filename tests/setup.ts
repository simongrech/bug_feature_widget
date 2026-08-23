import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { setFeedbackWidgetTheme } from '../src/useTheme';

/**
 * jsdom 29's Storage can lack `clear()`, which would fail every test in
 * afterEach. A map-backed stub is enough for the widget and the outbox.
 */
function installStorage() {
  const data = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] ?? null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key)! : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
    clear() {
      data.clear();
    },
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('sessionStorage', storage);
}

installStorage();

afterEach(() => {
  cleanup();
  setFeedbackWidgetTheme(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  // Re-install after unstub: jsdom 29's Storage has no `clear()`, and tests
  // that stub `fetch` globally would otherwise leave us without a store.
  installStorage();
});
