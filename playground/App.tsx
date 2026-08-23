import { useState } from 'react';
import { FeedbackWidget, setFeedbackWidgetTheme } from '../src';
import type { FeedbackMode, FeedbackTheme } from '../src';

const ACTOR = {
  userId: 'ada',
  userName: 'Ada Lovelace',
  userEmail: 'ada@example.com',
};

export function App() {
  const [theme, setTheme] = useState<FeedbackTheme>('system');
  const [mode, setMode] = useState<FeedbackMode | 'hub'>('hub');
  const [position, setPosition] = useState<'bottom-right' | 'bottom-left'>('bottom-right');

  function onTheme(next: FeedbackTheme) {
    setTheme(next);
    setFeedbackWidgetTheme(next === 'system' ? null : next);
  }

  return (
    <div className="pg" data-theme={theme === 'system' ? undefined : theme}>
      <header className="pg-header">
        <div>
          <p className="pg-kicker">@melatech/feedback-widget</p>
          <h1>Playground</h1>
        </div>
        <p className="pg-hint">
          In-memory mock of the hub. Submit, edit and delete work until you
          refresh.
        </p>
      </header>

      <section className="pg-controls" aria-label="Widget controls">
        <label>
          Theme
          <select value={theme} onChange={(e) => onTheme(e.target.value as FeedbackTheme)}>
            <option value="system">system</option>
            <option value="light">light</option>
            <option value="dark">dark</option>
          </select>
        </label>
        <label>
          Mode
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as FeedbackMode | 'hub')}
          >
            <option value="hub">from hub (both)</option>
            <option value="both">both</option>
            <option value="bugs">bugs</option>
            <option value="features">features</option>
          </select>
        </label>
        <label>
          Position
          <select
            value={position}
            onChange={(e) => setPosition(e.target.value as 'bottom-right' | 'bottom-left')}
          >
            <option value="bottom-right">bottom-right</option>
            <option value="bottom-left">bottom-left</option>
          </select>
        </label>
      </section>

      <main className="pg-page">
        <h2>Host page</h2>
        <p>
          Stand-in content so you can see the floating button over a real layout.
          Open the widget, file a report, then try edit and delete on your own
          open items. Archived rows are the completed and rejected ones.
        </p>
      </main>

      <FeedbackWidget
        actor={ACTOR}
        theme={theme}
        position={position}
        {...(mode === 'hub' ? {} : { mode })}
      />
    </div>
  );
}
