// Picks where EVIE's state lives:
//  - "server": the EVIE Node server (shared office queue, live via Server-Sent Events)
//  - "demo":   static hosting such as GitHub Pages. The same scheduler runs in the browser,
//              state stays on this device and is shared between its tabs.
const MODE_KEY = 'evie.mode';

export async function connectBackend({ clientId, onView, onStatus }) {
  if (new URLSearchParams(location.search).has('demo')) return localBackend({ clientId, onView, onStatus });
  try {
    const res = await fetch('api/state', { headers: { 'x-client-id': clientId }, cache: 'no-store' });
    if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
      localStorage.setItem(MODE_KEY, 'server');
      onView(await res.json());
      return remoteBackend({ clientId, onView, onStatus });
    }
  } catch {
    // Offline: stay in whatever mode worked last time.
    if (localStorage.getItem(MODE_KEY) !== 'demo') return remoteBackend({ clientId, onView, onStatus });
  }
  localStorage.setItem(MODE_KEY, 'demo');
  return localBackend({ clientId, onView, onStatus });
}

function remoteBackend({ clientId, onView, onStatus }) {
  const es = new EventSource(`api/events?client=${encodeURIComponent(clientId)}`);
  es.onopen = () => onStatus(true);
  es.onmessage = (e) => {
    onStatus(true);
    onView(JSON.parse(e.data));
  };
  es.onerror = () => onStatus(false); // EventSource reconnects automatically
  return {
    mode: 'server',
    async action(name, body) {
      const res = await fetch(`api/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-client-id': clientId },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      onView(data);
    },
  };
}

async function localBackend({ clientId, onView, onStatus }) {
  const S = await import('./scheduler.js');
  const Settings = await import('./settings.js');
  const CAPS = { smtp: false, webhook: false }; // no server: no email or webhook
  const settings = () => Settings.loadSettings(JSON.parse(localStorage.getItem(Settings.DEMO_SETTINGS_KEY) || 'null'), S.DEFAULT_CONFIG);
  const config = () => Settings.effectiveConfig(S.DEFAULT_CONFIG, settings(), CAPS);
  const KEY = 'evie.demo.state';
  const SKEW = 'evie.demo.skew';
  const FNS = {
    checkin: S.checkIn,
    checkout: S.checkOut,
    'queue/join': S.joinQueue,
    'queue/leave': S.leaveQueue,
  };
  const skew = () => Number(localStorage.getItem(SKEW)) || 0;
  const clock = () => Date.now() + skew();
  const tick = (s, _input, now, c) => S.tick(s, now, c);

  const load = () => {
    const cfg = config();
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.day === S.dayKey(clock()) && Array.isArray(s.chargers) && s.chargers.length === cfg.chargers) return s;
    } catch {
      /* corrupt: start fresh */
    }
    return S.createState(cfg, clock());
  };
  const publish = (state) =>
    onView({
      ...S.publicState(state, clock(), config()),
      features: Settings.publicFeatures(settings(), CAPS),
      me: clientId,
      demo: true,
    });
  const run = (fn, input) => {
    const state = load(); // re-read so other tabs' changes are never overwritten
    fn(state, input, clock(), config());
    localStorage.setItem(KEY, JSON.stringify(state));
    publish(state);
  };

  addEventListener('storage', (e) => {
    if (e.key === Settings.DEMO_SETTINGS_KEY) run(tick, {});
    else if (e.key === KEY || e.key === SKEW) publish(load());
  });
  setInterval(() => run(tick, {}), 15_000);
  onStatus(true);
  run(tick, {});

  return {
    mode: 'demo',
    async action(name, body) {
      run(FNS[name], { ...body, clientId });
    },
    fastForward(minutes) {
      localStorage.setItem(SKEW, String(skew() + minutes * 60_000));
      run(tick, {});
    },
    reset() {
      localStorage.removeItem(KEY);
      localStorage.removeItem(SKEW);
      run(tick, {});
    },
  };
}
