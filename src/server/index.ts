/**
 * The server half of the widget.
 *
 * The widget in the browser only ever talks to its own origin. This forwards
 * those calls to the hub with the API key attached, which is the whole reason
 * it exists: a key in the browser is a key anyone can read out of the network
 * tab and use to write into your hub. It also means there is no CORS anywhere,
 * and no way for a caller to claim to be a different reporter — the identity
 * is stamped here, from whatever the host site's own session says.
 *
 * Nothing in this module imports React. It is a server module, and tagging it
 * `use client` would ship the key to the browser.
 */

export interface FeedbackProxyActor {
  userId: string;
  userName?: string;
  userEmail?: string;
}

export interface FeedbackProxyOptions {
  /** Origin of the hub, e.g. `https://admin.example.com`. No trailing path. */
  hubUrl?: string;
  /** The site's API key, minted in the hub. Server-only — never `NEXT_PUBLIC_`. */
  apiKey?: string;
  /** Who is reporting, from the host site's own session. */
  actor: (req: Request) => Promise<FeedbackProxyActor | null> | FeedbackProxyActor | null;
  /**
   * Where the proxy is mounted, e.g. `/api/admin/feedback`. Only needed when
   * the route's catch-all params are not passed through to the handler.
   */
  basePath?: string;
  /** Default 10s. A hub that is down must not hang the host site's request. */
  timeoutMs?: number;
}

export type FeedbackRouteContext = {
  params?: { path?: string[] } | Promise<{ path?: string[] } | undefined>;
};

export type FeedbackProxyHandler = (
  req: Request,
  ctx?: FeedbackRouteContext,
) => Promise<Response>;

const HUB_PREFIX = '/api/feedback/v1';
const MAX_BODY_BYTES = 16 * 1024;

/** Statuses the fetch spec forbids a body on. */
const NULL_BODY_STATUS = new Set([204, 205, 304]);

/** Only these reach the hub. Everything else in the body is dropped. */
const WRITABLE_FIELDS = ['kind', 'text', 'severity', 'body'] as const;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

async function resolvePath(req: Request, ctx?: FeedbackRouteContext, basePath?: string) {
  const params = await ctx?.params;
  if (params?.path?.length) return params.path;

  // No catch-all params — work it out from the URL instead, so the proxy also
  // works from a framework that does not supply them.
  const { pathname } = new URL(req.url);
  const rest = basePath && pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname;
  return rest.split('/').filter(Boolean);
}

/** An id has to look like one before it is pasted into a URL. */
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Decides whether a request is one the hub answers, and what to forward. An
 * allow-list rather than a pass-through: the proxy holds a key with write
 * access, so anything it does not recognise is a 404, not a punt.
 */
function route(method: string, segments: string[]): string | null {
  const [head, id, tail, ...extra] = segments;
  if (extra.length > 0) return null;

  if (head === 'config') {
    return id === undefined && method === 'GET' ? 'config' : null;
  }

  if (head !== 'items') return null;

  if (id === undefined) {
    return method === 'GET' || method === 'POST' ? 'items' : null;
  }
  if (!ID.test(id)) return null;

  if (tail === undefined) {
    return method === 'PATCH' || method === 'DELETE' ? `items/${id}` : null;
  }

  // The conversation on one report.
  if (tail === 'messages') {
    return method === 'GET' || method === 'POST' ? `items/${id}/messages` : null;
  }

  return null;
}

export function createFeedbackProxy(options: FeedbackProxyOptions): FeedbackProxyHandler {
  const { hubUrl, apiKey, actor, basePath, timeoutMs = 10_000 } = options;

  return async function feedbackProxy(req, ctx) {
    // An install that has not been given a hub is inert rather than broken:
    // the widget hides itself when config fails, and nothing else notices.
    if (!hubUrl || !apiKey) {
      return json({ error: 'Feedback hub is not configured' }, 503);
    }

    const who = await actor(req);
    if (!who?.userId) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const segments = await resolvePath(req, ctx, basePath);
    const target = route(req.method, segments);
    if (!target) {
      return json({ error: 'Not found' }, 404);
    }

    let body: string | undefined;
    if (req.method === 'POST' || req.method === 'PATCH') {
      const raw = await req.text();
      if (raw.length > MAX_BODY_BYTES) {
        return json({ error: 'Payload too large' }, 413);
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        return json({ error: 'Invalid JSON' }, 400);
      }
      const clean: Record<string, unknown> = {};
      for (const field of WRITABLE_FIELDS) {
        if (field in parsed) clean[field] = parsed[field];
      }
      body = JSON.stringify(clean);
    }

    const search = new URL(req.url).searchParams;
    const kind = search.get('kind');
    const query = kind === 'bug' || kind === 'feature' ? `?kind=${kind}` : '';

    // AbortController rather than AbortSignal.timeout, which is missing from
    // some of the runtimes this package is expected to work on.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const upstream = await fetch(`${hubUrl}${HUB_PREFIX}/${target}${query}`, {
        method: req.method,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          // encodeURIComponent keeps these header-safe whatever the display
          // name contains; the hub decodes them the same way.
          'x-feedback-user-id': encodeURIComponent(who.userId),
          ...(who.userName ? { 'x-feedback-user-name': encodeURIComponent(who.userName) } : {}),
          ...(who.userEmail ? { 'x-feedback-user-email': encodeURIComponent(who.userEmail) } : {}),
        },
        body,
        cache: 'no-store',
        signal: controller.signal,
      });

      // 204/205/304 may not carry a body. Passing the empty string through
      // makes the Response constructor throw, which the catch below would
      // then report as an unreachable hub — after a DELETE that in fact
      // succeeded. That is the shape of a "failed" delete that deletes.
      if (NULL_BODY_STATUS.has(upstream.status)) {
        return new Response(null, {
          status: upstream.status,
          headers: { 'cache-control': 'no-store' },
        });
      }

      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: {
          'content-type': upstream.headers.get('content-type') ?? 'application/json',
          'cache-control': 'no-store',
        },
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      return json({ error: aborted ? 'Feedback hub timed out' : 'Feedback hub unreachable' }, aborted ? 504 : 502);
    } finally {
      clearTimeout(timer);
    }
  };
}
