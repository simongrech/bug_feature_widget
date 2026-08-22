import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArchiveIcon, ArrowDownIcon, ArrowUpIcon, BugIcon, LightbulbIcon, SplitIcon } from './icons';
import { Item } from './Item';
import { useResolvedTheme } from './useTheme';
import type {
  FeedbackActor,
  FeedbackConfig,
  FeedbackItem,
  FeedbackKind,
  FeedbackMode,
  FeedbackTheme,
} from './types';

const KEY_TAB = 'mtfw:tab';
const KEY_SORT_FIELD = 'mtfw:sort-field';
const KEY_SORT_DIR = 'mtfw:sort-dir';

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
}

type SortField = 'date' | 'level';
type SortDir = 'asc' | 'desc';

export function FeedbackWidget({
  actor,
  apiBase = '/api/feedback',
  mode: modeProp,
  theme = 'system',
  position = 'bottom-right',
}: FeedbackWidgetProps) {
  const [mode, setMode] = useState<FeedbackMode | undefined>(modeProp);
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<FeedbackKind>('bug');
  const [drafts, setDrafts] = useState<Record<FeedbackKind, string>>({ bug: '', feature: '' });
  const [showArchived, setShowArchived] = useState<Record<FeedbackKind, boolean>>({
    bug: false,
    feature: false,
  });
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [tabSlider, setTabSlider] = useState<{ left: number; width: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  const resolvedTheme = useResolvedTheme(theme);

  const showBugs = mode === 'bugs' || mode === 'both';
  const showFeatures = mode === 'features' || mode === 'both';

  // Restored after mount, never during render — the server has no localStorage
  // and a mismatch here would be a hydration error on every page.
  useEffect(() => {
    try {
      const tab = localStorage.getItem(KEY_TAB);
      if (tab === 'bug' || tab === 'feature') setActiveTab(tab);
      if (localStorage.getItem(KEY_SORT_FIELD) === 'level') setSortField('level');
      if (localStorage.getItem(KEY_SORT_DIR) === 'asc') setSortDir('asc');
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
    fetch(`${apiBase}/config`)
      .then((r) => (r.ok ? (r.json() as Promise<FeedbackConfig>) : null))
      .then((cfg) => {
        if (!cancelled && cfg) setMode(cfg.mode);
      })
      .catch(() => {
        /* an unreachable hub leaves the widget hidden rather than broken */
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

  const remember = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
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

  const forTab = useCallback(
    (kind: FeedbackKind) => {
      const mine = items.filter((i) => i.kind === kind);
      return {
        open: sorted(mine.filter((i) => !i.completed && !i.rejected)),
        archived: sorted(mine.filter((i) => i.completed || i.rejected)),
      };
    },
    [items, sorted],
  );

  const bugList = forTab('bug');
  const featureList = forTab('feature');
  const totalOpen =
    (showBugs ? bugList.open.length : 0) + (showFeatures ? featureList.open.length : 0);

  const submit = useCallback(
    async (kind: FeedbackKind) => {
      const text = drafts[kind].trim();
      if (!text || submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch(`${apiBase}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, text }),
        });
        if (!res.ok) {
          // Say so rather than clearing the box: a report that silently
          // vanishes is worse than no widget at all.
          setError(
            res.status === 429
              ? 'Too many reports — try again shortly.'
              : 'Could not send that. Try again.',
          );
          return;
        }
        const created = (await res.json()) as FeedbackItem;
        setItems((prev) => [created, ...prev]);
        setDrafts((prev) => ({ ...prev, [kind]: '' }));
      } catch {
        setError('Could not reach the server.');
      } finally {
        setSubmitting(false);
      }
    },
    [apiBase, drafts, submitting],
  );

  const saveItem = useCallback(
    async (id: string, text: string) => {
      const res = await fetch(`${apiBase}/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        setError('Could not save that change.');
        return;
      }
      const updated = (await res.json()) as FeedbackItem;
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...updated } : i)));
    },
    [apiBase],
  );

  const deleteItem = useCallback(
    async (id: string) => {
      const res = await fetch(`${apiBase}/items/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        setError('Could not delete that.');
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== id));
    },
    [apiBase],
  );

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
              onClick={() => {
                setActiveTab('bug');
                remember(KEY_TAB, 'bug');
              }}
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
              onClick={() => {
                setActiveTab('feature');
                remember(KEY_TAB, 'feature');
              }}
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
            <button
              type="button"
              className={`mtfw-submit mtfw-submit--${activeTab}`}
              disabled={!drafts[activeTab].trim() || submitting}
              onClick={() => void submit(activeTab)}
            >
              {activeTab === 'bug' ? 'Add bug' : 'Add feature request'}
            </button>
            {error && <p className="mtfw-error">{error}</p>}
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
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
