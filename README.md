# EVIE ⚡ — 101 Science Park EV Charging

EVIE is a small, fast web app for sharing the 101 Science Park 7 kW chargers fairly. It has no accounts and no database, and nothing about people lasts past today.

**Live demo:** <https://thestephlab.github.io/evie-charging/>. Settings are at [`settings.html`](https://thestephlab.github.io/evie-charging/settings.html); the demo token is `demo`.

## Features

**Basic, always on:**

- **Check in** to a charger with your name, current range and target range.
- **Queue** when all chargers are busy. It's first come, first served, and shows an estimated wait. When a charger frees up it's **held for the next person** for 15 minutes (configurable), then passed on.
- **Honour-system fallbacks.** Anyone can "mark free" a charger someone forgot to check out of, or remove a stale queue entry.
- In-page alerts: a banner and a 🔔 in the tab title when a charger is ready for you or it's your turn to swap.

**Advanced, behind feature flags.** All of these are **off** until an admin enables them in **Settings**:

| Flag | What it adds |
|---|---|
| Advanced scheduling | A guaranteed charging time (2 h). Need-based swap requests: once someone is waiting, the first person in this list is asked to unplug: anyone over the maximum time (4 h), then anyone who has reached their target, then whoever needs the fewest extra miles. Low-range queue priority (under 30 mi). |
| Add someone else to the queue | Queue a colleague (up to 3 each). You get their alerts and can check them in and out. They can also claim their charger themselves by checking in with the same name. |
| Browser notifications | A Notifications panel for subscribing to system notifications (needs HTTPS), with sound and vibration. |
| Email notifications | An optional email field. EVIE emails people when a charger is ready or it's their turn to swap. Needs SMTP (see below). |
| Team chat webhook | Posts offers and swap requests to Teams, Slack or Google Chat. Needs `WEBHOOK_URL`. |

Settings also cover the timings: the hold time, guaranteed time, maximum time, time to unplug, and the low-range threshold.

## Settings and the admin token

Settings use a single **admin token** rather than logins:

- On first start the server generates a random 32-character token and saves it to `data/admin-token` (file mode 600). It also prints a one-click link: `https://your-evie/settings.html#token=…`. The token is in the URL *fragment*, which browsers never send to the server or write to its logs. The page stores it in `sessionStorage` and removes it from the address bar.
- To set your own token instead, use the `ADMIN_TOKEN` environment variable, with at least 20 random characters.
- The token is sent as an `Authorization: Bearer` header and compared in constant time.
- Wrong tokens are rate-limited: 10 attempts per IP per 15 minutes.
- To rotate the token, change `ADMIN_TOKEN`, or delete `data/admin-token` and restart.
- Settings are saved in `data/settings.json` and survive the midnight reset.

**Demo mode (GitHub Pages):** a static site can't keep a secret, so the demo token is the public value `demo`. Settings there are stored only in your browser. This shows how the token flow works; it isn't security.

## Email notifications: how SMTP works here

Email can only be sent by the **EVIE server**. A static site such as GitHub Pages has nothing to send from, and SMTP credentials placed in a browser would be visible to everyone.

When it's someone's turn, EVIE's server connects to your mail provider's SMTP server and sends a short plain-text email:

1. A person adds an optional email when they check in or join the queue. Someone who adds a colleague can enter that colleague's email instead.
2. The address stays on the server only. It's never sent to other browsers, and it's deleted with everything else at midnight.
3. When a charger is offered to them, or a swap is requested (advanced scheduling), the server connects to `SMTP_HOST`. The connection is encrypted with TLS: implicit TLS on port 465, or STARTTLS on 587. The server then logs in with `SMTP_USER`/`SMTP_PASS` and sends the email from `SMTP_FROM`. The email links straight back to EVIE (`PUBLIC_URL/c/N`).
4. EVIE refuses to send credentials over an unencrypted connection. `SMTP_ALLOW_INSECURE=true` exists only for a trusted internal relay.

The SMTP client is built in (`src/smtp.js`, using Node's `net`/`tls`), so there are no extra dependencies. To set up:

```bash
SMTP_HOST=smtp.example.com      # your provider
SMTP_PORT=587                   # 587 = STARTTLS (default), 465 = implicit TLS
SMTP_USER=evie@example.com      # omit for an unauthenticated internal relay
SMTP_PASS=app-password-or-key
SMTP_FROM="EVIE <evie@example.com>"
PUBLIC_URL=https://evie.example.com   # used for links in emails
```

Then turn on **Email notifications** in Settings and use **Send test** to check it.

**Which provider?**

- A transactional email service is the most reliable choice: Amazon SES, SendGrid, Postmark, Mailgun or Brevo. Each gives you an SMTP host, a username and an API key to use as the password.
- With Microsoft 365, check with IT first. Microsoft is retiring basic-authentication SMTP AUTH, and many tenants already have it turned off. The alternative is an Exchange Online connector-based relay (port 25, IP-restricted, no password).
- Gmail or Google Workspace works with an app password on `smtp.gmail.com:587`.
- Set up SPF and DKIM for the sending domain, otherwise the emails may end up in spam.

## Run

```bash
npm start            # http://localhost:3000  (Node 20+, zero runtime dependencies)
npm test             # scheduler, settings and SMTP tests
```

Docker:

```bash
docker build -t evie .
docker run -d -p 3000:3000 -e TZ=Europe/London -e PUBLIC_URL=https://evie.example.com \
  -v evie-data:/app/data --restart unless-stopped evie
```

### Two modes

| | Server mode (`npm start`, Docker) | Demo mode (GitHub Pages / any static host) |
|---|---|---|
| State | Shared across the office, live via Server-Sent Events | Stays in this browser, shared between its tabs |
| Scheduler | `src/scheduler.js` on the server | The **same** `scheduler.js`, run in the browser |
| Settings | Admin token, `data/settings.json` | Token `demo`, stored in this browser |
| Extras | Email, webhook, saved to disk | **Fast-forward** and **Reset** controls |

EVIE picks the mode itself: it uses server mode if `api/state` responds, and demo mode otherwise. Add `?demo` to the URL to force demo mode. Pushing to `main` deploys the demo to Pages via `.github/workflows/pages.yml`.

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `PUBLIC_URL` | `http://localhost:PORT` | Public address, used in emails and the settings link |
| `SITE_NAME` | `101 Science Park` | Site name used in emails |
| `ADMIN_TOKEN` | generated | Admin token for Settings (otherwise `data/admin-token`) |
| `CHARGERS` | `3` | Number of chargers |
| `CHARGER_KW` / `MILES_PER_KWH` | `7` / `3.5` | Used for range estimates |
| `MIN_SESSION_MINUTES`, `MAX_SESSION_MINUTES`, `OFFER_MINUTES`, `SWAP_GRACE_MINUTES`, `URGENT_RANGE_MILES` | `120`, `240`, `15`, `15`, `30` | Default timings; Settings can override them |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_ALLOW_INSECURE` | – | Email (see above) |
| `WEBHOOK_URL` | – | Teams, Slack or Google Chat incoming webhook |
| `DATA_FILE` | `./data/state.json` | Today's state; settings and the token are stored next to it |
| `TZ` | system | Sets when the overnight reset happens |

## Design

The UI follows the AVEVA-inspired application style:

- **Fonts:** self-hosted Roboto (`public/fonts`, OFL licence included).
- **Colours:** the semantic tokens in `public/tokens.css`.
- **Layout:** a fixed 64 px app bar and a 240 px navigation rail (a navigation dialog at 760 px and below). The page has metric cards, charger cards with status badges, and the queue as a table.
- **Controls:** buttons and cards with 4 px corners, and focus outlines in the interaction colour.
- **Theme:** **System** (the default, follows `prefers-color-scheme`), **Light** or **Dark**, chosen from the ◐ menu in the app bar. `public/theme.js` saves the choice in `localStorage` and keeps open tabs in sync.

Code layout:

- `src/scheduler.js`: all the rules, as pure functions `(state, input, now, config) → events`.
- `src/settings.js`: feature flags and tunables, shared by the server and demo mode.
- `src/smtp.js`: a dependency-free SMTP client.
- `public/`: plain HTML, CSS and JS with no build step.
  - Accessibility: semantic HTML, live regions, a skip link, keyboard-friendly dialogs, 44 px touch targets, and `prefers-reduced-motion` support.
  - A service worker caches the app so it opens offline with the last known state.
- Privacy: each device gets a random ID, and only salted hashes of it are broadcast. Email addresses never leave the server.

## Charger stickers (QR + NFC)

Each charger can have a sticker with a QR code and an NFC tap zone. Both link to `/c/N`, which opens check-in for that charger. To generate them, run `npm run stickers -- --base https://your-evie-url`. The Pages build also publishes them at [`/stickers/sheet-1.svg`](https://thestephlab.github.io/evie-charging/stickers/sheet-1.svg). Design, printing and NFC tags are covered in [stickers/README.md](stickers/README.md).

### Possible next steps

- Web Push, so browser notifications arrive with the page closed (needs VAPID keys).
- Usage statistics to help decide whether a 4th charger is needed.
