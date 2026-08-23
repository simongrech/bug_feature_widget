import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RETRY_SCHEDULE_MS,
  backOff,
  claim,
  describeStatus,
  describeWait,
  dueReports,
  enqueue,
  queueKey,
  readQueue,
  remove,
  retryNow,
  updateText,
  writeQueue,
  type QueuedReport,
} from '../src/queue';

const KEY = queueKey('/api/feedback');
const SCHEDULE = [1000, 2000, 4000] as const;

function only(): QueuedReport {
  const [first] = readQueue(KEY);
  if (!first) throw new Error('queue is empty');
  return first;
}

beforeEach(() => writeQueue(KEY, []));

describe('the retry schedule', () => {
  it('is the one the widget promises: 5m to a day', () => {
    expect(DEFAULT_RETRY_SCHEDULE_MS).toEqual([
      5 * 60_000,
      15 * 60_000,
      30 * 60_000,
      60 * 60_000,
      2 * 60 * 60_000,
      5 * 60 * 60_000,
      12 * 60 * 60_000,
      24 * 60 * 60_000,
    ]);
  });

  it('widens on every failure, then gives up rather than retrying forever', () => {
    enqueue(KEY, { kind: 'bug', text: 'Kept for later' }, SCHEDULE);
    const waits: number[] = [];

    for (let i = 0; i < SCHEDULE.length + 1; i += 1) {
      const before = Date.now();
      backOff(KEY, only().id, 'HTTP 503', SCHEDULE);
      const report = only();
      if (!report.gaveUp) waits.push(Math.round((report.nextAttemptAt - before) / 1000) * 1000);
    }

    // The first wait was booked by enqueue, so backOff supplies the rest.
    expect(waits).toEqual([2000, 4000]);
    expect(only().gaveUp).toBe(true);
    expect(only().attempts).toBe(SCHEDULE.length + 1);
  });

  it('keeps a report it has given up on, so nothing is silently dropped', () => {
    enqueue(KEY, { kind: 'bug', text: 'Never delivered' }, []);
    backOff(KEY, only().id, 'HTTP 503', []);

    expect(only().gaveUp).toBe(true);
    expect(only().text).toBe('Never delivered');
    expect(readQueue(KEY)).toHaveLength(1);
  });
});

describe('what is due', () => {
  it('holds a report back until its wait has passed', () => {
    enqueue(KEY, { kind: 'bug', text: 'Not yet' }, SCHEDULE);

    expect(dueReports(readQueue(KEY))).toHaveLength(0);
    expect(dueReports(readQueue(KEY), Date.now() + 1500)).toHaveLength(1);
  });

  it('never offers one that has given up', () => {
    enqueue(KEY, { kind: 'bug', text: 'Done trying' }, []);
    backOff(KEY, only().id, 'HTTP 503', []);

    expect(dueReports(readQueue(KEY), Date.now() + 10 ** 9)).toHaveLength(0);
  });

  it('skips a report another tab has just claimed', () => {
    enqueue(KEY, { kind: 'bug', text: 'Mine' }, SCHEDULE);
    const later = Date.now() + 1500;

    expect(dueReports(readQueue(KEY), later)).toHaveLength(1);
    claim(KEY, only().id);
    expect(dueReports(readQueue(KEY), later)).toHaveLength(0);

    // A tab that died mid-request must not strand the report forever.
    expect(dueReports(readQueue(KEY), later + 61_000)).toHaveLength(1);
  });

  it('releases the claim when the attempt fails, so the next one can take it', () => {
    enqueue(KEY, { kind: 'bug', text: 'Retry me' }, SCHEDULE);
    claim(KEY, only().id);
    backOff(KEY, only().id, 'HTTP 503', SCHEDULE);

    expect(only().claimedAt).toBeUndefined();
  });
});

describe('editing what has not been sent', () => {
  it('changes the queued copy rather than a server row that does not exist', () => {
    enqueue(KEY, { kind: 'bug', text: 'Typo here' }, SCHEDULE);
    updateText(KEY, only().id, 'Fixed wording');

    expect(only().text).toBe('Fixed wording');
  });

  it('drops it entirely when withdrawn', () => {
    enqueue(KEY, { kind: 'bug', text: 'Never mind' }, SCHEDULE);
    remove(KEY, only().id);

    expect(readQueue(KEY)).toHaveLength(0);
  });

  it('puts a given-up report back at the front of the line on a manual retry', () => {
    enqueue(KEY, { kind: 'bug', text: 'Try again' }, []);
    backOff(KEY, only().id, 'HTTP 503', []);
    retryNow(KEY, only().id);

    expect(only().gaveUp).toBe(false);
    expect(dueReports(readQueue(KEY))).toHaveLength(1);
  });
});

describe('surviving a bad outbox', () => {
  it('reads junk as empty rather than crashing the widget on mount', () => {
    localStorage.setItem(KEY, 'not json at all');
    expect(readQueue(KEY)).toEqual([]);

    localStorage.setItem(KEY, JSON.stringify({ not: 'an array' }));
    expect(readQueue(KEY)).toEqual([]);
  });

  it('discards entries that are missing what a report needs', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([{ id: 'ok', kind: 'bug', text: 'fine', nextAttemptAt: 0 }, { id: 'bad' }]),
    );

    expect(readQueue(KEY).map((r) => r.id)).toEqual(['ok']);
  });

  it('keeps one app’s outbox out of another’s', () => {
    expect(queueKey('/api/feedback')).not.toBe(queueKey('/api/admin/feedback'));
  });
});

describe('what the reporter is told', () => {
  it('counts the wait down in the units a person would use', () => {
    const base: QueuedReport = {
      id: 'x',
      kind: 'bug',
      text: 't',
      createdAt: new Date().toISOString(),
      attempts: 1,
      nextAttemptAt: 0,
    };
    const now = Date.now();

    expect(describeWait({ ...base, nextAttemptAt: now + 30 * 60_000 }, now)).toBe(
      'retrying in 30m',
    );
    expect(describeWait({ ...base, nextAttemptAt: now + 2 * 60 * 60_000 }, now)).toBe(
      'retrying in 2h',
    );
    expect(describeWait({ ...base, nextAttemptAt: now + 24 * 60 * 60_000 }, now)).toBe(
      'retrying in 1d',
    );
    expect(describeWait({ ...base, gaveUp: true }, now)).toBe('not sent');
  });

  it('says one minute, not one minutes', () => {
    const report: QueuedReport = {
      id: 'x',
      kind: 'bug',
      text: 't',
      createdAt: new Date().toISOString(),
      attempts: 1,
      nextAttemptAt: Date.now() + 40_000,
    };

    expect(describeStatus(report, SCHEDULE)).toContain('about 1 minute,');
  });

  it('spells out attempts, the next try and the last error', () => {
    enqueue(KEY, { kind: 'bug', text: 'Detail' }, SCHEDULE);
    backOff(KEY, only().id, 'HTTP 503', SCHEDULE);
    const detail = describeStatus(only(), SCHEDULE);

    expect(detail).toContain('2 of 4 attempts made');
    expect(detail).toContain('HTTP 503');
    expect(detail).toContain('not yet sent');
  });

  it('tells somebody how to act on one it has given up on', () => {
    enqueue(KEY, { kind: 'bug', text: 'Stuck' }, []);
    backOff(KEY, only().id, 'HTTP 503', []);

    expect(describeStatus(only(), [])).toContain('Retry');
  });
});
