import { useCallback, useEffect, useState } from 'react';
import type { FeedbackMessage } from './types';

/**
 * The conversation on one report.
 *
 * Loaded when the thread is opened rather than with the list: most reports
 * have no replies, and fetching every thread up front would make opening the
 * panel slower for the common case in order to speed up the rare one.
 *
 * A report that has been triaged still accepts replies. "Why was this
 * rejected?" is exactly the question a thread is for, and the hub allows it
 * even though the report itself has stopped being editable.
 */
export function Thread({
  itemId,
  apiBase,
  count,
  onCountChange,
}: {
  itemId: string;
  apiBase: string;
  count: number;
  onCountChange: (next: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<FeedbackMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/items/${itemId}/messages`);
      if (!res.ok) {
        // The status is the whole diagnosis here: 404 means the proxy did not
        // recognise the path (usually a stale build), 401 a lost session, 502
        // a hub that is down. Saying only "could not load" sends somebody
        // hunting through three codebases for it.
        setError(`Could not load the replies (${res.status}).`);
        setMessages([]);
        return;
      }
      const rows = (await res.json()) as FeedbackMessage[];
      setMessages(Array.isArray(rows) ? rows : []);
    } catch {
      setError('Could not reach the server.');
      setMessages([]);
    }
  }, [apiBase, itemId]);

  useEffect(() => {
    if (open && messages === null) void load();
  }, [open, messages, load]);

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/items/${itemId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        // Not queued like a report is: a reply is part of a conversation, and
        // one that turns up hours later out of order is worse than one the
        // sender knows did not go.
        setError(`Could not send that reply (${res.status}).`);
        return;
      }
      const created = (await res.json()) as FeedbackMessage;
      setMessages((prev) => [...(prev ?? []), created]);
      onCountChange(count + 1);
      setDraft('');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }, [apiBase, busy, count, draft, itemId, onCountChange]);

  return (
    <div className="mtfw-thread">
      <button
        type="button"
        className="mtfw-thread-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {count === 0 ? 'Reply' : count === 1 ? '1 reply' : `${count} replies`}
        <span aria-hidden="true">{open ? ' ▴' : ' ▾'}</span>
      </button>

      {open && (
        <div className="mtfw-thread-body">
          {messages === null ? (
            <p className="mtfw-thread-empty">Loading…</p>
          ) : messages.length === 0 ? (
            <p className="mtfw-thread-empty">No replies yet.</p>
          ) : (
            <ul className="mtfw-thread-list">
              {messages.map((message) => (
                <li
                  key={message.id}
                  className={`mtfw-message mtfw-message--${
                    message.authorKind === 'staff' ? 'staff' : 'reporter'
                  }`}
                >
                  <p className="mtfw-message-who">
                    {message.authorKind === 'staff'
                      ? (message.authorName ?? 'Support')
                      : message.mine
                        ? 'You'
                        : (message.authorName ?? 'Reporter')}
                  </p>
                  <p className="mtfw-message-body">{message.body}</p>
                </li>
              ))}
            </ul>
          )}

          <textarea
            className="mtfw-thread-input"
            rows={2}
            placeholder="Write a reply…"
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            type="button"
            className="mtfw-thread-send"
            disabled={!draft.trim() || busy}
            onClick={() => void send()}
          >
            Send reply
          </button>
          {error && <p className="mtfw-notice mtfw-notice--error">{error}</p>}
        </div>
      )}
    </div>
  );
}
