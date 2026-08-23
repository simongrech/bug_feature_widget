import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type { FeedbackItem } from '../src/types';

const PREFIX = '/api/feedback';

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
  let nextId = 100;

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
