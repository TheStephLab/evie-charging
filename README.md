# EVIE ⚡ — office EV charging

EVIE is a small, fast web app that manages the office's shared 7 kW chargers fairly: first come, first served in the morning, then automatic, need-based swaps when people are waiting. It has no accounts and no database, and nothing lasts past today.

## How it works

1. **Plug in, then check in.** Pick the charger, then enter your name, current range and target range.
2. **Every session gets a guaranteed 2 hours.** Nobody can be asked to move before then, unless they've already reached their target.
3. **If all chargers are busy, join the queue.** You'll see an estimated time.
4. **Need-based swaps.** Once someone is waiting, EVIE asks one eligible person to unplug. It picks the first match from this list:
   1. anyone who has charged for more than **4 hours**
   2. anyone who has **reached their target**
   3. the person needing the **fewest extra miles**
   4. the person who plugged in earliest

   They get an alert telling them who's waiting.
5. **Reserved hand-over.** A freed charger is held for the next person in the queue for **15 minutes**, so nobody can jump the queue. If they don't check in, it goes to the next person.
6. **Low-range priority.** People with under 30 miles of range go to the front of the queue.
7. **Honour-system fallbacks.** Anyone can use "They've left — mark free" or remove a stale queue entry.
8. **Add someone else.** You can queue a colleague who doesn't have EVIE open (up to 3 people each). You get their "charger ready" and "please swap" alerts, so you can pass them on, and you can check them in and out. They can also claim their reserved charger from their own phone by checking in with the same name.

Range is estimated from charger power: 7 kW × 3.5 mi/kWh ≈ 24 mi per hour of charging. Users can correct it with **Update range**.

## Run

**Live demo:** <https://thestephlab.github.io/evie-charging/>

```bash
npm start            # http://localhost:3000  (Node 20+, zero runtime dependencies)
npm test             # scheduler unit tests
```

### Two modes

| | Server mode (`npm start`, Docker) | Demo mode (GitHub Pages / any static host) |
|---|---|---|
| State | Shared across the office, live via Server-Sent Events | Stays in this browser, shared between its tabs |
| Scheduler | `src/scheduler.js` on the server | The **same** `scheduler.js`, run in the browser |
| Extras | Webhook, saved to disk | **Fast-forward** and **Reset** controls, to try out swaps and notifications |

The app picks the mode itself. If `api/state` responds, it uses server mode; otherwise it uses demo mode. Add `?demo` to the URL to force demo mode. GitHub Pages can only host static files, so the Pages site is a demo. Use server mode for the real office queue.

Pushing to `main` deploys to Pages via `.github/workflows/pages.yml`. The workflow runs the tests, copies `public/` and `scheduler.js`, and builds the stickers with the Pages URL into `/stickers/`. All paths are relative, so EVIE works at `/` and under `/evie-charging/`.

Docker:

```bash
docker build -t evie .
docker run -d -p 3000:3000 -e TZ=Europe/London -v evie-data:/app/data --restart unless-stopped evie
```

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `CHARGERS` | `3` | Number of chargers |
| `CHARGER_KW` | `7` | Charger power |
| `MILES_PER_KWH` | `3.5` | Average efficiency, used for estimates |
| `MIN_SESSION_MINUTES` | `120` | Guaranteed time before a swap can be requested |
| `MAX_SESSION_MINUTES` | `240` | After this you're first to be asked to swap |
| `OFFER_MINUTES` | `15` | How long a freed charger is held for the next person |
| `SWAP_GRACE_MINUTES` | `15` | Expected time to unplug after a swap request |
| `URGENT_RANGE_MILES` | `30` | Queue priority threshold |
| `WEBHOOK_URL` | – | Teams, Slack or Google Chat incoming webhook. EVIE posts offers, swap requests and expiries to it. |
| `DATA_FILE` | `./data/state.json` | Where today's state is saved, so it survives a restart |
| `TZ` | system | Sets when the overnight reset happens |

## Notifications

- **Subscribing:** open the 🔔 **Notifications** panel and choose **Enable notifications**, then **Send a test notification** to check it works. The panel shows the current state: on, blocked, not supported, or needs HTTPS. It also tells iPhone users to *Add to Home Screen* first, because iOS only allows web notifications for installed apps.
- **HTTPS is required** for system notifications and for installing EVIE as an app (PWA). GitHub Pages is HTTPS. For the server, put it behind a reverse proxy such as Caddy or nginx, or a Cloudflare tunnel.
- **Notifications only arrive while EVIE is open** in a tab or installed as an app. To reach people who have closed it, either set `WEBHOOK_URL` or add Web Push (see below).
- **Without permission**, EVIE still alerts you on the page: a banner, a beep, vibration and a 🔔 in the tab title.
- **`WEBHOOK_URL`** (server mode) posts to a team channel, so people get pinged even with the page closed. **Recommended.**

## Design

- `src/scheduler.js` holds all the rules as pure functions `(state, input, now, config) → events`. They're fully unit-tested and don't depend on the clock.
- `server.js` uses only Node's built-in `http` module:
  - Server-Sent Events for live updates
  - a timer every 30 seconds that expires offers and raises swap requests
  - atomic saves to a JSON file
  - a reset at midnight
- `public/` is plain HTML, CSS and JS with no build step:
  - accessible markup: semantic HTML, live regions, focus handling, 44 px touch targets
  - automatic dark mode
  - a service worker that caches the app shell and shows the last known state when offline
- There are no accounts. Each device gets a random ID. The server only ever broadcasts salted hashes of it, so you can't impersonate someone just by reading the page.

## Charger stickers (QR + NFC)

Each charger can have a sticker with a QR code and an NFC tap zone. Both link to `/c/N`, which opens check-in for that charger. On Pages, `404.html` handles that redirect. To generate the stickers, run `npm run stickers -- --base https://your-evie-url`. The Pages build also publishes them at [`/stickers/sheet-1.svg`](https://thestephlab.github.io/evie-charging/stickers/sheet-1.svg). Design, printing and NFC programming are covered in [stickers/README.md](stickers/README.md).

### Possible next steps

- Web Push, so notifications arrive even when the page is closed (needs VAPID keys).
- Usage statistics to help decide whether the office needs a 4th charger.
