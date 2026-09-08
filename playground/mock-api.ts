import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type { FeedbackItem, FeedbackMessage } from '../src/types';

const PREFIX = '/api/feedback';

/**
 * Threads, keyed by report. Oldest first, as the hub returns them — the widget
 * is the thing that decides to read them newest first, and it can only be
 * trusted to if the mock hands them over in the hub's order.
 */
function seedMessages(): Record<string, FeedbackMessage[]> {
  const now = Date.now();
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60 * 1000).toISOString();
  return {
    '1': [
      {
        id: 'm1',
        body: 'Any progress on this? It happens every time the network drops.',
        createdAt: at(180),
        authorKind: 'reporter',
        authorName: 'Ada Lovelace',
        mine: true,
      },
      {
        id: 'm2',
        body: 'Reproduced it here — the button never re-enables after a 500.',
        createdAt: at(150),
        authorKind: 'staff',
        authorName: 'Simon Grech',
        mine: false,
      },
      {
        id: 'm3',
        body: 'Thanks. Is there a workaround in the meantime?',
        createdAt: at(120),
        authorKind: 'reporter',
        authorName: 'Ada Lovelace',
        mine: true,
      },
      {
        id: 'm4',
        body: 'Reloading the page clears it for now.',
        createdAt: at(90),
        authorKind: 'staff',
        authorName: 'Simon Grech',
        mine: false,
      },
      {
        id: 'm5',
        body: 'Fix is in review, should ship this week.',
        createdAt: at(20),
        authorKind: 'staff',
        authorName: 'Simon Grech',
        mine: false,
      },
    ],
    '3': [
      {
        id: 'm6',
        body: 'Queued behind the theming work — still on the list.',
        createdAt: at(60),
        authorKind: 'staff',
        authorName: 'Support',
        mine: false,
      },
    ],
  };
}

function seed(): FeedbackItem[] {
  const now = Date.now();
  return [
    {
      id: '1',
      kind: 'bug',
      text: 'The submit button stays disabled after the first failed request.',
      createdAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      completed: false,
      approved: false,
      rejected: false,
      criticality: 'high',
      mine: true,
      reporterName: 'Ada Lovelace',
      messageCount: 5,
    },
    {
      id: '2',
      kind: 'bug',
      text: 'Dark theme flashes white on first paint in Safari.',
      createdAt: new Date(now - 26 * 60 * 60 * 1000).toISOString(),
      completed: true,
      approved: true,
      rejected: false,
      criticality: 'medium',
      mine: true,
      reporterName: 'Ada Lovelace',
    },
    {
      id: '3',
      kind: 'feature',
      text: 'Let the host pass a custom label for the floating button.',
      createdAt: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
      completed: false,
      approved: true,
      rejected: false,
      priority: 'medium',
      mine: true,
      reporterName: 'Ada Lovelace',
      messageCount: 1,
    },
    {
      id: '4',
      kind: 'feature',
      text: 'Export reports as CSV from the widget.',
      createdAt: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
      completed: false,
      approved: false,
      rejected: true,
      priority: 'low',
      mine: true,
      reporterName: 'Ada Lovelace',
    },
  ];
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.statusCode = status;
  if (body === undefined) {
    res.end();
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * In-memory stand-in for the hub, so the playground can submit, edit and
 * delete without a running backend.
 */
export function mockFeedbackApi(): Plugin {
  let items = seed();
  const threads = seedMessages();
  let nextId = 100;
  let nextMessageId = 500;

  return {
    name: 'mock-feedback-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const raw = req.url ?? '';
        const url = new URL(raw, 'http://playground.local');
        if (!url.pathname.startsWith(PREFIX)) {
          next();
          return;
        }

        const path = url.pathname.slice(PREFIX.length) || '/';
        const method = req.method ?? 'GET';

        try {
          if (method === 'GET' && path === '/config') {
            send(res, 200, {
              site: { name: 'Playground', slug: 'playground' },
              mode: 'both',
            });
            return;
          }

          if (method === 'GET' && path === '/items') {
            const kind = url.searchParams.get('kind');
            const rows = kind ? items.filter((i) => i.kind === kind) : items;
            send(res, 200, rows);
            return;
          }

          if (method === 'POST' && path === '/items') {
            const body = JSON.parse(await readBody(req)) as { kind?: string; text?: string };
            if (body.kind !== 'bug' && body.kind !== 'feature') {
              send(res, 422, { error: 'invalid kind' });
              return;
            }
            const text = typeof body.text === 'string' ? body.text.trim() : '';
            if (!text) {
              send(res, 422, { error: 'text required' });
              return;
            }
            const created: FeedbackItem = {
              id: String(nextId++),
              kind: body.kind,
              text,
              createdAt: new Date().toISOString(),
              completed: false,
              approved: false,
              rejected: false,
              mine: true,
              reporterName: 'Ada Lovelace',
            };
            items = [created, ...items];
            send(res, 200, created);
            return;
          }

          const messagesMatch = path.match(/^\/items\/([^/]+)\/messages$/);
          if (messagesMatch) {
            const id = messagesMatch[1]!;
            if (!items.some((i) => i.id === id)) {
              send(res, 404, { error: 'not found' });
              return;
            }

            if (method === 'GET') {
              send(res, 200, threads[id] ?? []);
              return;
            }

            if (method === 'POST') {
              const body = JSON.parse(await readBody(req)) as { body?: string };
              const text = typeof body.body === 'string' ? body.body.trim() : '';
              if (!text) {
                send(res, 422, { error: 'body required' });
                return;
              }
              const created: FeedbackMessage = {
                id: String(nextMessageId++),
                body: text,
                createdAt: new Date().toISOString(),
                authorKind: 'reporter',
                authorName: 'Ada Lovelace',
                mine: true,
              };
              threads[id] = [...(threads[id] ?? []), created];
              items = items.map((i) =>
                i.id === id ? { ...i, messageCount: threads[id]!.length } : i,
              );
              send(res, 201, created);
              return;
            }
          }

          const itemMatch = path.match(/^\/items\/([^/]+)$/);
          if (itemMatch) {
            const id = itemMatch[1];
            const index = items.findIndex((i) => i.id === id);
            if (index < 0) {
              send(res, 404, { error: 'not found' });
              return;
            }
            const current = items[index]!;

            if (method === 'PATCH') {
              if (!current.mine || current.completed || current.rejected) {
                send(res, 403, { error: 'not editable' });
                return;
              }
              const body = JSON.parse(await readBody(req)) as { text?: string };
              const text = typeof body.text === 'string' ? body.text.trim() : '';
              if (!text) {
                send(res, 422, { error: 'text required' });
                return;
              }
              const updated = { ...current, text };
              items = items.map((i) => (i.id === id ? updated : i));
              send(res, 200, updated);
              return;
            }

            if (method === 'DELETE') {
              if (!current.mine || current.completed || current.rejected) {
                send(res, 403, { error: 'not deletable' });
                return;
              }
              items = items.filter((i) => i.id !== id);
              send(res, 204);
              return;
            }
          }

          send(res, 404, { error: 'not found' });
        } catch {
          send(res, 500, { error: 'mock api failed' });
        }
      });
    },
  };
}
