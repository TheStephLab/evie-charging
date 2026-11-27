# 101 Science Park Hub

A small, fast information hub for 101 Cambridge Science Park. It has no accounts and no database, and nothing about people lasts past today.

**Live demo:** <https://thestephlab.github.io/evie-charging/>. Settings are at [`settings.html`](https://thestephlab.github.io/evie-charging/settings.html); the demo token is `demo`.

| Page | What it's for |
|---|---|
| **Home** (`index.html`) | Directory of every area with live charger availability, a **Book a desk or room** link to [Microsoft Places](https://places.cloud.microsoft/places/), grouped **useful links** (workplace help, hosting guests, getting here, the Park), and "Good to know" facts |
| **Visitor centre** (`visitor.html`) | A construction-work banner, "If the fire alarm sounds" steps, safety (alarm test, assembly point, exits, first aid, AED, fire marshals), access and opening hours (including Verkada card entry and guest Wi-Fi), getting here (driving with address, Google Maps and what3words, car park, cycling, train, bus, Park & Ride), around the Park (shuttle, Voi, amenities, Life on the Park), hosting guests (Verkada and internal visitors), accessibility and contacts. Printable. |
| **Facilities** (`facilities.html`) | Showers and drying areas, lockers, print areas, drink stations, games area, Parents', Sensory and Prayer rooms, First Aid Room, IT Hub, bookable spaces, and a floor guide with neighbourhoods and room names |
| **BYTE+BREW** (`restaurant.html`) | The on-site restaurant: what's served, allergen advice, Kanpla app offers and sign-up (Location ID **FJQU**), and meeting catering. No menu, as it changes. |
| **EV charging** (`charging.html`) | EVIE: check in to a charger and the fair queue, plus the EV Community Teams channel. Details below. |
| **Settings** (`settings.html`) | Protected by the admin token: feature flags, scheduling, email, Teams webhook, and the **visitor centre editor** |

## Content source

All site information comes from *Your Cambridge Science Park: 101, Phase One* (v1, 23 November 2026), including its links (Microsoft Places, Verkada, Workplace Experience, the EV Community Teams channel, transport and Cambridge Science Park pages), plus later updates from the site team (assembly point, first aid and AED locations, opening-hours access, card entry, directions and guest Wi-Fi). Links marked **AVEVA sign-in** need a work account.

Site conventions: floors are always **Level 0** and **Level 1**, every mention of contacting Workplace Experience links to its mailbox, and external links open in a new tab (with a hidden "opens in a new tab" note for screen readers and a small ↗ on inline links).

Individual colleagues' names and email addresses from the guide are deliberately left out, because this site and its repository are public. The site uses the Workplace Experience team mailbox and ticket link instead.

## Visitor centre content

The Visitor centre and the home page's "Good to know" facts start with the **default wording** in `src/visitor.js`. You can override any topic in **Settings → Visitor centre**.

- Each topic is plain text, up to 1,000 characters. Line breaks are kept, `[label](https://…)` becomes a link (only `https`, `http`, `mailto` and same-site pages; web links open in a new tab), `**text**` is bold (bold at the very start is shown as a headline, e.g. "Closest train station"), and phone numbers become tap-to-call links.
- Clear a topic to go back to the default wording. Saving the default wording unchanged stores nothing, so future updates come through.
- On the server, overrides are saved to `data/visitor.json`. They survive restarts and the midnight reset.
- Anyone can read it through `GET /api/visitor`. Saving uses `POST /api/admin/visitor` and needs the admin token.
- In demo mode it's stored in your browser.

The Facilities and BYTE+BREW pages are static HTML; edit `public/facilities.html` and `public/restaurant.html` to change them.

## EV charging (EVIE)

EVIE shares the 7 kW chargers fairly. Sticker links (`/c/N`) open **EV charging → Check in to charger N**.

## Features

**Basic, always on:**

- **Check in** in two taps: enter your name (remembered on your device), then choose **Top-up** (nice to have, happy to swap) or **Need it to get home** (not enough charge to get home safely). No range numbers, no accounts.
- **Queue** when all chargers are busy. It's first come, first served, and shows an estimated wait. Chargers are **never reserved**: when one frees up, the next person in the queue is alerted, but it goes to whoever plugs in and checks in first. The queue holds up to **6 people waiting**; people already charging don't count. The limit is configurable in Settings, and Join queue is disabled when the queue is full.
- **Honour-system fallbacks.** Anyone can "mark free" a charger someone forgot to check out of, or remove a stale queue entry.
- In-page alerts: a banner and a 🔔 in the tab title when a charger is ready for you or it's your turn to swap.

**Advanced, behind feature flags.** All of these are **off** until an admin enables them in **Settings**:

| Flag | What it adds |
|---|---|
| Advanced scheduling | A guaranteed charging time (2 h). People who **need it to get home** go to the front of the queue. Swap requests: once someone is waiting and the guaranteed time is up, the first person in this list is asked to unplug: anyone over the maximum time (4 h), then **top-ups** before people who need it to get home, then whoever plugged in earliest. Someone who needs it to get home is only asked to swap for someone else who does (or once over the maximum time), so a top-up never bumps them. |
| Add someone else to the queue | Queue a colleague (up to 3 each). You get their alerts and can check them in and out. They can also claim their charger themselves by checking in with the same name. |
| Browser notifications | A Notifications panel for subscribing to system notifications (needs HTTPS), with sound and vibration. |
| Email notifications | An optional email field. EVIE emails people when a charger is ready or it's their turn to swap. Needs SMTP (see below). |
| Team chat webhook | Posts free-charger alerts and swap requests to a Teams, Slack or Google Chat channel. Paste the webhook URL in Settings (see below). |

Settings also cover the timings (the guaranteed time, maximum time and time to unplug) and the maximum queue length.

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
3. When a charger frees up and they're next in the queue, or a swap is requested (advanced scheduling), the server connects to `SMTP_HOST`. The connection is encrypted with TLS: implicit TLS on port 465, or STARTTLS on 587. The server then logs in with `SMTP_USER`/`SMTP_PASS` and sends the email from `SMTP_FROM`. The email links straight back to EVIE (`PUBLIC_URL/c/N`).
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

## Team chat (Microsoft Teams) webhook

To post free-charger alerts and swap requests to a channel:

1. **Create the webhook in Teams.** In the channel, choose **⋯ (More options) → Workflows**. Pick **Send webhook alerts to a channel** (previously called *Post to a channel when a webhook request is received*), confirm the team and channel, then choose **Add workflow** and copy the URL.
2. **Apply it in EVIE.** Open **Settings → Team chat webhook**, paste the URL and choose **Save webhook**. Then use **Send test message**; a card should appear in the channel.
3. **Turn it on.** Under **Features**, turn on **Team chat webhook** and choose **Save settings**.

Notes:

- **Format:** Teams URLs (`*.logic.azure.com`, `*.powerplatform.com`, `*.webhook.office.com`) get an Adaptive Card with an **Open EVIE** button. Slack, Google Chat and anything else get plain `{"text": …}`. **Message format** lets you override the automatic choice.
- **The URL is a secret.** Anyone who has it can post to the channel.
  - EVIE stores it only on the server, in `data/secrets.json` (mode 600).
  - It's sent back to the browser only in masked form, for example `https://prod-12.westeurope.logic.azure.com/…1234`.
  - It must be `https://` with a public host name, and redirects aren't followed.
- **Replacing or removing it:** paste a new URL to replace it, or use **Remove**.
- **`WEBHOOK_URL` (+ `WEBHOOK_FORMAT`)** still works as an environment-variable default. A URL saved in Settings takes priority.
- **Demo mode (GitHub Pages)** can't post, because the URL would have to sit in the browser.

## Run

```bash
npm start            # http://localhost:3000  (Node 20+, zero runtime dependencies)
npm test             # scheduler, settings, SMTP and webhook tests
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
| `MIN_SESSION_MINUTES`, `MAX_SESSION_MINUTES`, `SWAP_GRACE_MINUTES`, `MAX_QUEUE` | `120`, `240`, `15`, `6` | Default timings; Settings can override them |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_ALLOW_INSECURE` | – | Email (see above) |
| `WEBHOOK_URL`, `WEBHOOK_FORMAT` | –, `auto` | Default webhook (a URL saved in Settings takes priority); format `auto`, `teams` or `text` |
| `DATA_FILE` | `./data/state.json` | Today's state; settings and the token are stored next to it |
| `TZ` | system | Sets when the overnight reset happens |

## Design

The UI uses a **wayfinding** style, taking its cues from the signage in a science park building:

- **Palette:** warm paper (`#F4F1EA`) and near-black ink (`#111820`). Each area has one signage colour, like a building zone: the **Visitor centre** is signal orange, **Facilities** is signal blue, **BYTE+BREW** is raspberry, **EV charging** is green, and **Settings** is graphite. `body[data-zone]` sets `--zone`, which colours page icons, the active tab, primary buttons and highlights. All tokens are in `public/tokens.css`.
- **Type:** self-hosted Roboto (`public/fonts`, OFL licence included). Display headings use Light 300 at large sizes, labels use small uppercase tracked overlines, and charger numbers and times use tabular figures.
- **Signature elements:**
  - The home page shows a giant outlined "101" and a dark lobby-style **Directory** board with live status.
  - Each charger card has a large charger number and a coloured status band: green free, blue charging, red swap requested.
  - The fire alarm steps are big numbered signage steps.
  - Facilities use pictogram signage tiles and a floor guide with lift-button level markers; the Kanpla Location ID is shown on a departure-board style panel with a copy button.
- **Layout:** a sticky top bar with Home, Visitor centre, Facilities, BYTE+BREW and EV charging (shorter labels on narrower screens). On phones (760 px and below) these become a **bottom tab bar** within thumb reach. Content is centred at up to 1,200 px.
- **Details:**
  - 2 px corners, strong ink focus outlines, and 44 px minimum touch targets.
  - A gentle staggered fade-in on page load, switched off for `prefers-reduced-motion`.
  - A print stylesheet for the Visitor centre.
- **Theme:** **System** (the default, follows `prefers-color-scheme`), **Light** or **Dark**, chosen from the ◐ menu. `public/theme.js` saves the choice in `localStorage` and keeps open tabs in sync.

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
