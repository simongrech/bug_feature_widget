'use client';

export { FeedbackWidget } from './FeedbackWidget';
export type { FeedbackWidgetProps } from './FeedbackWidget';
export { setFeedbackWidgetTheme } from './useTheme';
export { DEFAULT_RETRY_SCHEDULE_MS } from './queue';
export type { QueuedReport } from './queue';
export type {
  FeedbackActor,
  FeedbackConfig,
  FeedbackCriticality,
  FeedbackItem,
  FeedbackKind,
  FeedbackMessage,
  FeedbackSeverity,
  FeedbackMode,
  FeedbackPriority,
  FeedbackTheme,
} from './types';
