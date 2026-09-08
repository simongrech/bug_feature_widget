import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDate } from './format';
import type { FeedbackMessage } from './types';

/**
 * How much of a conversation shows without being asked for, and how much each
 * "show more" adds. Three is enough to see that an answer came and roughly
 * what it said; a whole thread expanded in a 20rem panel would bury the next
 * report under it.
 */
const PREVIEW = 3;
const PAGE = 5;

/** Who wrote a reply, as the reader should see it. */
function describe(message: FeedbackMessage): {
  name: string;
  tone: 'staff' | 'you' | 'reporter';
} {
  if (message.authorKind === 'staff') {
    return { name: message.authorName ?? 'Support', tone: 'staff' };
  }
  if (message.mine) return { name: 'You', tone: 'you' };
  return { name: message.authorName ?? 'Reporter', tone: 'reporter' };
}

/**
 * Up to two letters for the bubble. First and last word, so "Ada Lovelace"
 * reads as AL rather than AD — a room of Adas is told apart by the surname.
 */
function initials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]![0]!;
  const last = words.length > 1 ? words[words.length - 1]![0]! : '';
  return (first + last).toUpperCase();
}

/**
 * The conversation on one report.
 *
 * The last few replies are shown with the report rather than hidden behind the
 * toggle: an answer nobody opens is an answer nobody read, and the panel gave
 * no sign that one had arrived. Newest first, because that is the one being
 * waited for; older ones are a click away.
 *
 * The conversation is fetched for every report on screen once the panel is
 * open, and `messageCount` decides only what is drawn while that is in flight.
 * It was the gate at first, until a hub answering 0 for a report that plainly
 * had a reply hid the conversation behind the toggle again — which is the one
 * thing the preview exists to stop. A count is a hint about how many, never
 * evidence that there are none.
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
  active = true,
}: {
  itemId: string;
  apiBase: string;
  /** Replies the list said there are. `undefined` means the hub did not say. */
  count?: number;
  onCountChange: (next: number) => void;
  /** Whether the panel holding this thread is open. Nothing loads while shut. */
  active?: boolean;
}) {
  const [composing, setComposing] = useState(false);
  const [messages, setMessages] = useState<FeedbackMessage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [shown, setShown] = useState(PREVIEW);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
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
    } finally {
      setLoading(false);
    }
  }, [apiBase, itemId]);

  useEffect(() => {
    if (!active || loading || messages !== null) return;
    void load();
  }, [active, load, loading, messages]);

  /**
   * Newest first. The hub returns the conversation oldest first, which is the
   * right order to read a thread in but the wrong one to truncate: cutting the
   * tail off would hide exactly the reply somebody is waiting for.
   */
  const ordered = useMemo(
    () =>
      messages === null
        ? []
        : [...messages].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          ),
    [messages],
  );

  const visible = ordered.slice(0, shown);
  const hidden = ordered.length - visible.length;

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
      const before = messages?.length ?? count ?? 0;
      setMessages((prev) => [created, ...(prev ?? [])]);
      onCountChange(before + 1);
      setDraft('');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }, [apiBase, busy, count, draft, itemId, messages, onCountChange]);

  /**
   * What to draw before the conversation arrives — which is all `count` is
   * still good for. A report the list says is empty keeps the row it had,
   * rather than every report in the panel flashing "Loading replies…" the
   * moment it opens; if the fetch turns up replies anyway, they appear.
   */
  const expecting = count === undefined || count > 0;
  const showLog = messages === null ? expecting : ordered.length > 0;

  return (
    <div className="mtfw-thread">
      {showLog && (
        <div className="mtfw-thread-log">
          {messages === null ? (
            <p className="mtfw-thread-empty">Loading replies…</p>
          ) : (
            ordered.length > 0 && (
              <>
                <ul className="mtfw-thread-list">
                  {visible.map((message) => {
                    const who = describe(message);
                    return (
                      <li key={message.id} className={`mtfw-message mtfw-message--${who.tone}`}>
                        <span
                          className={`mtfw-avatar mtfw-avatar--${who.tone}`}
                          aria-hidden="true"
                          title={who.name}
                        >
                          {initials(message.authorName ?? who.name)}
                        </span>
                        <div className="mtfw-message-main">
                          <p className="mtfw-message-who">
                            <span className="mtfw-message-name">{who.name}</span>
                            <time className="mtfw-message-time" dateTime={message.createdAt}>
                              {formatDate(message.createdAt)}
                            </time>
                          </p>
                          <p className="mtfw-message-body">{message.body}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {hidden > 0 ? (
                  <button
                    type="button"
                    className="mtfw-thread-more"
                    onClick={() => setShown((n) => n + PAGE)}
                  >
                    Show {hidden} more {hidden === 1 ? 'reply' : 'replies'}
                  </button>
                ) : (
                  shown > PREVIEW && (
                    <button
                      type="button"
                      className="mtfw-thread-more"
                      onClick={() => setShown(PREVIEW)}
                    >
                      Show fewer
                    </button>
                  )
                )}
              </>
            )
          )}
        </div>
      )}

      <button
        type="button"
        className="mtfw-thread-toggle"
        aria-expanded={composing}
        onClick={() => setComposing((o) => !o)}
      >
        Reply
        <span aria-hidden="true">{composing ? ' ▴' : ' ▾'}</span>
      </button>

      {composing && (
        <div className="mtfw-thread-body">
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
        </div>
      )}

      {error && <p className="mtfw-notice mtfw-notice--error">{error}</p>}
    </div>
  );
}
