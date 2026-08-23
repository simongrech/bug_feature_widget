import type { FeedbackKind } from './types';

/**
 * An outbox for reports that could not be delivered.
 *
 * The hub being down must not cost somebody the bug they just took the trouble
 * to write up — that is the one moment where losing data is most annoying and
 * least forgivable. A failed send is kept in localStorage and retried on a
 * widening schedule instead of being thrown away with an error toast.
 *
 * **This retries in the browser, so it only makes attempts while the app is
 * open.** A queued report is checked on mount, when the tab becomes visible,
 * when the browser reports coming back online, and on a timer while the page
 * stays open. The long delays therefore mean "not before then" rather than
 * "exactly then": a report queued overnight goes out when somebody next opens
 * the app, which is the realistic shape of an admin tool. Nothing is lost
 * either way — the queue outlives the tab, the browser and a reboot.
 */

/** 5m, 15m, 30m, 1h, 2h, 5h, 12h, next day. */
export const DEFAULT_RETRY_SCHEDULE_MS: readonly number[] = [
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000,
  5 * 60 * 60_000,
  12 * 60 * 60_000,
  24 * 60 * 60_000,
];

/**
 * How long one tab's claim on a report is honoured by the others. Two tabs
 * open on the same app would otherwise both find the same report due and send
 * it twice; a short lease costs nothing and means a duplicate needs a tab to
 * die mid-request.
 */
const CLAIM_TTL_MS = 60_000;

export interface QueuedReport {
  /** Also the optimistic item's id, so the list can render it before it exists. */
  id: string;
  kind: FeedbackKind;
  text: string;
  /** When it was written, not when it was sent. The hub is told this. */
  createdAt: string;
  /** Failed sends so far. Indexes into the retry schedule. */
  attempts: number;
  nextAttemptAt: number;
  claimedAt?: number;
  lastError?: string;
  /** Schedule exhausted. Kept, and shown, but no longer retried on its own. */
  gaveUp?: boolean;
}

/** Keyed by mount point, so two widgets in one app cannot eat each other's outbox. */
export function queueKey(apiBase: string): string {
  return `mtfw:queue:${apiBase}`;
}

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function readQueue(key: string): QueuedReport[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // Anything malformed is discarded rather than crashing the widget on
    // mount. A corrupt outbox is bad; a widget that will not render is worse.
    return Array.isArray(parsed) ? (parsed as QueuedReport[]).filter(isReport) : [];
  } catch {
    return [];
  }
}

function isReport(value: unknown): value is QueuedReport {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Partial<QueuedReport>;
  return (
    typeof r.id === 'string' &&
    (r.kind === 'bug' || r.kind === 'feature') &&
    typeof r.text === 'string' &&
    typeof r.nextAttemptAt === 'number'
  );
}

export function writeQueue(key: string, reports: QueuedReport[]): void {
  try {
    if (reports.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(reports));
  } catch {
    /* storage full or blocked — the report stays in memory for this session */
  }
}

/** Re-read, apply, write. Every mutation goes through this so that a second
 *  tab's concurrent change is merged rather than clobbered. */
export function mutateQueue(
  key: string,
  fn: (reports: QueuedReport[]) => QueuedReport[],
): QueuedReport[] {
  const next = fn(readQueue(key));
  writeQueue(key, next);
  return next;
}

export function enqueue(
  key: string,
  report: { kind: FeedbackKind; text: string; createdAt?: string },
  schedule: readonly number[] = DEFAULT_RETRY_SCHEDULE_MS,
): QueuedReport {
  const entry: QueuedReport = {
    id: newId(),
    kind: report.kind,
    text: report.text,
    createdAt: report.createdAt ?? new Date().toISOString(),
    attempts: 1,
    // The send that just failed counts as the first attempt, so the wait
    // starts at the first delay rather than at zero.
    nextAttemptAt: Date.now() + (schedule[0] ?? 0),
  };
  mutateQueue(key, (reports) => [...reports, entry]);
  return entry;
}

/** Reports due now and not claimed by another tab. */
export function dueReports(reports: QueuedReport[], now = Date.now()): QueuedReport[] {
  return reports.filter(
    (r) =>
      !r.gaveUp &&
      r.nextAttemptAt <= now &&
      (!r.claimedAt || now - r.claimedAt > CLAIM_TTL_MS),
  );
}

export function claim(key: string, id: string): void {
  mutateQueue(key, (reports) =>
    reports.map((r) => (r.id === id ? { ...r, claimedAt: Date.now() } : r)),
  );
}

/** Records a failure and books the next attempt, or gives up if the schedule
 *  has run out. A report that gave up is kept and shown — never deleted. */
export function backOff(
  key: string,
  id: string,
  error: string,
  schedule: readonly number[] = DEFAULT_RETRY_SCHEDULE_MS,
): void {
  mutateQueue(key, (reports) =>
    reports.map((r) => {
      if (r.id !== id) return r;
      const attempts = r.attempts + 1;
      const delay = schedule[attempts - 1];
      return delay === undefined
        ? { ...r, attempts, claimedAt: undefined, lastError: error, gaveUp: true }
        : {
            ...r,
            attempts,
            claimedAt: undefined,
            lastError: error,
            nextAttemptAt: Date.now() + delay,
          };
    }),
  );
}

export function remove(key: string, id: string): void {
  mutateQueue(key, (reports) => reports.filter((r) => r.id !== id));
}

export function updateText(key: string, id: string, text: string): void {
  mutateQueue(key, (reports) => reports.map((r) => (r.id === id ? { ...r, text } : r)));
}

/** Puts a report back at the front of the line, for a manual "retry now". */
export function retryNow(key: string, id: string): void {
  mutateQueue(key, (reports) =>
    reports.map((r) =>
      r.id === id
        ? { ...r, nextAttemptAt: 0, claimedAt: undefined, gaveUp: false }
        : r,
    ),
  );
}

/** When the next attempt is due, for the "retrying in ~2h" line. */
export function describeWait(report: QueuedReport, now = Date.now()): string {
  if (report.gaveUp) return 'not sent';
  const ms = report.nextAttemptAt - now;
  if (ms <= 0) return 'sending…';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `retrying in ${Math.max(1, mins)}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `retrying in ${hours}h`;
  return `retrying in ${Math.round(hours / 24)}d`;
}

/**
 * The long form, for the tooltip on the status icon: what happened, how many
 * tries have been made, and when the next one is due.
 */
export function describeStatus(
  report: QueuedReport,
  schedule: readonly number[] = DEFAULT_RETRY_SCHEDULE_MS,
  now = Date.now(),
): string {
  const tried = `${report.attempts} of ${schedule.length + 1} attempts made`;
  const because = report.lastError ? ` Last error: ${report.lastError}.` : '';

  if (report.gaveUp) {
    return `Not sent. ${tried}, none got through.${because} Use Retry to try again now.`;
  }

  const ms = report.nextAttemptAt - now;
  const when =
    ms <= 0
      ? 'Sending now.'
      : `Next attempt in ${formatDelay(ms)}, or as soon as you next open the app.`;

  return `Saved on this device, not yet sent to the tracker. ${tried}. ${when}${because}`;
}

function formatDelay(ms: number): string {
  // Floor of one: a wait under 30s rounds to zero, and "in about 0 minutes"
  // is worse than rounding up. Pluralise on what is shown, not on what was
  // calculated.
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return `about ${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `about ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `about ${days} day${days === 1 ? '' : 's'}`;
}
