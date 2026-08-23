import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Thread } from '../src/Thread';
import type { FeedbackMessage } from '../src/types';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function message(overrides: Partial<FeedbackMessage> = {}): FeedbackMessage {
  return {
    id: 'm1',
    body: 'Any progress on this?',
    createdAt: '2026-01-15T12:00:00.000Z',
    authorKind: 'reporter',
    authorName: 'Ada Lovelace',
    mine: true,
    ...overrides,
  };
}

const noop = () => {};

describe('Thread', () => {
  it('labels the toggle by how many replies there are', () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([])));
    const { rerender } = render(
      <Thread itemId="1" apiBase="/api/feedback" count={0} onCountChange={noop} />,
    );
    expect(screen.getByRole('button', { name: /^reply/i })).toBeInTheDocument();

    rerender(<Thread itemId="1" apiBase="/api/feedback" count={1} onCountChange={noop} />);
    expect(screen.getByRole('button', { name: /1 reply/i })).toBeInTheDocument();

    rerender(<Thread itemId="1" apiBase="/api/feedback" count={4} onCountChange={noop} />);
    expect(screen.getByRole('button', { name: /4 replies/i })).toBeInTheDocument();
  });

  it('does not fetch the conversation until it is opened', async () => {
    // Most reports have no replies; loading every thread with the list would
    // slow the common case down for the sake of the rare one.
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => json([]));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<Thread itemId="abc" apiBase="/api/feedback" count={2} onCountChange={noop} />);
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /2 replies/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/feedback/items/abc/messages');
  });

  it('tells the two sides of the conversation apart', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json([
          message({ id: 'a', body: 'Any progress?', authorKind: 'reporter', mine: true }),
          message({
            id: 'b',
            body: 'Fixed in this morning’s deploy.',
            authorKind: 'staff',
            authorName: 'Simon',
            mine: false,
          }),
        ]),
      ),
    );
    const user = userEvent.setup();

    render(<Thread itemId="1" apiBase="/api/feedback" count={2} onCountChange={noop} />);
    await user.click(screen.getByRole('button', { name: /2 replies/i }));

    // The reporter's own message reads as theirs, not as their own name.
    expect(await screen.findByText('You')).toBeInTheDocument();
    expect(screen.getByText('Simon')).toBeInTheDocument();
    expect(screen.getByText('Fixed in this morning’s deploy.')).toBeInTheDocument();
  });

  it('posts a reply and counts it', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST' ? json(message({ id: 'new', body: 'Thanks!' }), 201) : json([]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onCountChange = vi.fn();
    const user = userEvent.setup();

    render(<Thread itemId="1" apiBase="/api/feedback" count={0} onCountChange={onCountChange} />);
    await user.click(screen.getByRole('button', { name: /^reply/i }));
    await user.type(await screen.findByPlaceholderText(/write a reply/i), 'Thanks!');
    await user.click(screen.getByRole('button', { name: /send reply/i }));

    await waitFor(() => expect(onCountChange).toHaveBeenCalledWith(1));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ body: 'Thanks!' });
  });

  it('says so when a reply will not send, rather than queueing it', async () => {
    // Unlike a report: a reply that turns up hours later, out of order, is
    // worse than one the sender knows did not go.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) =>
        init?.method === 'POST' ? json({ error: 'down' }, 503) : json([]),
      ),
    );
    const user = userEvent.setup();

    render(<Thread itemId="1" apiBase="/api/feedback" count={0} onCountChange={noop} />);
    await user.click(screen.getByRole('button', { name: /^reply/i }));
    await user.type(await screen.findByPlaceholderText(/write a reply/i), 'Hello?');
    await user.click(screen.getByRole('button', { name: /send reply/i }));

    expect(await screen.findByText(/could not send that reply \(503\)/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/write a reply/i)).toHaveValue('Hello?');
  });
});
