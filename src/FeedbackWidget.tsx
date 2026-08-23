import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArchiveIcon, ArrowDownIcon, ArrowUpIcon, BugIcon, LightbulbIcon, SplitIcon } from './icons';
import { Item } from './Item';
import { useResolvedTheme } from './useTheme';
import {
  DEFAULT_RETRY_SCHEDULE_MS,
  backOff,
  claim,
  describeStatus,
  describeWait,
  dueReports,
  enqueue,
  queueKey,
  readQueue,
  remove as removeQueued,
  retryNow,
  updateText as updateQueuedText,
  type QueuedReport,
} from './queue';
import { BUG_SEVERITIES, FEATURE_SEVERITIES } from './types';
import type {
  FeedbackActor,
  FeedbackConfig,
  FeedbackItem,
  FeedbackKind,
  FeedbackMode,
  FeedbackSeverity,
  FeedbackTheme,
} from './types';

/**
 * Sort is remembered for the browsing session; the view is not remembered at
 * all. Which tab you were on and whether you were reading the archive are
 * where you happened to be when you closed the panel, not a preference — so
 * opening it again starts from the top. How you like the list ordered is a
 * preference, and sessionStorage keeps it across page loads without making it
 * permanent.
 */
const KEY_SORT_FIELD = 'mtfw:sort-field';
const KEY_SORT_DIR = 'mtfw:sort-dir';

/**
 * A widget that renders nothing looks identical whether it is switched off,
 * misconfigured or pointed at a dead hub. One console line turns that into
 * something somebody can act on, without putting an error box on a page whose
 * visitors are not the ones who can fix it.
 */
const warned = new Set<string>();

function warnOnce(apiBase: string, why: string): void {
  if (warned.has(apiBase)) return;
  warned.add(apiBase);
  console.warn(
    `[feedback-widget] Not rendering: could not load config from "${apiBase}/config" — ${why}.`,
  );
}

const CRITICALITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

export interface FeedbackWidgetProps {
  /** Who is reporting. `null` hides the widget entirely — use it while a session loads. */
  actor: FeedbackActor | null;
  /** Same-origin mount point of the proxy route. Never the hub's own URL. */
  apiBase?: string;
  /** Overrides what the API key is configured for. Normally leave it unset. */
  mode?: FeedbackMode;
  /** `system` (default) follows the OS; `light`/`dark` lock the widget. */
  theme?: FeedbackTheme;
  position?: 'bottom-right' | 'bottom-left';
  /**
   * Waits between delivery attempts for a report the hub could not accept.
   * Defaults to 5m, 15m, 30m, 1h, 2h, 5h, 12h, then the next day. Once the
   * list runs out the report is kept and offers a manual retry rather than
   * being dropped. See `queue.ts` — attempts are made in the browser, so
   * these are "not before" rather than "exactly at".
   */
  retryScheduleMs?: readonly number[];
}

type SortField = 'date' | 'level';
type SortDir = 'asc' | 'desc';

/**
 * Whether a failed send is worth keeping and retrying.
 *
 * A hub that is down, overloaded or unreachable will accept the report later,
 * so it goes in the outbox. A 4xx will not: a malformed body or a kind this
 * site does not collect would fail identically tomorrow, and queueing it would
 * mean retrying a doomed request for a day. Those are reported to the user
 * there and then instead.
 */
/**
 * The last mode the hub reported, per mount point.
 *
 * Without this the widget is invisible whenever `GET /config` fails, which is
 * exactly when somebody most wants it: during an outage, on a reload, with a
 * bug to report. It would also make the outbox pointless, since nothing can be
 * queued from a widget that never rendered.
 *
 * A remembered mode is only ever a display decision — the hub still decides
 * what it will accept, and rejects a kind the site does not collect.
 */
function readCachedMode(apiBase: string): FeedbackMode | undefined {
  try {
    const raw = localStorage.getItem(`mtfw:mode:${apiBase}`);
    return raw === 'bugs' || raw === 'features' || raw === 'both' ? raw : undefined;
  } catch {
    return undefined;
  }
}

function writeCachedMode(apiBase: string, mode: FeedbackMode): void {
  try {
    localStorage.setItem(`mtfw:mode:${apiBase}`, mode);
  } catch {
    /* storage blocked; the widget just re-asks the hub next time */
  }
}

function isTransient(status?: number): boolean {
  if (status === undefined) return true; // network error — never reached the hub
  return status === 429 || status === 408 || status >= 500;
}

export function FeedbackWidget({
  actor,
  apiBase = '/api/feedback',
  mode: modeProp,
  theme = 'system',
  position = 'bottom-right',
  retryScheduleMs = DEFAULT_RETRY_SCHEDULE_MS,
}: FeedbackWidgetProps) {
  const [mode, setMode] = useState<FeedbackMode | undefined>(modeProp);
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<FeedbackKind>('bug');
  const [drafts, setDrafts] = useState<Record<FeedbackKind, string>>({ bug: '', feature: '' });
  const [severities, setSeverities] = useState<Record<FeedbackKind, FeedbackSeverity | ''>>({
    bug: '',
    feature: '',
  });
  const [showArchived, setShowArchived] = useState<Record<FeedbackKind, boolean>>({
    bug: false,
    feature: false,
  });
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [tabSlider, setTabSlider] = useState<{ left: number; width: number } | null>(null);
  // Two tones. "We kept your report" is reassurance, and showing it in the
  // same red as a real failure reads as one.
  const [notice, setNotice] = useState<{ text: string; tone: 'error' | 'info' } | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [queued, setQueued] = useState<QueuedReport[]>([]);

  const panelRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  const resolvedTheme = useResolvedTheme(theme);

  /** One outbox per mount point, so two widgets cannot eat each other's. */
  const key = useMemo(() => queueKey(apiBase), [apiBase]);

  const showBugs = mode === 'bugs' || mode === 'both';
  const showFeatures = mode === 'features' || mode === 'both';

  // Restored after mount, never during render — the server has no localStorage
  // and a mismatch here would be a hydration error on every page.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(KEY_SORT_FIELD) === 'level') setSortField('level');
      if (sessionStorage.getItem(KEY_SORT_DIR) === 'asc') setSortDir('asc');
    } catch {
      /* private browsing, or storage disabled */
    }
  }, []);

  useEffect(() => {
    if (modeProp) {
      setMode(modeProp);
      return;
    }
    if (!actor) return;
    let cancelled = false;

    // Render from what the hub said last time, so an outage does not take the
    // widget away with it. Refreshed below whenever the hub can be reached.
    const remembered = readCachedMode(apiBase);
    if (remembered) setMode(remembered);

    fetch(`${apiBase}/config`)
      .then((r) => (r.ok ? (r.json() as Promise<FeedbackConfig>) : null))
      .then((cfg) => {
        if (cancelled) return;
        if (cfg) {
          setMode(cfg.mode);
          writeCachedMode(apiBase, cfg.mode);
        } else if (!remembered) {
          // Nothing cached and the hub said no: there is no sensible widget to
          // draw, so say why rather than vanishing without explanation.
          warnOnce(apiBase, 'the hub rejected the request (check FEEDBACK_API_KEY)');
        }
      })
      .catch(() => {
        if (!cancelled && !remembered) {
          warnOnce(apiBase, 'the hub could not be reached (check FEEDBACK_HUB_URL and the proxy route)');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [actor, apiBase, modeProp]);

  const load = useCallback(() => {
    if (!actor) return;
    fetch(`${apiBase}/items`)
      .then((r) => (r.ok ? (r.json() as Promise<FeedbackItem[]>) : []))
      .then((rows) => setItems(Array.isArray(rows) ? rows : []))
      .catch(() => setItems([]));
  }, [actor, apiBase]);

  useEffect(() => {
    if (mode) load();
  }, [mode, load]);

  // The sliding indicator is measured rather than calculated, so it stays right
  // whatever the tab labels say.
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const btn = el.querySelector<HTMLElement>(`[data-tab="${activeTab}"]`);
    if (btn) setTabSlider({ left: btn.offsetLeft, width: btn.offsetWidth });
  }, [activeTab, isOpen, mode]);

  // Opening the panel starts from the top: the first available tab, and the
  // open list rather than wherever the archive was left.
  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(showBugs ? 'bug' : 'feature');
    setShowArchived({ bug: false, feature: false });
    setNotice(null);
  }, [isOpen, showBugs]);

  useEffect(() => {
    if (!isOpen) return;
    function onOutside(e: MouseEvent | TouchEvent) {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !fabRef.current?.contains(target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('touchstart', onOutside);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('touchstart', onOutside);
    };
  }, [isOpen]);

  // Default to whichever tab exists once the mode is known, so a bugs-only
  // widget never opens on an empty features tab.
  useEffect(() => {
    if (!mode) return;
    setActiveTab((tab) => {
      if (tab === 'bug' && !showBugs) return 'feature';
      if (tab === 'feature' && !showFeatures) return 'bug';
      return tab;
    });
  }, [mode, showBugs, showFeatures]);

  const remember = (storageKey: string, value: string) => {
    try {
      sessionStorage.setItem(storageKey, value);
    } catch {
      /* ignore */
    }
  };

  const sorted = useMemo(() => {
    const rank = (item: FeedbackItem) => {
      const level = item.kind === 'bug' ? item.criticality : item.priority;
      if (!level) return 99;
      const table = item.kind === 'bug' ? CRITICALITY_ORDER : PRIORITY_ORDER;
      return table[level] ?? 99;
    };
    return (list: FeedbackItem[]) =>
      [...list].sort((a, b) => {
        if (sortField === 'level') {
          const diff = rank(a) - rank(b);
          if (diff !== 0) return sortDir === 'asc' ? diff : -diff;
        }
        const at = new Date(a.createdAt).getTime();
        const bt = new Date(b.createdAt).getTime();
        return sortDir === 'asc' ? at - bt : bt - at;
      });
  }, [sortField, sortDir]);

  // Undelivered reports render alongside real ones, so somebody who filed
  // during an outage can see their report was kept rather than lost.
  const pendingItems = useMemo<FeedbackItem[]>(
    () =>
      queued.map((r) => ({
        id: r.id,
        kind: r.kind,
        text: r.text,
        createdAt: r.createdAt,
        completed: false,
        approved: false,
        rejected: false,
        criticality: null,
        priority: null,
        reporterName: actor?.userName ?? null,
        reporterEmail: actor?.userEmail ?? null,
        mine: true,
        pending: true,
        pendingLabel: describeWait(r),
        pendingDetail: describeStatus(r, retryScheduleMs),
        gaveUp: r.gaveUp,
      })),
    [queued, actor, retryScheduleMs],
  );

  const forTab = useCallback(
    (kind: FeedbackKind) => {
      const mine = [...pendingItems, ...items].filter((i) => i.kind === kind);
      return {
        open: sorted(mine.filter((i) => !i.completed && !i.rejected)),
        archived: sorted(mine.filter((i) => i.completed || i.rejected)),
      };
    },
    [items, pendingItems, sorted],
  );

  const bugList = forTab('bug');
  const featureList = forTab('feature');
  const totalOpen =
    (showBugs ? bugList.open.length : 0) + (showFeatures ? featureList.open.length : 0);

  const isQueued = useCallback((id: string) => queued.some((r) => r.id === id), [queued]);

  /**
   * Sends everything in the outbox that is due.
   *
   * Each report is claimed before the request so a second tab does not send it
   * as well, and released by `backOff` if it fails. Runs one at a time: a hub
   * that has just come back should not be met with a burst.
   */
  const flush = useCallback(async () => {
    if (!actor) return;
    const due = dueReports(readQueue(key));
    if (due.length === 0) return;

    for (const report of due) {
      claim(key, report.id);
      try {
        const res = await fetch(`${apiBase}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: report.kind,
            text: report.text,
            severity: report.severity ?? null,
          }),
        });
        if (res.ok) {
          const created = (await res.json()) as FeedbackItem;
          removeQueued(key, report.id);
          setItems((prev) =>
            prev.some((i) => i.id === created.id) ? prev : [created, ...prev],
          );
        } else if (isTransient(res.status)) {
          backOff(key, report.id, `HTTP ${res.status}`, retryScheduleMs);
        } else {
          // A permanent rejection will fail the same way tomorrow. Stop
          // retrying, but keep the report so it can be seen and copied out.
          backOff(key, report.id, `HTTP ${res.status}`, []);
        }
      } catch (err) {
        backOff(key, report.id, err instanceof Error ? err.message : 'network error', retryScheduleMs);
      }
    }

    setQueued(readQueue(key));
  }, [actor, apiBase, key, retryScheduleMs]);

  const submit = useCallback(
    async (kind: FeedbackKind) => {
      const text = drafts[kind].trim();
      if (!text || submitting) return;
      setSubmitting(true);
      setNotice(null);

      const severity = severities[kind] || null;

      const keep = (why: string) => {
        // The draft is cleared because the report is safe, not because it
        // was sent. It is in the outbox and shows in the list as pending.
        enqueue(key, { kind, text, severity }, retryScheduleMs);
        setQueued(readQueue(key));
        setDrafts((prev) => ({ ...prev, [kind]: '' }));
        setSeverities((prev) => ({ ...prev, [kind]: '' }));
        setNotice({ text: why, tone: 'info' });
      };

      try {
        const res = await fetch(`${apiBase}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, text, severity }),
        });
        if (!res.ok) {
          if (isTransient(res.status)) {
            keep('Saved — the server is busy, this will send itself shortly.');
          } else {
            // Nothing to retry: say so and leave the text in the box.
            setNotice({ text: 'Could not send that. Try again.', tone: 'error' });
          }
          return;
        }
        const created = (await res.json()) as FeedbackItem;
        setItems((prev) => [created, ...prev]);
        setDrafts((prev) => ({ ...prev, [kind]: '' }));
        setSeverities((prev) => ({ ...prev, [kind]: '' }));
      } catch {
        keep('Saved — the server is unreachable, this will send itself later.');
      } finally {
        setSubmitting(false);
      }
    },
    [apiBase, drafts, key, retryScheduleMs, severities, submitting],
  );

  const saveItem = useCallback(
    async (id: string, text: string) => {
      // Still in the outbox, so the edit lands on the queued copy — there is
      // nothing on the server to PATCH yet.
      if (isQueued(id)) {
        updateQueuedText(key, id, text);
        setQueued(readQueue(key));
        return;
      }
      const res = await fetch(`${apiBase}/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        setNotice({ text: 'Could not save that change.', tone: 'error' });
        return;
      }
      const updated = (await res.json()) as FeedbackItem;
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...updated } : i)));
    },
    [apiBase, isQueued, key],
  );

  const deleteItem = useCallback(
    async (id: string) => {
      if (isQueued(id)) {
        removeQueued(key, id);
        setQueued(readQueue(key));
        return;
      }
      const res = await fetch(`${apiBase}/items/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        setNotice({ text: 'Could not delete that.', tone: 'error' });
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== id));
    },
    [apiBase, isQueued, key],
  );

  /** Keeps the thread's label right without re-fetching the whole list. */
  const bumpMessageCount = useCallback((id: string, next: number) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, messageCount: next } : i)),
    );
  }, []);

  /** "Retry now" on a report whose schedule ran out. */
  const retryItem = useCallback(
    (id: string) => {
      retryNow(key, id);
      setQueued(readQueue(key));
      void flush();
    },
    [flush, key],
  );

  // Everything that should prompt a delivery attempt.
  //
  // The retry schedule is measured in hours, but the trigger for acting on it
  // is the app being open. Coming back online and un-hiding the tab are the
  // two moments most likely to follow an outage, so both are watched as well
  // as the clock.
  useEffect(() => {
    if (!actor || !mode) return;

    setQueued(readQueue(key));
    void flush();

    // A minute is fine: the shortest wait in the schedule is five.
    const timer = window.setInterval(() => {
      setQueued(readQueue(key));
      void flush();
    }, 60_000);

    const onWake = () => {
      if (document.visibilityState === 'visible') {
        setQueued(readQueue(key));
        void flush();
      }
    };
    // Another tab sent or queued something; reflect it rather than showing
    // a list that disagrees with what is actually in the outbox.
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) setQueued(readQueue(key));
    };

    window.addEventListener('online', onWake);
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('storage', onStorage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', onWake);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('storage', onStorage);
    };
  }, [actor, mode, key, flush]);

  // Keeps the "retrying in 2h" line honest while the panel sits open, without
  // a re-render a second when it is shut.
  useEffect(() => {
    if (!isOpen || queued.length === 0) return;
    const tick = window.setInterval(() => setQueued(readQueue(key)), 30_000);
    return () => window.clearInterval(tick);
  }, [isOpen, queued.length, key]);

  if (!actor || !mode) return null;

  const fabBackground =
    showBugs && showFeatures
      ? 'linear-gradient(135deg, #ef4444 50%, #f59e0b 50%)'
      : showBugs
        ? '#ef4444'
        : '#f59e0b';

  const list = activeTab === 'bug' ? bugList : featureList;
  const archivedOpen = showArchived[activeTab];
  const visible = archivedOpen ? list.archived : list.open;

  return (
    <div
      className={`mtfw-root mtfw-root--${position}`}
      {...(resolvedTheme ? { 'data-mtfw-theme': resolvedTheme } : {})}
    >
      <button
        ref={fabRef}
        type="button"
        className="mtfw-fab"
        style={{ background: fabBackground }}
        onClick={() => setIsOpen((o) => !o)}
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Close feedback panel' : 'Open bugs & feature requests'}
      >
        {showBugs && showFeatures ? (
          <SplitIcon />
        ) : showBugs ? (
          <BugIcon width={24} height={24} />
        ) : (
          <LightbulbIcon width={24} height={24} />
        )}
        {totalOpen > 0 && <span className="mtfw-fab-count">{totalOpen}</span>}
      </button>

      <div
        ref={panelRef}
        className={`mtfw-panel${isOpen ? ' mtfw-panel--open' : ''}`}
        role="dialog"
        aria-label="Bugs and feature requests"
        aria-hidden={!isOpen}
      >
        <div className="mtfw-tabs" ref={tabsRef}>
          {tabSlider && (
            <span
              className={`mtfw-tab-slider mtfw-tab-slider--${activeTab}`}
              style={{ left: tabSlider.left - 8, width: tabSlider.width + 16 }}
            />
          )}
          {showBugs && (
            <button
              type="button"
              data-tab="bug"
              className={`mtfw-tab${activeTab === 'bug' ? ' mtfw-tab--active' : ''}`}
              onClick={() => setActiveTab('bug')}
            >
              <BugIcon width={14} height={14} />
              <span className="mtfw-tab-label">Bugs</span>
              {bugList.open.length > 0 && (
                <span className="mtfw-tab-count mtfw-tab-count--bug">{bugList.open.length}</span>
              )}
            </button>
          )}
          {showFeatures && (
            <button
              type="button"
              data-tab="feature"
              className={`mtfw-tab${activeTab === 'feature' ? ' mtfw-tab--active' : ''}`}
              onClick={() => setActiveTab('feature')}
            >
              <LightbulbIcon width={14} height={14} />
              <span className="mtfw-tab-label">Features</span>
              {featureList.open.length > 0 && (
                <span className="mtfw-tab-count mtfw-tab-count--feature">
                  {featureList.open.length}
                </span>
              )}
            </button>
          )}
        </div>

        <div className="mtfw-toolbar">
          <div className="mtfw-sort">
            <select
              className="mtfw-sort-select"
              value={sortField}
              aria-label="Sort by"
              onChange={(e) => {
                const next = e.target.value as SortField;
                setSortField(next);
                remember(KEY_SORT_FIELD, next);
              }}
            >
              <option value="date">Date</option>
              <option value="level">{activeTab === 'bug' ? 'Criticality' : 'Priority'}</option>
            </select>
            <button
              type="button"
              className="mtfw-sort-dir"
              title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
              aria-label={sortDir === 'asc' ? 'Ascending' : 'Descending'}
              onClick={() => {
                const next: SortDir = sortDir === 'asc' ? 'desc' : 'asc';
                setSortDir(next);
                remember(KEY_SORT_DIR, next);
              }}
            >
              {sortDir === 'asc' ? (
                <ArrowUpIcon width={12} height={12} />
              ) : (
                <ArrowDownIcon width={12} height={12} />
              )}
            </button>
          </div>
          {list.archived.length > 0 && (
            <button
              type="button"
              className={`mtfw-archived${archivedOpen ? ' mtfw-archived--on' : ''}`}
              onClick={() =>
                setShowArchived((prev) => ({ ...prev, [activeTab]: !prev[activeTab] }))
              }
            >
              <ArchiveIcon width={14} height={14} />
              Archived ({list.archived.length})
            </button>
          )}
        </div>

        {!archivedOpen && (
          <div className="mtfw-compose">
            <textarea
              className={`mtfw-compose-input mtfw-compose-input--${activeTab}`}
              rows={4}
              placeholder={
                activeTab === 'bug' ? 'Describe a bug…' : 'Describe a feature request…'
              }
              value={drafts[activeTab]}
              onChange={(e) => setDrafts((prev) => ({ ...prev, [activeTab]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit(activeTab);
                }
              }}
            />
            <label className="mtfw-severity">
              <span className="mtfw-severity-label">
                {activeTab === 'bug' ? 'Criticality' : 'Priority'}
              </span>
              <select
                className="mtfw-severity-select"
                value={severities[activeTab]}
                onChange={(e) =>
                  setSeverities((prev) => ({
                    ...prev,
                    [activeTab]: e.target.value as FeedbackSeverity | '',
                  }))
                }
              >
                <option value="">Not sure</option>
                {(activeTab === 'bug' ? BUG_SEVERITIES : FEATURE_SEVERITIES).map((level) => (
                  <option key={level} value={level}>
                    {level[0]!.toUpperCase() + level.slice(1)}
                  </option>
                ))}
              </select>
            </label>

            <div className="mtfw-compose-actions">
              <button
                type="button"
                className={`mtfw-submit mtfw-submit--${activeTab}`}
                disabled={!drafts[activeTab].trim() || submitting}
                onClick={() => void submit(activeTab)}
              >
                {activeTab === 'bug' ? 'Add bug' : 'Add feature request'}
              </button>
            </div>
            {notice && (
              <p className={`mtfw-notice mtfw-notice--${notice.tone}`}>{notice.text}</p>
            )}
          </div>
        )}

        <div className="mtfw-list">
          {visible.length === 0 ? (
            <p className="mtfw-empty">
              {archivedOpen
                ? `No archived ${activeTab === 'bug' ? 'bugs' : 'features'}.`
                : activeTab === 'bug'
                  ? 'No open bugs. Add one above.'
                  : 'No open feature requests. Add one above.'}
            </p>
          ) : (
            <ul className="mtfw-items">
              {visible.map((item) => (
                <Item
                  key={item.id}
                  item={item}
                  kind={activeTab}
                  onSave={saveItem}
                  onDelete={deleteItem}
                  onRetry={retryItem}
                  apiBase={apiBase}
                  onMessageCountChange={bumpMessageCount}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
