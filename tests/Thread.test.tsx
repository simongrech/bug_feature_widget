import { render, screen, waitFor, within } from '@testing-library/react';
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

/** `count` of them, an hour apart, oldest first — the order the hub returns. */
function conversation(count: number): FeedbackMessage[] {
  return Array.from({ length: count }, (_, i) =>
    message({
      id: `m${i + 1}`,
      body: `Reply ${i + 1}`,
      createdAt: new Date(Date.UTC(2026, 0, 15, i)).toISOString(),
    }),
  );
}

const noop = () => {};

describe('Thread', () => {
  it('shows the last three replies without being asked', async () => {
    // An answer nobody opens is an answer nobody read: the panel gave no sign
    // that a reply had arrived until somebody clicked into every report.
    vi.stubGlobal('fetch', vi.fn(async () => json(conversation(5))));

    render(<Thread itemId="1" apiBase="/api/feedback" count={5} onCountChange={noop} />);

    expect(await screen.findByText('Reply 5')).toBeInTheDocument();
    expect(screen.getByText('Reply 4')).toBeInTheDocument();
    expect(screen.getByText('Reply 3')).toBeInTheDocument();
    expect(screen.queryByText('Reply 2')).not.toBeInTheDocument();
    expect(screen.queryByText('Reply 1')).not.toBeInTheDocument();
  });

  it('reads newest first, so the reply being waited for is the top one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(conversation(3))));

    render(<Thread itemId="1" apiBase="/api/feedback" count={3} onCountChange={noop} />);

    await screen.findByText('Reply 3');
    const bodies = screen
      .getAllByText(/^Reply \d$/)
      .map((el) => el.textContent);
    expect(bodies).toEqual(['Reply 3', 'Reply 2', 'Reply 1']);
  });

  it('loads more of the conversation on demand, and folds it back', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(conversation(9))));
    const user = userEvent.setup();

    render(<Thread itemId="1" apiBase="/api/feedback" count={9} onCountChange={noop} />);
    await screen.findByText('Reply 9');

    await user.click(screen.getByRole('button', { name: /show 6 more replies/i }));
    expect(screen.getByText('Reply 2')).toBeInTheDocument();
    expect(screen.queryByText('Reply 1')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show 1 more reply/i }));
    expect(screen.getByText('Reply 1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show fewer/i }));
    expect(screen.queryByText('Reply 6')).not.toBeInTheDocument();
    expect(screen.getByText('Reply 9')).toBeInTheDocument();
  });

  it('does not fetch a conversation the list says is empty', async () => {
    // Most reports have no replies; loading every thread with the list would
    // slow the common case down for the sake of the rare one.
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => json([]));
    vi.stubGlobal('fetch', fetchMock);

    render(<Thread itemId="abc" apiBase="/api/feedback" count={0} onCountChange={noop} />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not fetch while the panel holding it is shut', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => json(conversation(2)));
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(
      <Thread itemId="abc" apiBase="/api/feedback" count={2} active={false} onCountChange={noop} />,
    );
    expect(fetchMock).not.toHaveBeenCalled();

    rerender(
      <Thread itemId="abc" apiBase="/api/feedback" count={2} active onCountChange={noop} />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/feedback/items/abc/messages');
  });

  it('looks anyway when the hub did not say how many replies there are', async () => {
    // `undefined` is "unknown", not "none" — a hub that does not report a
    // count would otherwise hide every conversation it has.
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => json(conversation(1)));
    vi.stubGlobal('fetch', fetchMock);

    render(<Thread itemId="abc" apiBase="/api/feedback" onCountChange={noop} />);

    expect(await screen.findByText('Reply 1')).toBeInTheDocument();
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
            authorName: 'Simon Grech',
            mine: false,
            createdAt: '2026-01-15T13:00:00.000Z',
          }),
        ]),
      ),
    );

    render(<Thread itemId="1" apiBase="/api/feedback" count={2} onCountChange={noop} />);

    // The reporter's own message reads as theirs, not as their own name.
    expect(await screen.findByText('You')).toBeInTheDocument();
    expect(screen.getByText('Simon Grech')).toBeInTheDocument();
    expect(screen.getByText('Fixed in this morning’s deploy.')).toBeInTheDocument();
  });

  it('puts a bubble on each reply so the sides are told apart at a glance', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json([
          message({ id: 'a', body: 'Any progress?', authorName: 'Ada Lovelace', mine: true }),
          message({
            id: 'b',
            body: 'Shipping today.',
            authorKind: 'staff',
            authorName: 'Simon Grech',
            mine: false,
            createdAt: '2026-01-15T13:00:00.000Z',
          }),
        ]),
      ),
    );

    const { container } = render(
      <Thread itemId="1" apiBase="/api/feedback" count={2} onCountChange={noop} />,
    );
    await screen.findByText('Shipping today.');

    const [staff, reporter] = Array.from(container.querySelectorAll('.mtfw-message'));
    expect(within(staff as HTMLElement).getByTitle('Simon Grech')).toHaveTextContent('SG');
    expect(within(reporter as HTMLElement).getByTitle('You')).toHaveTextContent('AL');
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
    // And it joins the conversation on the spot, at the top of it.
    expect(await screen.findByText('Thanks!')).toBeInTheDocument();
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
