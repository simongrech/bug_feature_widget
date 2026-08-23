import { useCallback, useState } from 'react';
import { AlertIcon, CheckIcon, ClockIcon, PencilIcon, RefreshIcon, TrashIcon } from './icons';
import { Thread } from './Thread';
import type { FeedbackItem, FeedbackKind } from './types';

/**
 * Same rule the original widget used: today shows a time, anything older shows
 * a date. Locale and zone are the reader's, which is right for a widget that
 * only ever shows a reader their own reports.
 */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (d.toDateString() === new Date().toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusBadge({ item }: { item: FeedbackItem }) {
  if (item.rejected) return <span className="mtfw-badge mtfw-badge--rejected">Rejected</span>;
  if (item.completed) return <span className="mtfw-badge mtfw-badge--done">Done</span>;
  if (item.approved) return <span className="mtfw-badge mtfw-badge--approved">Approved</span>;
  return null;
}

/**
 * Whether this report has reached the tracker.
 *
 * Three states, and the middle one is the reason this exists: a report sitting
 * in the browser outbox during an outage looks exactly like a delivered one
 * unless it is labelled, and somebody who cannot tell will file it twice. The
 * short label carries the wait; `title` carries the full story, because a
 * tooltip positioned in CSS would be clipped by the panel's own overflow.
 */
function StatusPill({
  item,
  onRetry,
}: {
  item: FeedbackItem;
  onRetry?: (id: string) => void;
}) {
  if (!item.pending) {
    return (
      <span
        className="mtfw-status mtfw-status--sent"
        title="Delivered to the tracker."
        aria-label="Delivered to the tracker"
      >
        <CheckIcon width={11} height={11} />
        Sent
      </span>
    );
  }

  const detail = item.pendingDetail ?? 'Saved on this device, not yet sent.';

  if (item.gaveUp) {
    return (
      <span className="mtfw-status mtfw-status--failed" title={detail} aria-label={detail}>
        <AlertIcon width={11} height={11} />
        Not sent
        {onRetry && (
          <button
            type="button"
            className="mtfw-status-retry"
            onClick={() => onRetry(item.id)}
            title="Try sending this now"
          >
            <RefreshIcon width={10} height={10} />
            Retry
          </button>
        )}
      </span>
    );
  }

  return (
    <span className="mtfw-status mtfw-status--pending" title={detail} aria-label={detail}>
      <ClockIcon width={11} height={11} />
      {item.pendingLabel ?? 'pending'}
    </span>
  );
}

export interface ItemProps {
  item: FeedbackItem;
  kind: FeedbackKind;
  onSave: (id: string, text: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** Offered on a report whose retry schedule has run out. */
  onRetry?: (id: string) => void;
  /** Where the proxy is mounted, for loading the reply thread. */
  apiBase?: string;
  /** Told when a reply is added, so the list's label stays right. */
  onMessageCountChange?: (id: string, next: number) => void;
}

export function Item({
  item,
  kind,
  onSave,
  onDelete,
  onRetry,
  apiBase = '/api/feedback',
  onMessageCountChange,
}: ItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const [busy, setBusy] = useState(false);

  const archived = item.completed || item.rejected;
  // Triage lives in the hub, so an item stops being the reporter's to change
  // the moment somebody there has acted on it. A report still in the outbox
  // has reached nobody, so it is always editable.
  const editable = item.mine && (item.pending || !archived);
  const level = kind === 'bug' ? item.criticality : item.priority;

  const save = useCallback(async () => {
    const text = draft.trim();
    if (!text || text === item.text) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onSave(item.id, text);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }, [draft, item.id, item.text, onSave]);

  return (
    <li
      className={`mtfw-item${archived ? ' mtfw-item--archived' : ''}${
        item.pending ? ' mtfw-item--unsent' : ''
      }`}
    >
      <div className="mtfw-item-top">
        <div className="mtfw-item-main">
          {editing ? (
            <div className="mtfw-edit">
              <textarea
                className="mtfw-edit-input"
                value={draft}
                autoFocus
                rows={2}
                disabled={busy}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void save();
                  }
                  if (e.key === 'Escape') setEditing(false);
                }}
              />
              <div className="mtfw-edit-actions">
                <button
                  type="button"
                  className={`mtfw-edit-save mtfw-edit-save--${kind}`}
                  disabled={busy}
                  onClick={() => void save()}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="mtfw-edit-cancel"
                  disabled={busy}
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="mtfw-item-text">{item.text}</p>
              <div className="mtfw-item-meta">
                {level && (
                  <span className={`mtfw-badge mtfw-badge--${kind}-${level}`}>{level}</span>
                )}
                <StatusBadge item={item} />
                {(item.reporterName || item.reporterEmail) && (
                  <span className="mtfw-item-author">
                    {item.reporterName || item.reporterEmail}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {!editing && editable && (
          <div className="mtfw-item-actions">
            <button
              type="button"
              className="mtfw-icon-btn"
              aria-label="Edit"
              onClick={() => {
                setDraft(item.text);
                setEditing(true);
              }}
            >
              <PencilIcon width={14} height={14} />
            </button>
            <button
              type="button"
              className="mtfw-icon-btn mtfw-icon-btn--danger"
              aria-label="Delete"
              onClick={() => void onDelete(item.id)}
            >
              <TrashIcon width={14} height={14} />
            </button>
          </div>
        )}
      </div>

      <div className="mtfw-item-foot">
        <time className="mtfw-item-date" dateTime={item.createdAt}>
          {formatDate(item.createdAt)}
        </time>
        <StatusPill item={item} onRetry={onRetry} />
      </div>

      {/* A report still in the outbox has no id on the server to hang a
          conversation from, so the thread waits until it has been delivered. */}
      {!item.pending && (
        <Thread
          itemId={item.id}
          apiBase={apiBase}
          count={item.messageCount ?? 0}
          onCountChange={(next) => onMessageCountChange?.(item.id, next)}
        />
      )}
    </li>
  );
}
