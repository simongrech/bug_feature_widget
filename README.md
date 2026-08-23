# @melatech/feedback-widget

A floating bug-report and feature-request widget that reports into a central hub, so
every project you run shares one inbox instead of standing up its own database.

- **Zero runtime dependencies.** No icon library, no CSS framework, no state library.
- **Self-contained styling.** One stylesheet, no Tailwind config to change.
- **Light and dark**, following the OS or driven by the host site at runtime.
- **The API key never reaches the browser.** The widget talks only to your own origin.
- **A report survives an outage.** If the hub is down it is kept and retried, not lost.

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
| `retryScheduleMs` | `number[]` | 5m, 15m, 30m, 1h, 2h, 5h, 12h, 24h | Waits between delivery attempts when the hub is unreachable. See below. |

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

## Severity and replies

**The reporter sets the severity.** A select sits under the compose box — "Not sure" by
default, because a forced guess is worse data than none. One field on the wire; the hub
files it as criticality for a bug and priority for a feature, and refuses `critical` on a
feature because that scale stops at high. Staff can still change it afterwards.

**Every report carries a thread.** Collapsed behind a `Reply` / `3 replies` toggle and
loaded only when opened — most reports have none, and fetching every thread with the list
would slow the common case for the sake of the rare one. Staff replies are tinted so the
answer from your side is the one that catches the eye.

A reply is *not* queued when the hub is down, unlike a report. A reply that turns up hours
later, out of order, in a conversation that has moved on is worse than one the sender knows
did not send.

<br>

## When the hub is down

A report is never lost to an outage. If the hub cannot be reached, the widget keeps the
report in a browser outbox and retries it on a widening schedule:

```
5m -> 15m -> 30m -> 1h -> 2h -> 5h -> 12h -> next day
```

Override it with `retryScheduleMs` if that does not suit.

The reporter sees this rather than an error: the compose box clears (the report is safe),
a muted line says it was saved, and the report appears in the list straight away with a
status pill.

### Status pill

Every report carries one, in its footer opposite the timestamp. Hover for the detail.

| | | |
| --- | --- | --- |
| ✓ | **Sent** | Delivered to the hub. |
| ◷ | **retrying in 2h** | In the outbox. The tooltip gives attempts made, when the next one is due, and the last error. |
| ⚠ | **Not sent** &nbsp;·&nbsp; Retry | The schedule ran out. The report is kept, and the Retry button sends it immediately. |

An undelivered report also gets a dashed border, and stays editable and deletable —
nothing has reached the hub yet, so edits go to the queued copy and deleting just drops
it from the outbox.

### What gets retried

Only failures that could plausibly succeed later: a network error, a timeout, `429`, or
any `5xx`. A `4xx` is a permanent rejection — a malformed body, or a kind this site does
not collect — and would fail identically tomorrow, so it is reported at once and the text
is left in the box rather than being retried for a day.

### The honest limitation

**Retries happen in the browser, so attempts are only made while the app is open.** The
widget tries on mount, when the tab becomes visible, when the browser comes back online,
and on a one-minute timer. So the long waits mean "not before then" rather than "exactly
then" — a report queued overnight goes out when someone next opens the app.

Nothing is lost either way: the outbox is `localStorage`, so it survives the tab closing,
the browser quitting and a reboot. For guaranteed background delivery you would need a
durable queue and a scheduler on your own server, which is more than a drop-in widget can
assume you have.

Two tabs open on the same app will not double-send: each report is claimed for 60 seconds
before its request, and the tabs keep their lists in step through the `storage` event.

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

It collects reports and shows the reporter their own project's list: submit with a
severity, browse open items, browse archived ones, sort by date or severity, edit or
delete their own entries while they are still open, and hold a conversation on any of
them. A report filed while the hub is unreachable is queued and retried rather than lost.

Triage lives in the hub. Approving, rejecting and marking done are not things a reporting
site can do — an API key is scoped to reporting, and an item stops being editable once
somebody in the hub has acted on it. The **thread stays open** after that, deliberately:
"why was this rejected?" is exactly the question a conversation is for.

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
| `PATCH` | `/items/{id}` | `{ text?, severity? }` → the updated `FeedbackItem` |
| `DELETE` | `/items/{id}` | `204` |
| `GET` | `/items/{id}/messages` | `FeedbackMessage[]`, oldest first |
| `POST` | `/items/{id}/messages` | `{ body }` → the created `FeedbackMessage` |

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
  messageCount: number;       // live replies on the thread
}

interface FeedbackMessage {
  id: string;
  body: string;
  createdAt: string;
  authorKind: 'reporter' | 'staff';
  authorName: string | null;
  mine: boolean;              // whether the current reporter wrote it
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
npm run dev            # Vite playground with an in-memory mock of the hub
npm test               # vitest
npm run typecheck
npm run build          # tsup → dist/, then postbuild applies "use client"
```

`src/index.ts` is the browser entry and carries `use client`; `src/server/index.ts` is the
proxy and imports no React. The postbuild step asserts both, because a missing directive
surfaces in someone else's app as a confusing hook error.

## Releasing

Consumers install this from npm. That is not a preference — a consuming app's Docker
build runs `npm ci` inside `node:20-alpine`, which has no git and no access to anybody's
local disk, so a registry package is the only form that works there.

```bash
npm version patch        # or minor / major — commits and tags
git push --follow-tags
```

The tag fires `.github/workflows/publish.yml`, which typechecks, tests, builds and
publishes. It needs an `NPM_TOKEN` repo secret with publish rights on the scope.

To publish by hand instead:

```bash
npm login
npm publish --access public
```

`prepublishOnly` runs typecheck, tests and build first, so a broken release fails before
it leaves the machine. `npm publish --dry-run` shows exactly what would ship.

**The scope has to exist.** `@melatech` must be an npm organisation you own — free for
public packages, created at npmjs.com/org/create. Without it, publish fails on the scope
no matter how the token is set up.

### Consuming a new version

```bash
npm update @melatech/feedback-widget
```

In development, against a change that is not published yet, skip the registry:

```bash
# here
npm run build && npm pack
# in the consumer
npm install ../bug_feature_widget/melatech-feedback-widget-0.1.0.tgz
rm -rf .next        # Next caches the compiled dependency, and swapping it in
                    # place does not reliably invalidate that
```

A git dependency (`npm i github:simongrech/bug_feature_widget`) also works — `prepare`
builds it on install — but it needs `git` in the consumer's Docker image and rebuilds the
widget on every CI run, so it suits a quick trial rather than a deployment.

<br>

## Licence

MIT
