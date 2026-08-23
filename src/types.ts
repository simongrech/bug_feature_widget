/** What the widget can be asked to collect. Set per API key in the hub. */
export type FeedbackMode = 'bugs' | 'features' | 'both';

/** Which of the two lists an item belongs to. */
export type FeedbackKind = 'bug' | 'feature';

export type FeedbackCriticality = 'low' | 'medium' | 'high' | 'critical';
export type FeedbackPriority = 'low' | 'medium' | 'high';

/**
 * What the reporter can set. One scale on the wire; the hub files it as
 * criticality for a bug and priority for a feature, and refuses `critical`
 * on a feature because that scale stops at high.
 */
export type FeedbackSeverity = FeedbackCriticality;

export const BUG_SEVERITIES: readonly FeedbackSeverity[] = [
  'low',
  'medium',
  'high',
  'critical',
];

export const FEATURE_SEVERITIES: readonly FeedbackSeverity[] = ['low', 'medium', 'high'];

/**
 * `system` follows the operating system and keeps following it; `light` and
 * `dark` lock the widget regardless of anything else. See `useResolvedTheme`.
 */
export type FeedbackTheme = 'light' | 'dark' | 'system';

/**
 * Who is reporting. Supplied by the host site, and stamped onto every request
 * server-side by the proxy — the browser never gets to claim an identity.
 */
export interface FeedbackActor {
  userId: string;
  userName?: string;
  userEmail?: string;
}

/**
 * One report, as the hub returns it.
 *
 * There is no `archived` column: an item is archived once it has been marked
 * done or rejected, which is the same rule the original widget used.
 */
export interface FeedbackItem {
  id: string;
  kind: FeedbackKind;
  text: string;
  createdAt: string;
  completed: boolean;
  approved: boolean;
  rejected: boolean;
  criticality?: FeedbackCriticality | null;
  priority?: FeedbackPriority | null;
  reporterName?: string | null;
  reporterEmail?: string | null;
  /** Whether the current actor filed this — what edit and delete are gated on. */
  mine: boolean;
  /**
   * Set on reports still sitting in the browser outbox because the hub could
   * not be reached. They render in the list like anything else so that the
   * reporter can see their report was kept, with the wait spelled out.
   */
  pending?: boolean;
  /** Human-readable next attempt, e.g. "retrying in 2h". Pending items only. */
  pendingLabel?: string;
  /** The full story for the status tooltip: attempts made, next one due. */
  pendingDetail?: string;
  /** Schedule exhausted — offers a manual retry instead. */
  gaveUp?: boolean;
  /** Live replies on this report. Absent on one still in the outbox. */
  messageCount?: number;
}

/** One reply on a report, from either side of the conversation. */
export interface FeedbackMessage {
  id: string;
  body: string;
  createdAt: string;
  authorKind: 'reporter' | 'staff';
  authorName: string | null;
  /** Whether the current reporter wrote it. */
  mine: boolean;
}

/** Answer of `GET {apiBase}/config`. */
export interface FeedbackConfig {
  site: { name: string; slug: string };
  mode: FeedbackMode;
}
