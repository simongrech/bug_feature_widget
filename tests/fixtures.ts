import type { FeedbackItem } from '../src/types';

export const actor = {
  userId: 'ada',
  userName: 'Ada Lovelace',
  userEmail: 'ada@example.com',
};

export function item(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: '1',
    kind: 'bug',
    text: 'Submit stays disabled after a failed request.',
    createdAt: '2026-01-15T12:00:00.000Z',
    completed: false,
    approved: false,
    rejected: false,
    mine: true,
    reporterName: 'Ada Lovelace',
    ...overrides,
  };
}
