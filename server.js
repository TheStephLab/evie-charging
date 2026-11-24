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

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, 'data', 'state.json');
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';

const num = (key, fallback) => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const minSession = num('MIN_SESSION_MINUTES', DEFAULT_CONFIG.minSessionMinutes);
const config = Object.freeze({
  chargers: Math.round(num('CHARGERS', DEFAULT_CONFIG.chargers)),
  chargerKw: num('CHARGER_KW', DEFAULT_CONFIG.chargerKw),
  milesPerKwh: num('MILES_PER_KWH', DEFAULT_CONFIG.milesPerKwh),
  minSessionMinutes: minSession,
  maxSessionMinutes: Math.max(minSession, num('MAX_SESSION_MINUTES', DEFAULT_CONFIG.maxSessionMinutes)),
  offerMinutes: num('OFFER_MINUTES', DEFAULT_CONFIG.offerMinutes),
  swapGraceMinutes: num('SWAP_GRACE_MINUTES', DEFAULT_CONFIG.swapGraceMinutes),
  urgentRangeMiles: num('URGENT_RANGE_MILES', DEFAULT_CONFIG.urgentRangeMiles),
});

// ---- state & persistence -------------------------------------------------
let state = loadState();
let saveTimer = null;

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(s.chargers) && Array.isArray(s.queue)) return s;
  } catch {
    /* first run or corrupt file: start fresh */
  }
  return createState(config, Date.now());
}

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, DATA_FILE);
  } catch (err) {
    console.error('Failed to save state:', err.message);
  }
}
const scheduleSave = () => (saveTimer ??= setTimeout(saveNow, 250));

// Information is deliberately short-lived: everything resets at midnight.
function ensureFresh(now) {
  if (state.day !== dayKey(now) || state.chargers.length !== config.chargers) {
    state = createState(config, now);
  }
}

// Opaque per-process owner tags so raw client ids are never broadcast.
const SALT = crypto.randomBytes(16).toString('hex');
const tag = (clientId) => crypto.createHash('sha256').update(SALT + clientId).digest('base64url').slice(0, 16);

const validClient = (id) => (typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : null);
const snapshot = (now, clientId) =>
  JSON.stringify({ ...publicState(state, now, config, tag), me: clientId ? tag(clientId) : null });

// ---- realtime (Server-Sent Events) -------------------------------------
const streams = new Set();

function broadcast(now) {
  for (const s of streams) s.res.write(`data: ${snapshot(now, s.clientId)}\n\n`);
}

function apply(fn, input) {
  const now = Date.now();
  ensureFresh(now);
  const events = fn(state, input, now, config);
  scheduleSave();
  broadcast(now);
  notify(events);
  return now;
}

// ---- optional chat webhook (Teams / Slack / Google Chat accept {text}) -----
const describe = {
  offer: (e) => `🔌 EVIE: Charger ${e.chargerId} is free for ${e.name} — please plug in within ${config.offerMinutes} min.`,
  'swap-request': (e) =>
    `🔁 EVIE: ${e.name}, please unplug from charger ${e.chargerId} within ${config.swapGraceMinutes} min${e.forName ? ` — ${e.forName} is waiting` : ''}.`,
  'offer-expired': (e) => `⌛ EVIE: ${e.name} didn't plug in to charger ${e.chargerId} in time; offering it to the next person.`,
};

function notify(events) {
  if (!WEBHOOK_URL) return;
  for (const e of events) {
    const text = describe[e.type]?.(e);
    if (!text) continue;
    fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5000),
    }).catch((err) => console.error('Webhook failed:', err.message));
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

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
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
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  // The scheduler is shared: the server runs it, and the browser runs it in demo mode.
  const file = rel === 'scheduler.js' ? path.join(ROOT, 'src', 'scheduler.js') : path.resolve(PUBLIC, rel);
  if (rel !== 'scheduler.js' && !file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    const extra = rel === 'sw.js' ? { 'service-worker-allowed': '/' } : {};
    send(res, 200, req.method === 'HEAD' ? undefined : data, TYPES[path.extname(file)] || 'application/octet-stream', extra);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/healthz') return send(res, 200, '{"ok":true}');

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
    if (err instanceof SchedulerError) return send(res, err.status, JSON.stringify({ error: err.message }));
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
  console.log(`EVIE listening on http://localhost:${PORT}`, config);
});
