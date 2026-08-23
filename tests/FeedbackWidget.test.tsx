import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FeedbackWidget } from '../src/FeedbackWidget';
import { actor, item } from './fixtures';
import type { FeedbackItem } from '../src/types';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubApi(options?: {
  config?: unknown;
  items?: FeedbackItem[];
  post?: (body: unknown) => Response;
  patch?: (id: string, body: unknown) => Response;
  del?: (id: string) => Response;
}) {
  const items = options?.items ?? [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.endsWith('/config')) {
      return json(options?.config ?? { site: { name: 'Acme', slug: 'acme' }, mode: 'both' });
    }

    if (method === 'GET' && url.includes('/items')) {
      return json(items);
    }

    if (method === 'POST' && url.endsWith('/items')) {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (options?.post) return options.post(body);
      return json(item({ id: 'new', text: body.text, kind: body.kind }));
    }

    const itemMatch = url.match(/\/items\/([^/?]+)$/);
    if (itemMatch) {
      const id = itemMatch[1]!;
      if (method === 'PATCH') {
        const body = JSON.parse(String(init?.body ?? '{}'));
        if (options?.patch) return options.patch(id, body);
        return json({ ...items.find((row) => row.id === id), text: body.text });
      }
      if (method === 'DELETE') {
        if (options?.del) return options.del(id);
        return new Response(null, { status: 204 });
      }
    }

    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function openWidget(ui: ReactElement) {
  const user = userEvent.setup();
  const view = render(ui);
  await user.click(await view.findByRole('button', { name: /open bugs/i }));
  return { user, ...view };
}


describe('FeedbackWidget', () => {
  it('renders nothing without an actor', () => {
    stubApi();
    const { container } = render(<FeedbackWidget actor={null} mode="both" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('stays hidden until the hub config arrives', async () => {
    let release!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );

    const { container } = render(<FeedbackWidget actor={actor} />);
    expect(container).toBeEmptyDOMElement();

    release!(json({ site: { name: 'Acme', slug: 'acme' }, mode: 'both' }));
    expect(await screen.findByRole('button', { name: /open bugs/i })).toBeInTheDocument();
  });

  it('stays hidden when config cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    const { container } = render(<FeedbackWidget actor={actor} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('skips the config request when mode is passed in', async () => {
    const fetchMock = stubApi();
    render(<FeedbackWidget actor={actor} mode="bugs" />);
    expect(await screen.findByRole('button', { name: /open bugs/i })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/config'))).toBe(false);
  });

  it('asks the proxy at apiBase for config and items', async () => {
    const fetchMock = stubApi();
    render(<FeedbackWidget actor={actor} apiBase="/custom/feedback" />);
    await screen.findByRole('button', { name: /open bugs/i });
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toContain('/custom/feedback/config');
    expect(urls).toContain('/custom/feedback/items');
  });

  it('paints a split button in both-mode and a solid one when collecting a single kind', () => {
    stubApi();
    const both = render(<FeedbackWidget actor={actor} mode="both" />);
    expect(both.container.querySelector('.mtfw-split')).toBeTruthy();
    both.unmount();

    const bugs = render(<FeedbackWidget actor={actor} mode="bugs" />);
    const bugStyle = bugs.getByRole('button', { name: /open bugs/i }).getAttribute('style') ?? '';
    expect(bugStyle).toMatch(/#ef4444|rgb\(239,\s*68,\s*68\)/);
    bugs.unmount();

    const features = render(<FeedbackWidget actor={actor} mode="features" />);
    const featureStyle =
      features.getByRole('button', { name: /open bugs/i }).getAttribute('style') ?? '';
    expect(featureStyle).toMatch(/#f59e0b|rgb\(245,\s*158,\s*11\)/);
  });

  it('stamps a locked theme on the root', () => {
    stubApi();
    const { container } = render(
      <FeedbackWidget actor={actor} mode="both" theme="dark" position="bottom-left" />,
    );
    const root = container.firstElementChild;
    expect(root).toHaveAttribute('data-mtfw-theme', 'dark');
    expect(root?.className).toMatch(/bottom-left/);
  });

  it('opens and closes the panel from the floating button', async () => {
    stubApi();
    const { user } = await openWidget(<FeedbackWidget actor={actor} mode="both" />);
    const panel = screen.getByRole('dialog');
    expect(panel.className).toMatch(/open/);
    await user.click(screen.getByRole('button', { name: /close feedback panel/i }));
    expect(panel.className).not.toMatch(/open/);
  });

  it('closes when clicking outside the panel', async () => {
    stubApi();
    await openWidget(<FeedbackWidget actor={actor} mode="both" />);
    const panel = screen.getByRole('dialog');
    expect(panel.className).toMatch(/open/);
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await waitFor(() => expect(panel.className).not.toMatch(/open/));
  });

  it('hides the features tab in bugs-only mode, and the other way around', async () => {
    stubApi();
    const bugs = await openWidget(<FeedbackWidget actor={actor} mode="bugs" />);
    expect(bugs.queryByRole('button', { name: /features/i })).not.toBeInTheDocument();
    expect(bugs.getByRole('button', { name: /bugs/i })).toBeInTheDocument();
    bugs.unmount();

    const features = await openWidget(<FeedbackWidget actor={actor} mode="features" />);
    expect(features.queryByRole('button', { name: /^bugs$/i })).not.toBeInTheDocument();
    expect(await features.findByRole('button', { name: /add feature request/i })).toBeInTheDocument();
  });

  it('lists open items, hides archived ones, and shows a count on the tab', async () => {
    stubApi({
      items: [
        item({ id: '1', text: 'Open bug', completed: false, rejected: false }),
        item({ id: '2', text: 'Done bug', completed: true }),
        item({ id: '3', kind: 'feature', text: 'Open feature' }),
      ],
    });
    await openWidget(<FeedbackWidget actor={actor} mode="both" />);

    const list = screen.getByRole('list');
    expect(within(list).getByText('Open bug')).toBeInTheDocument();
    expect(within(list).queryByText('Done bug')).not.toBeInTheDocument();
    expect(screen.getByText(/archived \(1\)/i)).toBeInTheDocument();
  });

  it('switches to the archived list when asked', async () => {
    stubApi({
      items: [item({ id: '1', text: 'Open bug' }), item({ id: '2', text: 'Done bug', completed: true })],
    });
    const { user } = await openWidget(<FeedbackWidget actor={actor} mode="bugs" />);
    await user.click(screen.getByRole('button', { name: /archived/i }));
    expect(screen.getByText('Done bug')).toBeInTheDocument();
    expect(screen.queryByText('Open bug')).not.toBeInTheDocument();
  });

  it('sorts open items by date descending by default, then by criticality', async () => {
    stubApi({
      items: [
        item({
          id: 'old-high',
          text: 'old high',
          createdAt: '2026-01-01T00:00:00.000Z',
          criticality: 'high',
        }),
        item({
          id: 'new-low',
          text: 'new low',
          createdAt: '2026-06-01T00:00:00.000Z',
          criticality: 'low',
        }),
        item({
          id: 'mid-critical',
          text: 'mid critical',
          createdAt: '2026-03-01T00:00:00.000Z',
          criticality: 'critical',
        }),
      ],
    });
    const { user } = await openWidget(<FeedbackWidget actor={actor} mode="bugs" />);

    const texts = () => [...screen.getAllByRole('listitem')].map((li) => li.textContent ?? '');

    expect(texts()[0]).toContain('new low');
    expect(texts()[1]).toContain('mid critical');
    expect(texts()[2]).toContain('old high');

    await user.selectOptions(screen.getByLabelText(/sort/i), 'level');
    expect(texts()[0]).toMatch(/low|critical|high/);
  });

  it('submits a report and prepends the created item', async () => {
    const fetchMock = stubApi();
    const { user } = await openWidget(<FeedbackWidget actor={actor} mode="bugs" />);

    await user.type(screen.getByPlaceholderText(/describe a bug/i), '  New crash  ');
    await user.click(screen.getByRole('button', { name: /add bug/i }));

    await waitFor(() => expect(screen.getByText('New crash')).toBeInTheDocument());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(String(post?.[0])).toMatch(/\/items$/);
    expect(post?.[1]?.body).toBe(JSON.stringify({ kind: 'bug', text: 'New crash' }));
    expect(screen.getByPlaceholderText(/describe a bug/i)).toHaveValue('');
  });

  it('keeps the draft and explains a failed submit that will not succeed later', async () => {
    stubApi({
      post: () => json({ error: 'nope' }, 422),
    });
    const { user } = await openWidget(<FeedbackWidget actor={actor} mode="bugs" />);
    const box = screen.getByPlaceholderText(/describe a bug/i);
    await user.type(box, 'Will retry');
    await user.click(screen.getByRole('button', { name: /add bug/i }));
    expect(await screen.findByText(/could not send that/i)).toBeInTheDocument();
    expect(box).toHaveValue('Will retry');
  });

  it('keeps a report the hub could not take, and says so without alarming anybody', async () => {
    stubApi({ post: () => json({ error: 'down' }, 503) });
    const { user } = await openWidget(<FeedbackWidget actor={actor} mode="bugs" />);
    const box = screen.getByPlaceholderText(/describe a bug/i);
    await user.type(box, 'Hub was down when I filed this');
    await user.click(screen.getByRole('button', { name: /add bug/i }));

    // The box clears because the report is safe, not because it was sent.
    expect(await screen.findByText(/saved/i)).toBeInTheDocument();
    expect(box).toHaveValue('');

    // And it is in the list straight away, labelled, so nobody files it twice.
    expect(screen.getByText('Hub was down when I filed this')).toBeInTheDocument();
    expect(screen.getByText(/retrying in/i)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('mtfw:queue:/api/feedback') ?? '[]')).toHaveLength(1);
  });

  it('marks a delivered report as sent', async () => {
    stubApi({ items: [item({ id: 'srv', text: 'Already delivered' })] });
    await openWidget(<FeedbackWidget actor={actor} mode="bugs" />);

    expect(await screen.findByText('Already delivered')).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
  });

  it('delivers what it kept once the hub answers again', async () => {
    let down = true;
    stubApi({ post: () => (down ? json({ error: 'down' }, 503) : json(item({ id: 'srv', text: 'Filed during the outage' }))) });

    const { user } = await openWidget(
      <FeedbackWidget actor={actor} mode="bugs" retryScheduleMs={[0]} />,
    );
    await user.type(screen.getByPlaceholderText(/describe a bug/i), 'Filed during the outage');
    await user.click(screen.getByRole('button', { name: /add bug/i }));
    await screen.findByText(/retrying in|sending/i);

    down = false;
    // Coming back to the tab is one of the triggers for a delivery attempt.
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(screen.getByText('Sent')).toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem('mtfw:queue:/api/feedback') ?? '[]')).toHaveLength(0);
  });

  it('offers a retry once the schedule has run out, and keeps the report meanwhile', async () => {
    stubApi({ post: () => json({ error: 'down' }, 503) });
    const { user } = await openWidget(
      <FeedbackWidget actor={actor} mode="bugs" retryScheduleMs={[]} />,
    );
    await user.type(screen.getByPlaceholderText(/describe a bug/i), 'Nothing got through');
    await user.click(screen.getByRole('button', { name: /add bug/i }));

    document.dispatchEvent(new Event('visibilitychange'));

    expect(await screen.findByText(/not sent/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByText('Nothing got through')).toBeInTheDocument();
  });

  it('does not queue a rejection that would fail the same way tomorrow', async () => {
    stubApi({ post: () => json({ error: 'this site does not collect bugs' }, 422) });
    const { user } = await openWidget(<FeedbackWidget actor={actor} mode="bugs" />);
    await user.type(screen.getByPlaceholderText(/describe a bug/i), 'Wrong kind');
    await user.click(screen.getByRole('button', { name: /add bug/i }));

    expect(await screen.findByText(/could not send that/i)).toBeInTheDocument();
    expect(localStorage.getItem('mtfw:queue:/api/feedback')).toBeNull();
  });

  it('leaves the submit button disabled while the draft is empty', async () => {
    stubApi();
    await openWidget(<FeedbackWidget actor={actor} mode="bugs" />);
    expect(screen.getByRole('button', { name: /add bug/i })).toBeDisabled();
  });

  it('deletes an open item that belongs to the reporter', async () => {
    const fetchMock = stubApi({
      items: [item({ id: '1', text: 'Mine to delete' })],
    });
    const { user } = await openWidget(<FeedbackWidget actor={actor} mode="bugs" />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Mine to delete')).not.toBeInTheDocument());
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url).includes('/items/1') && init?.method === 'DELETE',
      ),
    ).toBe(true);
  });
});
