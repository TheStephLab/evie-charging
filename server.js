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
import { cleanWebhookFormat, cleanWebhookUrl, maskUrl, postWebhook, resolveFormat } from './src/webhook.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, 'data', 'state.json');
const DATA_DIR = path.dirname(DATA_FILE);
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const TOKEN_FILE = path.join(DATA_DIR, 'admin-token');
const SECRETS_FILE = path.join(DATA_DIR, 'secrets.json');
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';
const SITE_NAME = process.env.SITE_NAME || '101 Science Park';
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const SMTP = smtpConfigFromEnv();

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
  swapGraceMinutes: num('SWAP_GRACE_MINUTES', DEFAULT_CONFIG.swapGraceMinutes),
  urgentRangeMiles: num('URGENT_RANGE_MILES', DEFAULT_CONFIG.urgentRangeMiles),
  maxQueue: Math.round(num('MAX_QUEUE', DEFAULT_CONFIG.maxQueue)),
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

// Secrets set from the settings page (the webhook URL). Kept apart from settings.json, mode 600,
// and never sent back to the browser in full.
let secrets = readJsonFile(SECRETS_FILE) ?? {};
const saveSecrets = () => writeAtomic(SECRETS_FILE, JSON.stringify(secrets, null, 2), 0o600);
function webhook() {
  if (secrets.webhookUrl) return { url: secrets.webhookUrl, format: secrets.webhookFormat ?? 'auto', source: 'settings' };
  if (WEBHOOK_URL) return { url: WEBHOOK_URL, format: process.env.WEBHOOK_FORMAT || 'auto', source: 'env' };
  return null;
}
const caps = () => ({ smtp: Boolean(SMTP?.from), webhook: Boolean(webhook()) });
const config = () => effectiveConfig(BASE, settings, caps());

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

const adminView = () => {
  const hook = webhook();
  return JSON.stringify({
    settings,
    base: BASE,
    caps: caps(),
    smtp: SMTP && { host: SMTP.host, port: SMTP.port, secure: SMTP.secure, from: SMTP.from, auth: Boolean(SMTP.user) },
    webhook: hook && {
      masked: maskUrl(hook.url),
      source: hook.source,
      format: hook.format,
      resolvedFormat: resolveFormat(hook.url, hook.format),
    },
  });
};

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
    features: publicFeatures(settings, caps()),
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

const chat = {
  'charger-free': (e) => ({
    title: `🔌 Charger ${e.chargerId} is free. ${e.name}, you're next in the queue`,
    text: "Chargers aren't reserved: whoever plugs in and checks in first gets it.",
    link: `${PUBLIC_URL}/c/${e.chargerId}`,
  }),
  'swap-request': (e) => ({
    title: `🔁 ${e.name}, please unplug from charger ${e.chargerId}`,
    text: `${e.forName ? `${e.forName} is` : 'Someone is'} waiting. Please unplug within ${config().swapGraceMinutes} minutes and check out.`,
    link: `${PUBLIC_URL}/`,
  }),
};

const emails = {
  'charger-free': (e) => ({
    subject: `⚡ Charger ${e.chargerId} is free`,
    text: `Hi ${e.name},

Charger ${e.chargerId} at ${SITE_NAME} is free and you're next in the queue.

Chargers aren't reserved, so it goes to whoever plugs in and checks in first. If you want it, head over now and check in on EVIE:
${PUBLIC_URL}/c/${e.chargerId}

If you no longer need a charge, please leave the queue.

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
  const hook = settings.features.teamWebhook ? webhook() : null;
  for (const e of events) {
    const message = chat[e.type]?.(e);
    if (message && hook) {
      postWebhook(hook, message).catch((err) => console.error('Webhook failed:', err.message));
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
  if (pathname === '/api/admin/webhook') {
    if (body.clear) {
      delete secrets.webhookUrl;
      delete secrets.webhookFormat;
    } else {
      const format = cleanWebhookFormat(body.format);
      // Allow changing just the format of an already-saved URL.
      const url = String(body.url ?? '').trim() ? cleanWebhookUrl(body.url) : secrets.webhookUrl;
      if (!url) throw new SchedulerError('Paste the webhook URL.', 400);
      Object.assign(secrets, { webhookUrl: url, webhookFormat: format });
    }
    saveSecrets();
    broadcast(Date.now());
    return send(res, 200, adminView());
  }
  if (pathname === '/api/admin/test-webhook') {
    const hook = String(body.url ?? '').trim()
      ? { url: cleanWebhookUrl(body.url), format: cleanWebhookFormat(body.format) }
      : webhook();
    if (!hook) throw new SchedulerError('Save a webhook URL first.', 409);
    try {
      const status = await postWebhook(hook, {
        title: '✅ EVIE is connected',
        text: `This channel will get free-charger alerts and swap requests from EVIE at ${SITE_NAME}.`,
        link: `${PUBLIC_URL}/`,
      });
      return send(res, 200, JSON.stringify({ ok: true, status, format: resolveFormat(hook.url, hook.format) }));
    } catch (err) {
      throw new SchedulerError(`The webhook rejected the test: ${err.message}`, 502);
    }
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

// Periodic reconciliation: raises swap requests and refreshes estimates.
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
