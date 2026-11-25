import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CONFIG,
  SchedulerError,
  createState,
  dayKey,
  checkIn,
  checkOut,
  joinQueue,
  leaveQueue,
  updateSession,
  tick,
  publicState,
} from './src/scheduler.js';
import { SettingsError, cleanSettings, effectiveConfig, loadSettings, publicFeatures } from './src/settings.js';
import { sendMail, smtpConfigFromEnv } from './src/smtp.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, 'data', 'state.json');
const DATA_DIR = path.dirname(DATA_FILE);
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const TOKEN_FILE = path.join(DATA_DIR, 'admin-token');
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';
const SITE_NAME = process.env.SITE_NAME || '101 Science Park';
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const SMTP = smtpConfigFromEnv();
const CAPS = { smtp: Boolean(SMTP?.from), webhook: Boolean(WEBHOOK_URL) };

const num = (key, fallback) => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
// Environment values are the defaults; the settings page can override the tunables.
const minSession = num('MIN_SESSION_MINUTES', DEFAULT_CONFIG.minSessionMinutes);
const BASE = Object.freeze({
  chargers: Math.round(num('CHARGERS', DEFAULT_CONFIG.chargers)),
  chargerKw: num('CHARGER_KW', DEFAULT_CONFIG.chargerKw),
  milesPerKwh: num('MILES_PER_KWH', DEFAULT_CONFIG.milesPerKwh),
  minSessionMinutes: minSession,
  maxSessionMinutes: Math.max(minSession, num('MAX_SESSION_MINUTES', DEFAULT_CONFIG.maxSessionMinutes)),
  offerMinutes: num('OFFER_MINUTES', DEFAULT_CONFIG.offerMinutes),
  swapGraceMinutes: num('SWAP_GRACE_MINUTES', DEFAULT_CONFIG.swapGraceMinutes),
  urgentRangeMiles: num('URGENT_RANGE_MILES', DEFAULT_CONFIG.urgentRangeMiles),
});

// ---- files -----------------------------------------------------------------
function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeAtomic(file, contents, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}

// ---- settings & admin token ---------------------------------------------------
let settings = loadSettings(readJsonFile(SETTINGS_FILE), BASE);
const config = () => effectiveConfig(BASE, settings, CAPS);

let tokenGenerated = false;
function loadAdminToken() {
  const fromEnv = process.env.ADMIN_TOKEN?.trim();
  if (fromEnv) {
    if (fromEnv.length < 20) console.warn('ADMIN_TOKEN is short; use at least 20 random characters.');
    return fromEnv;
  }
  try {
    const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (t) return t;
  } catch {
    /* generate below */
  }
  const t = crypto.randomBytes(24).toString('base64url');
  writeAtomic(TOKEN_FILE, `${t}\n`, 0o600);
  tokenGenerated = true;
  return t;
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest();
const ADMIN_TOKEN = loadAdminToken();
const ADMIN_HASH = sha256(ADMIN_TOKEN);

// Brute-force protection: 10 bad tokens per IP per 15 minutes.
const failures = new Map();
function checkAdmin(req) {
  const ip = req.socket.remoteAddress ?? '?';
  const now = Date.now();
  const f = failures.get(ip);
  if (f && f.resetAt < now) failures.delete(ip);
  if ((failures.get(ip)?.count ?? 0) >= 10) throw new SchedulerError('Too many attempts. Try again later.', 429);
  const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization ?? '');
  if (!m) throw new SchedulerError('Settings need the admin token.', 401); // not counted: the page probes without one
  if (crypto.timingSafeEqual(sha256(m[1]), ADMIN_HASH)) return;
  const entry = failures.get(ip) ?? { count: 0, resetAt: now + 15 * 60_000 };
  entry.count++;
  failures.set(ip, entry);
  throw new SchedulerError('That token is not valid.', 401);
}

const adminView = () =>
  JSON.stringify({
    settings,
    base: BASE,
    caps: CAPS,
    smtp: SMTP && { host: SMTP.host, port: SMTP.port, secure: SMTP.secure, from: SMTP.from, auth: Boolean(SMTP.user) },
  });

// ---- state & persistence -------------------------------------------------
let state = loadState();
let saveTimer = null;

function loadState() {
  const s = readJsonFile(DATA_FILE);
  if (s && Array.isArray(s.chargers) && Array.isArray(s.queue)) return s;
  return createState(BASE, Date.now());
}

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    writeAtomic(DATA_FILE, JSON.stringify(state), 0o600);
  } catch (err) {
    console.error('Failed to save state:', err.message);
  }
}
const scheduleSave = () => (saveTimer ??= setTimeout(saveNow, 250));

// Information is deliberately short-lived (including email addresses): everything resets at midnight.
function ensureFresh(now) {
  if (state.day !== dayKey(now) || state.chargers.length !== BASE.chargers) {
    state = createState(BASE, now);
  }
}

// Opaque per-process owner tags so raw client ids are never broadcast.
const SALT = crypto.randomBytes(16).toString('hex');
const tag = (clientId) => crypto.createHash('sha256').update(SALT + clientId).digest('base64url').slice(0, 16);

const validClient = (id) => (typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : null);
const snapshot = (now, clientId) =>
  JSON.stringify({
    ...publicState(state, now, config(), tag),
    features: publicFeatures(settings, CAPS),
    me: clientId ? tag(clientId) : null,
  });

// ---- realtime (Server-Sent Events) -------------------------------------
const streams = new Set();

function broadcast(now) {
  for (const s of streams) s.res.write(`data: ${snapshot(now, s.clientId)}\n\n`);
}

function apply(fn, input) {
  const now = Date.now();
  ensureFresh(now);
  const events = fn(state, input, now, config());
  scheduleSave();
  broadcast(now);
  notify(events);
  return now;
}

// ---- notifications: team webhook + email -----------------------------------
const mins = (ms) => {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
};

const describe = {
  offer: (e) => `🔌 EVIE: Charger ${e.chargerId} is free for ${e.name} — please plug in within ${config().offerMinutes} min.`,
  'swap-request': (e) =>
    `🔁 EVIE: ${e.name}, please unplug from charger ${e.chargerId} within ${config().swapGraceMinutes} min${e.forName ? ` — ${e.forName} is waiting` : ''}.`,
  'offer-expired': (e) => `⌛ EVIE: ${e.name} didn't plug in to charger ${e.chargerId} in time; offering it to the next person.`,
};

const emails = {
  offer: (e) => ({
    subject: `⚡ Charger ${e.chargerId} is ready for you`,
    text: `Hi ${e.name},

Charger ${e.chargerId} at ${SITE_NAME} is free and is being held for you for ${config().offerMinutes} minutes.

Plug in, then check in on EVIE:
${PUBLIC_URL}/c/${e.chargerId}

If you no longer need it, please leave the queue so the next person can have it.

— EVIE, ${SITE_NAME} EV Charging
You're getting this because you added your email when you joined the queue today. EVIE deletes it overnight.`,
  }),
  'swap-request': (e) => ({
    subject: `🔁 Please move your car from charger ${e.chargerId}`,
    text: `Hi ${e.name},

${e.forName ? `${e.forName} is` : 'Someone is'} waiting for a charger at ${SITE_NAME}. You've been charging on charger ${e.chargerId} for ${mins(Date.now() - e.startedAt)}.

Please unplug within ${config().swapGraceMinutes} minutes and check out on EVIE:
${PUBLIC_URL}/

Thanks for sharing!

— EVIE, ${SITE_NAME} EV Charging
You're getting this because you added your email when you checked in today. EVIE deletes it overnight.`,
  }),
};

function notify(events) {
  for (const e of events) {
    const text = describe[e.type]?.(e);
    if (text && settings.features.teamWebhook && WEBHOOK_URL) {
      fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(5000),
      }).catch((err) => console.error('Webhook failed:', err.message));
    }
    const mail = emails[e.type];
    if (mail && e.email && config().emailEnabled) {
      sendMail(SMTP, { to: e.email, ...mail(e) }).catch((err) => console.error(`Email to ${e.name} failed:`, err.message));
    }
  }
}

// ---- HTTP ------------------------------------------------------------------
const ACTIONS = {
  '/api/checkin': checkIn,
  '/api/checkout': checkOut,
  '/api/session/update': updateSession,
  '/api/queue/join': joinQueue,
  '/api/queue/leave': leaveQueue,
};

// Shared modules: the server runs them, and the browser runs them in demo mode.
const SHARED = { 'scheduler.js': 'scheduler.js', 'settings.js': 'settings.js' };

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-cache', ...SECURITY_HEADERS, ...extra });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 10_000) throw new SchedulerError('Request too large.', 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    throw new SchedulerError('Invalid JSON.');
  }
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  if (rel === 'settings') rel = 'settings.html';
  const file = SHARED[rel] ? path.join(ROOT, 'src', SHARED[rel]) : path.resolve(PUBLIC, rel);
  if (!SHARED[rel] && !file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    const extra = rel === 'sw.js' ? { 'service-worker-allowed': '/' } : {};
    send(res, 200, req.method === 'HEAD' ? undefined : data, TYPES[path.extname(file)] || 'application/octet-stream', extra);
  });
}

async function handleAdmin(req, res, pathname) {
  checkAdmin(req);
  if (pathname === '/api/admin/settings' && req.method === 'GET') return send(res, 200, adminView());
  if (req.method !== 'POST') return send(res, 405, '{"error":"Method not allowed"}');
  const body = await readJson(req);
  if (pathname === '/api/admin/settings') {
    settings = cleanSettings(body, settings);
    writeAtomic(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    apply((s, _i, now, c) => tick(s, now, c), {}); // e.g. cancel swap requests when advanced scheduling is switched off
    return send(res, 200, adminView());
  }
  if (pathname === '/api/admin/test-email') {
    if (!SMTP) throw new SchedulerError('SMTP is not configured on the server.', 409);
    try {
      await sendMail(SMTP, {
        to: String(body.to ?? ''),
        subject: '✅ EVIE test email',
        text: `This is a test email from EVIE at ${SITE_NAME}.\n\nIf you can read this, email notifications are working.\n\n${PUBLIC_URL}/`,
      });
    } catch (err) {
      throw new SchedulerError(`Sending failed: ${err.message}`, 502);
    }
    return send(res, 200, '{"ok":true}');
  }
  return send(res, 404, '{"error":"Not found"}');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/healthz') return send(res, 200, '{"ok":true}');
    if (url.pathname.startsWith('/api/admin/')) return await handleAdmin(req, res, url.pathname);

    if (url.pathname === '/api/events' && req.method === 'GET') {
      const now = Date.now();
      ensureFresh(now);
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
        ...SECURITY_HEADERS,
      });
      const stream = { res, clientId: validClient(url.searchParams.get('client')) };
      streams.add(stream);
      res.write(`retry: 3000\ndata: ${snapshot(now, stream.clientId)}\n\n`);
      req.on('close', () => streams.delete(stream));
      return;
    }

    if (url.pathname === '/api/state' && req.method === 'GET') {
      const now = Date.now();
      ensureFresh(now);
      return send(res, 200, snapshot(now, validClient(req.headers['x-client-id'])));
    }

    const action = ACTIONS[url.pathname];
    if (action) {
      if (req.method !== 'POST') return send(res, 405, '{"error":"Method not allowed"}');
      const body = await readJson(req);
      const clientId = req.headers['x-client-id'];
      const now = apply(action, { ...body, clientId });
      return send(res, 200, snapshot(now, validClient(clientId)));
    }

    // Short sticker links (QR / NFC): /c/2 -> check in to charger 2.
    const short = url.pathname.match(/^\/c\/(\d{1,2})\/?$/);
    if (short) return send(res, 302, '', 'text/plain', { location: `/?charger=${short[1]}` });

    if (url.pathname.startsWith('/api/')) return send(res, 404, '{"error":"Not found"}');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    if (err instanceof SchedulerError || err instanceof SettingsError) {
      return send(res, err.status, JSON.stringify({ error: err.message }));
    }
    console.error(err);
    return send(res, 500, JSON.stringify({ error: 'Something went wrong.' }));
  }
});

// Periodic reconciliation: expires offers, raises swap requests, refreshes estimates.
setInterval(() => apply((s, _i, now, c) => tick(s, now, c), {}), 30_000).unref();
setInterval(() => {
  for (const s of streams) s.res.write(': ping\n\n');
}, 25_000).unref();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    saveNow();
    process.exit(0);
  });
}

server.listen(PORT, () => {
  console.log(`EVIE listening on http://localhost:${PORT}`);
  console.log(`Email: ${SMTP ? `${SMTP.host}:${SMTP.port} as ${SMTP.from || '(SMTP_FROM missing)'}` : 'not configured'}`);
  if (tokenGenerated) {
    console.log(`\nSettings link (keep it private, it is also saved in ${TOKEN_FILE}):\n  ${PUBLIC_URL}/settings.html#token=${ADMIN_TOKEN}\n`);
  } else {
    console.log(`Settings: ${PUBLIC_URL}/settings.html (token from ${process.env.ADMIN_TOKEN ? 'ADMIN_TOKEN' : TOKEN_FILE})`);
  }
});
