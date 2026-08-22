/** What the widget can be asked to collect. Set per API key in the hub. */
export type FeedbackMode = 'bugs' | 'features' | 'both';

/** Which of the two lists an item belongs to. */
export type FeedbackKind = 'bug' | 'feature';

export type FeedbackCriticality = 'low' | 'medium' | 'high' | 'critical';
export type FeedbackPriority = 'low' | 'medium' | 'high';

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
}

/** Answer of `GET {apiBase}/config`. */
export interface FeedbackConfig {
  site: { name: string; slug: string };
  mode: FeedbackMode;
}
