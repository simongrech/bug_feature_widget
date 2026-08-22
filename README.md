# @melatech/feedback-widget

A floating bug-report and feature-request widget that reports into a central hub, so
every project you run shares one inbox instead of standing up its own database.

- **Zero runtime dependencies.** No icon library, no CSS framework, no state library.
- **Self-contained styling.** One stylesheet, no Tailwind config to change.
- **Light and dark**, following the OS or driven by the host site at runtime.
- **The API key never reaches the browser.** The widget talks only to your own origin.

<br>

## How it fits together

```
 browser                    your app (server)              the hub
┌──────────────┐  same     ┌──────────────────┐  x-api-key ┌────────────────┐
│ FeedbackWidget├──origin──►│ createFeedback   ├───────────►│ client_admin   │
│              │  fetch    │ Proxy()          │  server to │ site           │
└──────────────┘           └──────────────────┘  server    └────────────────┘
```

The widget never learns the hub's address or its key. It calls a route in your own app;
that route runs on the server, attaches the key, and forwards. Three things fall out of
that: no CORS to configure, no key to leak, and no way for a caller to claim to be a
different reporter — the identity is stamped server-side from your own session.

<br>

## Install

```bash
npm install @melatech/feedback-widget
```

Peer dependencies: `react >=18`, `react-dom >=18`.

<br>

## Setup

### 1. Get an API key

In the hub, go to **Admin → Feedback → New site**, give it a name, and choose what it
collects: bugs only, feature requests only, or both. The key is shown once. Put it in
your app's environment:

```bash
FEEDBACK_HUB_URL=https://admin.example.com
FEEDBACK_API_KEY=fbk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

> **Never prefix these with `NEXT_PUBLIC_`.** That inlines them into the browser bundle,
> which hands your key to anyone who opens the network tab. They are read on the server
> only. Keeping them server-side also means changing a key is a restart, not a rebuild.

### 2. Mount the proxy route

One catch-all route in your app. Do your own auth check first — the proxy trusts whatever
actor you give it.

```ts
// app/api/feedback/[...path]/route.ts
import { createFeedbackProxy } from '@melatech/feedback-widget/server';
import { getSession } from '@/lib/auth';

const proxy = createFeedbackProxy({
  hubUrl: process.env.FEEDBACK_HUB_URL,
  apiKey: process.env.FEEDBACK_API_KEY,
  actor: async () => {
    const session = await getSession();
    if (!session.isLoggedIn) return null;
    return {
      userId: String(session.userId),
      userName: session.displayName,
      userEmail: session.email,
    };
  },
});

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
```

If your app gates routes by path prefix, mount it behind that prefix and point the widget
at the same place — see `apiBase` below.

### 3. Render the widget

```tsx
'use client';

import { FeedbackWidget } from '@melatech/feedback-widget';
import '@melatech/feedback-widget/styles.css';

export function Feedback({ user }) {
  return (
    <FeedbackWidget
      actor={{ userId: user.id, userName: user.name, userEmail: user.email }}
    />
  );
}
```

Mount it once, in a layout. It renders a fixed-position button and panel, so where in the
tree it sits does not matter — with one exception, noted under *Gotchas*.

<br>

## Props

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `actor` | `{ userId, userName?, userEmail? } \| null` | — | Who is reporting. `null` renders nothing — pass it while a session is still loading. |
| `apiBase` | `string` | `/api/feedback` | Where your proxy route is mounted. Always same-origin; never the hub's URL. |
| `mode` | `'bugs' \| 'features' \| 'both'` | from the hub | Overrides what the API key is configured for. Normally leave it unset so the hub stays the single source of truth. |
| `theme` | `'light' \| 'dark' \| 'system'` | `'system'` | See below. |
| `position` | `'bottom-right' \| 'bottom-left'` | `'bottom-right'` | |

The button changes with the mode: solid red for bugs only, solid amber for features only,
and split diagonally when it collects both.

<br>

## Theming

Three ways to drive it, for three different kinds of host site.

### Follow the operating system

The default. Nothing to do.

```tsx
<FeedbackWidget actor={actor} />
```

It reads `prefers-color-scheme` and keeps listening, so a visitor who switches their OS to
dark sees the widget follow without a reload.

### Lock it

For a site with one fixed look — a light-only admin, say — pin the widget and it will
ignore both the OS and any runtime updates.

```tsx
<FeedbackWidget actor={actor} theme="light" />
```

A locked theme is applied during render, so it is correct in server-rendered HTML too.

### Let the site drive it

For a site with its own theme toggle. The widget starts on the OS preference, then follows
whatever the site tells it for the rest of the session.

**If your theme state is in React**, pass it down. Changing the prop updates the widget on
the next render:

```tsx
'use client';
import { useTheme } from '@/lib/theme';        // your own provider
import { FeedbackWidget } from '@melatech/feedback-widget';

export function Feedback({ actor }) {
  const { theme } = useTheme();                // 'light' | 'dark' | 'system'
  return <FeedbackWidget actor={actor} theme={theme} />;
}
```

**If it is not** — the widget is mounted in a server layout, far from the toggle — call the
imperative setter from wherever the theme actually changes. No provider needed:

```tsx
import { setFeedbackWidgetTheme } from '@melatech/feedback-widget';

function onToggle(next: 'light' | 'dark') {
  document.documentElement.dataset.theme = next;   // your own switch
  setFeedbackWidgetTheme(next);                    // tell the widget
}

// Hand control back to the operating system:
setFeedbackWidgetTheme(null);
```

### Precedence

1. `theme="light"` or `theme="dark"` — locked, nothing overrides it.
2. Otherwise, the last `setFeedbackWidgetTheme()` value, if one has been set.
3. Otherwise, the operating system, live.

There is no flash while `system` resolves: until the component has read the OS preference,
the stylesheet answers with its own `prefers-color-scheme` rule, so the first paint is
already right and server and client markup agree.

<br>

## Restyling

Every colour is a CSS custom property on `.mtfw-root`. Override any of them:

```css
.mtfw-root {
  --mtfw-font: inherit;          /* use the host site's typeface */
  --mtfw-bug: #dc2626;           /* your own red */
  --mtfw-feature: #0ea5e9;
}
```

The main ones: `--mtfw-surface`, `--mtfw-surface-raised`, `--mtfw-surface-sunken`,
`--mtfw-border`, `--mtfw-border-strong`, `--mtfw-text`, `--mtfw-text-strong`,
`--mtfw-text-muted`, `--mtfw-text-faint`, `--mtfw-item-bg`, `--mtfw-hover-bg`,
`--mtfw-active-bg`, `--mtfw-bug`, `--mtfw-bug-hover`, `--mtfw-feature`,
`--mtfw-feature-hover`. Read `dist/styles.css` for the full list — it is commented.

Set them inside `.mtfw-root[data-mtfw-theme='dark']` to change only the dark theme.

<br>

## Gotchas

**A transformed ancestor breaks fixed positioning.** If any ancestor of the widget has a
`transform`, `filter`, `perspective` or `contain` set, CSS makes it the containing block
for `position: fixed`, and the widget will anchor to that element instead of the viewport.
Mount it high in the tree — a root or section layout — and this never comes up.

**The proxy must not be publicly reachable** unless you mean it to be. It holds a key with
write access to your hub. Put it behind whatever gates the rest of your app, and return
`null` from `actor` for anyone who should not be filing reports.

**`z-index` is 9998 for the button and 9997 for the panel.** High enough to clear most
things; if your app has something higher, that is the number to beat.

<br>

## What the widget can and cannot do

It collects reports and shows the reporter their own project's list: submit, browse open
items, browse archived ones, sort by date or severity, and edit or delete their own
entries while they are still open.

Triage lives in the hub. Approving, rejecting, marking done and setting criticality are
not things a reporting site can do — an API key is scoped to reporting, and an item stops
being editable once somebody in the hub has acted on it.

<br>

## HTTP contract

If you are writing a consumer that is not a Next.js app, this is what the widget expects
from `apiBase`, and what `createFeedbackProxy` forwards to `{hubUrl}/api/feedback/v1`.

| | | |
| --- | --- | --- |
| `GET` | `/config` | `{ site: { name, slug }, mode }` |
| `GET` | `/items` | `FeedbackItem[]` — both kinds; add `?kind=bug` to narrow |
| `POST` | `/items` | `{ kind, text }` → the created `FeedbackItem` |
| `PATCH` | `/items/{id}` | `{ text }` → the updated `FeedbackItem` |
| `DELETE` | `/items/{id}` | `204` |

```ts
interface FeedbackItem {
  id: string;
  kind: 'bug' | 'feature';
  text: string;
  createdAt: string;          // ISO 8601
  completed: boolean;
  approved: boolean;
  rejected: boolean;
  criticality?: 'low' | 'medium' | 'high' | 'critical' | null;
  priority?: 'low' | 'medium' | 'high' | null;
  reporterName?: string | null;
  reporterEmail?: string | null;
  mine: boolean;              // whether the current actor filed it
}
```

An item is archived once `completed || rejected`. There is no separate flag.

Requests to the hub carry `x-api-key` plus the reporter's identity in
`x-feedback-user-id`, `x-feedback-user-name` and `x-feedback-user-email`, each
`encodeURIComponent`-escaped so they are header-safe.

The hub answers `401` for a missing or revoked key, `403` for editing an item that is not
yours or has been triaged, `422` for a kind the site does not collect, and `429` when a
key is over its rate limit.

<br>

## Development

```bash
npm install
npm run typecheck
npm run build          # tsup → dist/, then postbuild applies "use client"
```

`src/index.ts` is the browser entry and carries `use client`; `src/server/index.ts` is the
proxy and imports no React. The postbuild step asserts both, because a missing directive
surfaces in someone else's app as a confusing hook error.

## Licence

MIT
