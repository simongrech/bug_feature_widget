import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { setFeedbackWidgetTheme } from '../src/useTheme';

/**
 * jsdom 29's Storage can lack `clear()`, which would fail every test in
 * afterEach. A map-backed stub is enough for the widget and the outbox.
 */
function makeStorage(): Storage {
  const data = new Map<string, string>();
  return {
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
}

/**
 * local and session get a store each. They are not interchangeable to the
 * widget -- the outbox and the remembered mode are meant to outlive the
 * browser, while the chosen sort is meant to die with the session -- so a
 * shared backing map would hide a value written to the wrong one.
 */
function installStorage() {
  vi.stubGlobal('localStorage', makeStorage());
  vi.stubGlobal('sessionStorage', makeStorage());
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
