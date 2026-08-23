import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFeedbackProxy } from '../src/server';
import type { FeedbackProxyOptions } from '../src/server';

const HUB = 'https://hub.example.com';
const KEY = 'fbk_test';

function proxy(overrides: Partial<FeedbackProxyOptions> = {}) {
  return createFeedbackProxy({
    hubUrl: HUB,
    apiKey: KEY,
    actor: () => ({ userId: 'ada', userName: 'Ada Lovelace', userEmail: 'ada@example.com' }),
    ...overrides,
  });
}

function req(path: string, init?: RequestInit) {
  return new Request(`https://app.example.com${path}`, init);
}

function ctx(path: string[]) {
  return { params: { path } };
}

function stubHub(
  impl: (url: string, init?: RequestInit) => Response | Promise<Response> = () =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return impl(url, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createFeedbackProxy', () => {
  it('returns 503 when the hub is not configured', async () => {
    stubHub();
    const res = await createFeedbackProxy({
      actor: () => ({ userId: 'ada' }),
    })(req('/api/feedback/config'));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Feedback hub is not configured' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns 503 when the API key is missing', async () => {
    const res = await createFeedbackProxy({
      hubUrl: HUB,
      actor: () => ({ userId: 'ada' }),
    })(req('/api/feedback/config'));
    expect(res.status).toBe(503);
  });

  it('returns 401 when the actor is missing', async () => {
    stubHub();
    const res = await proxy({ actor: () => null })(req('/x'), ctx(['config']));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns 401 when the actor has no userId', async () => {
    stubHub();
    const res = await proxy({ actor: () => ({ userId: '' }) })(req('/x'), ctx(['config']));
    expect(res.status).toBe(401);
  });

  it('accepts a synchronous or asynchronous actor', async () => {
    stubHub();
    const sync = await proxy({ actor: () => ({ userId: 'ada' }) })(req('/x'), ctx(['config']));
    const asyncActor = await proxy({
      actor: async () => ({ userId: 'ada' }),
    })(req('/x'), ctx(['config']));
    expect(sync.status).toBe(200);
    expect(asyncActor.status).toBe(200);
  });

  it('forwards GET /config to the hub with the key and encoded identity', async () => {
    const fetchMock = stubHub(
      () =>
        new Response(JSON.stringify({ site: { name: 'Acme', slug: 'acme' }, mode: 'both' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    const res = await proxy()(req('/x'), ctx(['config']));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ site: { name: 'Acme', slug: 'acme' }, mode: 'both' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${HUB}/api/feedback/v1/config`);
    expect(init?.method).toBe('GET');
    expect(init?.cache).toBe('no-store');
    const headers = new Headers(init?.headers);
    expect(headers.get('x-api-key')).toBe(KEY);
    expect(headers.get('x-feedback-user-id')).toBe('ada');
    expect(headers.get('x-feedback-user-name')).toBe('Ada%20Lovelace');
    expect(headers.get('x-feedback-user-email')).toBe('ada%40example.com');
  });

  it('omits name and email headers when the actor does not supply them', async () => {
    const fetchMock = stubHub();
    await proxy({ actor: () => ({ userId: 'ada' }) })(req('/x'), ctx(['config']));
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.has('x-feedback-user-name')).toBe(false);
    expect(headers.has('x-feedback-user-email')).toBe(false);
  });

  it('encodes identity headers so they stay header-safe', async () => {
    const fetchMock = stubHub();
    await proxy({
      actor: () => ({ userId: 'id/1', userName: '日本', userEmail: 'a+b@example.com' }),
    })(req('/x'), ctx(['config']));
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('x-feedback-user-id')).toBe('id%2F1');
    expect(headers.get('x-feedback-user-name')).toBe('%E6%97%A5%E6%9C%AC');
    expect(headers.get('x-feedback-user-email')).toBe('a%2Bb%40example.com');
  });

  it('forwards GET /items and only a bug or feature kind query', async () => {
    const fetchMock = stubHub();

    await proxy()(req('/items?kind=bug'), ctx(['items']));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${HUB}/api/feedback/v1/items?kind=bug`);

    await proxy()(req('/items?kind=feature'), ctx(['items']));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${HUB}/api/feedback/v1/items?kind=feature`);

    await proxy()(req('/items?kind=both'), ctx(['items']));
    expect(fetchMock.mock.calls[2]?.[0]).toBe(`${HUB}/api/feedback/v1/items`);
  });

  it('strips everything but kind and text from write bodies', async () => {
    const fetchMock = stubHub();
    await proxy()(
      req('/items', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'bug',
          text: 'Broken',
          completed: true,
          userId: 'attacker',
          mine: true,
        }),
      }),
      ctx(['items']),
    );

    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ kind: 'bug', text: 'Broken' }));
  });

  it('forwards PATCH and DELETE for a well-formed item id', async () => {
    const fetchMock = stubHub();

    await proxy()(
      req('/items/abc-123_X', { method: 'PATCH', body: JSON.stringify({ text: 'Edited' }) }),
      ctx(['items', 'abc-123_X']),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${HUB}/api/feedback/v1/items/abc-123_X`);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PATCH');
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ text: 'Edited' }));

    await proxy()(req('/items/abc-123_X', { method: 'DELETE' }), ctx(['items', 'abc-123_X']));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${HUB}/api/feedback/v1/items/abc-123_X`);
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('DELETE');
  });

  it('returns 400 for invalid JSON on write', async () => {
    stubHub();
    const res = await proxy()(req('/items', { method: 'POST', body: '{' }), ctx(['items']));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns 413 when the write body is larger than 16KiB', async () => {
    stubHub();
    const res = await proxy()(
      req('/items', { method: 'POST', body: 'x'.repeat(16 * 1024 + 1) }),
      ctx(['items']),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'Payload too large' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns 404 for anything outside the allow-list', async () => {
    stubHub();
    const handler = proxy();
    const cases: Array<[Request, { params: { path: string[] } }]> = [
      [req('/x'), ctx(['nope'])],
      [req('/x'), ctx(['config', 'extra'])],
      [req('/x'), ctx(['items', 'id', 'extra'])],
      [req('/x', { method: 'PUT' }), ctx(['items'])],
      [req('/x'), ctx(['items', 'id'])],
      [req('/x', { method: 'POST' }), ctx(['items', 'id'])],
      [req('/x', { method: 'PATCH' }), ctx(['items', '../secret'])],
      [req('/x', { method: 'PATCH' }), ctx(['items', 'bad.id'])],
      [req('/x', { method: 'PATCH' }), ctx(['items', 'x'.repeat(65)])],
    ];

    for (const [request, route] of cases) {
      const res = await handler(request, route);
      expect(res.status, `${request.method} ${route.params.path.join('/')}`).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts a 64-character item id', async () => {
    const fetchMock = stubHub();
    const id = 'a'.repeat(64);
    const res = await proxy()(req('/x', { method: 'DELETE' }), ctx(['items', id]));
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${HUB}/api/feedback/v1/items/${id}`);
  });

  it('uses catch-all params when present, including a promised params object', async () => {
    const fetchMock = stubHub();
    await proxy()(req('/totally/different'), { params: Promise.resolve({ path: ['config'] }) });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${HUB}/api/feedback/v1/config`);
  });

  it('falls back to the URL when params are missing, if basePath is set', async () => {
    const fetchMock = stubHub();
    const res = await proxy({ basePath: '/api/admin/feedback' })(req('/api/admin/feedback/items'));
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${HUB}/api/feedback/v1/items`);
  });

  it('does not guess the mount point from the URL without basePath or params', async () => {
    stubHub();
    const res = await proxy()(req('/api/feedback/items'));
    expect(res.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes through the hub status, body and content-type', async () => {
    stubHub(
      () =>
        new Response('nope', {
          status: 429,
          headers: { 'content-type': 'text/plain' },
        }),
    );
    const res = await proxy()(req('/x'), ctx(['config']));
    expect(res.status).toBe(429);
    expect(res.headers.get('content-type')).toBe('text/plain');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('nope');
  });

  it('passes a 204 through instead of choking on its empty body', async () => {
    // Regression: the proxy used to rebuild every answer with `new Response(text, ...)`.
    // For a 204 that throws, the catch reported an unreachable hub, and a delete
    // that had already succeeded looked like a failure.
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await proxy()(
      new Request('https://app.example.com/api/feedback/items/abc', { method: 'DELETE' }),
      { params: { path: ['items', 'abc'] } },
    );

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('returns 504 when the hub times out', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }),
    );

    const pending = proxy({ timeoutMs: 1000 })(req('/x'), ctx(['config']));
    await vi.advanceTimersByTimeAsync(1000);
    const res = await pending;
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: 'Feedback hub timed out' });
  });

  it('returns 502 when the hub is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    );
    const res = await proxy()(req('/x'), ctx(['config']));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Feedback hub unreachable' });
  });
});
