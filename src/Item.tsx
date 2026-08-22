import { useCallback, useState } from 'react';
import { PencilIcon, TrashIcon } from './icons';
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

export interface ItemProps {
  item: FeedbackItem;
  kind: FeedbackKind;
  onSave: (id: string, text: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function Item({ item, kind, onSave, onDelete }: ItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const [busy, setBusy] = useState(false);

  const archived = item.completed || item.rejected;
  // Triage lives in the hub, so an item stops being the reporter's to change
  // the moment somebody there has acted on it.
  const editable = item.mine && !archived;
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
    <li className={`mtfw-item${archived ? ' mtfw-item--archived' : ''}`}>
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

      <time className="mtfw-item-date" dateTime={item.createdAt}>
        {formatDate(item.createdAt)}
      </time>
    </li>
  );
}
