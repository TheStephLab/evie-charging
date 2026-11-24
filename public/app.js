import { connectBackend } from './backend.js';

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

// Anonymous per-device id; no accounts. getRandomValues works on plain-http LANs too.
function deviceId() {
  let id = localStorage.getItem('evie.client');
  if (!id) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    id = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('evie.client', id);
  }
  return id;
}
const CLIENT = deviceId();

const app = {
  backend: null,
  view: JSON.parse(localStorage.getItem('evie.last') || 'null'),
  online: false,
  offset: 0, // backend clock - Date.now()
  notified: new Set(JSON.parse(sessionStorage.getItem('evie.notified') || '[]')),
  form: null,
  audio: null,
};

const now = () => Date.now() + app.offset;
const clock = (ts) => new Date(ts - app.offset).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const mins = (ms) => {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
};
const countdown = (ts) => `<span data-until="${ts}">${fmtCountdown(ts)}</span>`;
function fmtCountdown(ts) {
  const left = ts - now();
  if (left <= 0) return 'now';
  const s = Math.ceil(left / 1000);
  return s >= 3600 ? mins(left) : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---- backend -------------------------------------------------------------------
async function api(name, body) {
  if (!app.backend) throw new Error('Still connecting…');
  await app.backend.action(name, body);
}

function accept(view) {
  app.view = view;
  app.offset = view.now - Date.now();
  localStorage.setItem('evie.last', JSON.stringify(view));
  render();
  handleDeepLink();
}

function setOnline(online) {
  app.online = online;
  const el = $('#conn');
  const demo = app.backend?.mode === 'demo' || app.view?.demo;
  el.textContent = online ? (demo ? 'Demo' : 'Live') : 'Offline — showing last known state';
  el.classList.toggle('offline', !online);
  document.querySelectorAll('main [data-action]').forEach((b) => {
    b.disabled = !online;
  });
}

// Sticker deep links: ?charger=N, or …/c/N when served from the offline cache.
let deepLink = (() => {
  const m = location.pathname.match(/\/c\/(\d+)\/?$/);
  const n = Number(m?.[1] ?? new URLSearchParams(location.search).get('charger'));
  return Number.isInteger(n) && n > 0 ? n : null;
})();
if (deepLink) {
  const params = new URLSearchParams(location.search);
  params.delete('charger');
  const qs = params.toString();
  history.replaceState(null, '', location.pathname.replace(/c\/\d+\/?$/, '') + (qs ? `?${qs}` : ''));
}

function handleDeepLink() {
  if (!deepLink || !app.backend) return;
  const id = deepLink;
  deepLink = null;
  const v = app.view;
  const ch = v.chargers.find((c) => c.id === id);
  if (!ch) return toast(`There's no charger ${id}.`);
  const mine = v.chargers.find((c) => c.session?.owner === v.me);
  if (mine) return toast(mine.id === id ? `You're checked in to charger ${id}.` : `You're already checked in to charger ${mine.id}.`);
  if (ch.status === 'free' || ch.reservedFor?.owner === v.me || ch.reservedFor?.addedBy === v.me) return openForm('checkin', id);
  toast(`Charger ${id} is in use by ${ch.session?.name ?? ch.reservedFor?.name}.`);
  if (!v.queue.some((q) => q.owner === v.me)) openForm('queue');
}

// ---- rendering -----------------------------------------------------------------
const youTag = (rec, me) =>
  rec.owner === me ? '<span class="you">You</span>' : rec.addedBy === me ? '<span class="you alt">Added by you</span>' : '';

function render() {
  const v = app.view;
  if (!v) return;
  const focused = document.activeElement?.closest?.('main [data-action]');
  const focusKey =
    focused &&
    `[data-action="${focused.dataset.action}"]${focused.dataset.charger ? `[data-charger="${focused.dataset.charger}"]` : ''}${focused.dataset.id ? `[data-id="${focused.dataset.id}"]` : ''}`;
  const me = v.me;
  const mine = v.chargers.find((ch) => ch.session?.owner === me);
  const myEntry = v.queue.find((q) => q.owner === me);

  $('#chargers').innerHTML = v.chargers.map((ch) => chargerCard(ch, me, mine)).join('');
  $('#queue').innerHTML = v.queue.length
    ? v.queue.map((q) => queueItem(q, me)).join('')
    : '<li class="empty"><span></span><span class="muted">Nobody waiting.</span><span></span></li>';

  const freeNow = v.chargers.some((ch) => ch.status === 'free');
  $('#join-queue').hidden = Boolean(mine || myEntry);
  $('#queue-hint').textContent = mine
    ? "You're charging."
    : myEntry
      ? ''
      : freeNow
        ? 'A charger is free — just plug in and check in on it above.'
        : 'All chargers are busy. Join the queue and EVIE will tell you when one is yours.';

  $('#demo').hidden = !v.demo;
  renderAlerts(v, mine, myEntry);
  renderRules(v.config);
  setOnline(app.online);
  if (focusKey && !document.activeElement?.closest?.('main [data-action]')) $(`main ${focusKey}`)?.focus();
}

function chargerCard(ch, me, mine) {
  const s = ch.session;
  const isMine = s?.owner === me;
  const manages = s && (isMine || s.addedBy === me);
  const label = { free: 'Free', reserved: 'Reserved', charging: 'Charging', swap: 'Swap requested' }[ch.status];
  let body = '';
  let actions = '';

  if (ch.status === 'free') {
    body = '<p class="note">Available now.</p>';
    if (!mine) actions = `<button class="btn primary" data-action="checkin" data-charger="${ch.id}">Check in</button>`;
  } else if (ch.status === 'reserved') {
    const r = ch.reservedFor;
    body = `<p class="who">${esc(r.name)}${youTag(r, me)}</p>
      <p class="note">Held for ${countdown(r.expiresAt)} — then offered to the next person.</p>`;
    if (r.owner === me) actions = `<button class="btn primary" data-action="checkin" data-charger="${ch.id}">I've plugged in</button>`;
    else if (r.addedBy === me) actions = `<button class="btn primary" data-action="checkin" data-charger="${ch.id}">Check ${esc(r.name)} in</button>`;
  } else {
    const pct = Math.max(0, Math.min(100, ((s.estRange - s.startRange) / (s.targetRange - s.startRange)) * 100));
    const t = now();
    const who = isMine ? 'Please unplug' : s.addedBy === me ? `Ask ${esc(s.name)} to unplug` : 'Asked to unplug';
    let note;
    if (s.swapRequestedAt) {
      const due = s.swapRequestedAt + app.view.config.swapGraceMinutes * 60_000;
      note = `<p class="note warn">${who}${s.swapFor ? ` for ${esc(s.swapFor)}` : ''} — ${due > t ? `within ${countdown(due)}` : 'overdue'}.</p>`;
    } else if (s.reachedTarget) {
      note = '<p class="note">Target reached — will be asked to swap if someone is waiting.</p>';
    } else if (t < s.protectedUntil) {
      note = `<p class="note">Guaranteed until ${clock(s.protectedUntil)}.</p>`;
    } else {
      note = '<p class="note">Guaranteed time used — may be asked to swap.</p>';
    }
    body = `<p class="who">${esc(s.name)}${youTag(s, me)}</p>
      <progress max="100" value="${pct.toFixed(0)}" aria-label="Charge progress towards target">${pct.toFixed(0)}%</progress>
      <dl class="facts">
        <dt>Range</dt><dd>~${s.estRange} of ${s.targetRange} mi</dd>
        <dt>Since</dt><dd>${clock(s.startedAt)} (${mins(t - s.startedAt)})</dd>
        <dt>Target by</dt><dd>~${clock(s.reachTargetAt)}</dd>
      </dl>${note}`;
    actions = manages
      ? `<button class="btn ${s.swapRequestedAt ? 'primary' : ''}" data-action="checkout" data-charger="${ch.id}">${isMine ? 'Unplugged — check out' : `${esc(s.name)} unplugged`}</button>
         <button class="btn ghost" data-action="update" data-charger="${ch.id}">Update range</button>`
      : `<button class="btn link" data-action="free" data-charger="${ch.id}" data-name="${esc(s.name)}">They've left — mark free</button>`;
  }

  const highlight = manages || ch.reservedFor?.owner === me || ch.reservedFor?.addedBy === me;
  return `<article class="charger ${ch.status}${highlight ? ' mine' : ''}" aria-labelledby="ch-${ch.id}">
    <header><h3 id="ch-${ch.id}">Charger ${ch.id}</h3><span class="badge">${label}</span></header>
    ${body}
    <div class="actions">${actions}</div>
  </article>`;
}

function queueItem(q, me) {
  const manages = q.owner === me || q.addedBy === me;
  const status = q.offer
    ? `<strong>Charger ${q.offer.chargerId} is ready</strong> — ${countdown(q.offer.expiresAt)} to plug in`
    : q.eta - now() < 60_000
      ? 'Next charger that frees up'
      : `Expected ~${clock(q.eta)} (in ${mins(q.eta - now())})`;
  return `<li class="${manages ? 'mine' : ''}">
    <span class="pos" aria-label="Position ${q.position}">${q.position}</span>
    <div>
      <div class="who">${esc(q.name)}${youTag(q, me)}
        ${q.urgent ? '<span class="tag-urgent"> · low range</span>' : ''}</div>
      <div class="meta">${q.currentRange} → ${q.targetRange} mi · ${status}</div>
    </div>
    ${manages
      ? `<button class="btn ghost" data-action="leave" data-id="${q.id}">${q.owner === me ? 'Leave' : 'Remove'}</button>`
      : `<button class="btn link" data-action="remove" data-id="${q.id}" data-name="${esc(q.name)}">Remove</button>`}
  </li>`;
}

function renderAlerts(v, mine, myEntry) {
  const me = v.me;
  const alerts = [];
  const alert = (html, button) => alerts.push(`<div class="alert"><div>${html}</div>${button}</div>`);

  if (myEntry?.offer) {
    const o = myEntry.offer;
    alert(
      `<strong>Charger ${o.chargerId} is yours.</strong><br>Plug in and check in within ${countdown(o.expiresAt)}.`,
      `<button class="btn primary" data-action="checkin" data-charger="${o.chargerId}">I've plugged in</button>`,
    );
    ping(`offer:${o.chargerId}:${o.offeredAt}`, `Charger ${o.chargerId} is yours`, `Plug in within ${v.config.offerMinutes} minutes.`);
  }
  if (mine?.session.swapRequestedAt) {
    const s = mine.session;
    alert(
      `<strong>Time to swap, please.</strong><br>${s.swapFor ? esc(s.swapFor) : 'Someone'} is waiting for charger ${mine.id}. You've had ${mins(now() - s.startedAt)} and ~${s.estRange} mi.`,
      `<button class="btn primary" data-action="checkout" data-charger="${mine.id}">Unplugged — check out</button>`,
    );
    ping(`swap:${s.id}:${s.swapRequestedAt}`, 'Please move your car', `${s.swapFor || 'Someone'} needs charger ${mine.id}.`);
  }
  // Alerts for people you added: you're their messenger.
  for (const q of v.queue.filter((e) => e.addedBy === me && e.offer)) {
    alert(
      `<strong>Charger ${q.offer.chargerId} is ready for ${esc(q.name)}.</strong><br>Let them know — it's held for ${countdown(q.offer.expiresAt)}.`,
      `<button class="btn primary" data-action="checkin" data-charger="${q.offer.chargerId}">Check ${esc(q.name)} in</button>`,
    );
    ping(`offer:${q.offer.chargerId}:${q.offer.offeredAt}`, `Charger ${q.offer.chargerId} is ready for ${q.name}`, 'Please let them know.');
  }
  for (const ch of v.chargers.filter((c) => c.session?.addedBy === me && c.session.swapRequestedAt)) {
    const s = ch.session;
    alert(
      `<strong>Ask ${esc(s.name)} to unplug charger ${ch.id}.</strong><br>${s.swapFor ? esc(s.swapFor) : 'Someone'} is waiting.`,
      `<button class="btn primary" data-action="checkout" data-charger="${ch.id}">${esc(s.name)} unplugged</button>`,
    );
    ping(`swap:${s.id}:${s.swapRequestedAt}`, `Ask ${s.name} to move their car`, `${s.swapFor || 'Someone'} needs charger ${ch.id}.`);
  }

  $('#alerts').innerHTML = alerts.join('');
  document.title = alerts.length ? '🔔 EVIE · Action needed' : 'EVIE · Office EV charging';
}

function renderRules(c) {
  const mph = Math.round(c.chargerKw * c.milesPerKwh);
  $('#rules').innerHTML = [
    'Mornings are first come, first served: plug into any free charger and check in.',
    `Everyone gets at least <strong>${mins(c.minSessionMinutes * 60_000)}</strong> before they can be asked to swap (sooner only if they've reached their target).`,
    `When someone is waiting, the person who needs the <strong>fewest extra miles</strong> is asked to swap; anyone over <strong>${mins(c.maxSessionMinutes * 60_000)}</strong> goes first.`,
    `When a charger frees up it's held for the next person in the queue for <strong>${c.offerMinutes} min</strong>, then passed on.`,
    `People under ${c.urgentRangeMiles} mi of range move to the front of the queue.`,
    "You can add a colleague to the queue. You'll get their alerts, and they can also claim their charger by checking in with the same name.",
    `Estimates assume ${c.chargerKw} kW ≈ ${mph} miles per hour of charging. Use “Update range” to correct them.`,
    'No accounts: your device remembers you, and everything resets overnight.',
  ]
    .map((r) => `<li>${r}</li>`)
    .join('');
}

function tickCountdowns() {
  document.querySelectorAll('[data-until]').forEach((el) => {
    el.textContent = fmtCountdown(Number(el.dataset.until));
  });
}

// ---- notifications -------------------------------------------------------------
async function showNotification(title, body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const opts = { body, icon: 'icon.svg', badge: 'icon.svg', tag, requireInteraction: true };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, opts);
      return true;
    }
  } catch {
    /* fall through */
  }
  new Notification(title, opts);
  return true;
}

function ping(key, title, body) {
  if (app.notified.has(key)) return;
  app.notified.add(key);
  sessionStorage.setItem('evie.notified', JSON.stringify([...app.notified].slice(-50)));
  beep();
  navigator.vibrate?.([200, 100, 200]);
  showNotification(title, body, key);
}

function beep() {
  try {
    app.audio ??= new AudioContext();
    const ctx = app.audio;
    [0, 0.25].forEach((t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.2);
    });
  } catch {
    /* audio unavailable */
  }
}

const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function renderNotify() {
  const status = $('#notify-status');
  const enable = $('#notify-btn');
  const test = $('#notify-test');
  enable.hidden = true;
  test.hidden = true;
  if (!window.isSecureContext) {
    status.innerHTML = 'Notifications need <strong>HTTPS</strong>. Open EVIE over an <code>https://</code> address to turn them on. Until then EVIE beeps and flashes this tab.';
  } else if (!('Notification' in window)) {
    status.textContent = isIos && !isStandalone
      ? 'On iPhone or iPad, tap Share → Add to Home Screen, then open EVIE from your home screen to turn on notifications.'
      : "This browser doesn't support notifications. EVIE will still beep and flash this tab.";
  } else if (Notification.permission === 'granted') {
    status.innerHTML = "<strong>On ✓</strong> You'll be notified when a charger is ready for you or it's time to swap. Keep EVIE open in a tab, or install it as an app.";
    test.hidden = false;
  } else if (Notification.permission === 'denied') {
    status.textContent = 'Blocked. Allow notifications for this site in your browser settings, then reload.';
  } else {
    status.textContent = "Get a notification when a charger is ready for you or when it's time to swap.";
    enable.hidden = false;
  }
}

function setupNotify() {
  $('#notify-btn').addEventListener('click', async () => {
    const result = await Notification.requestPermission();
    renderNotify();
    if (result === 'granted') {
      showNotification('EVIE notifications are on', "We'll let you know when it's your turn.", 'evie-welcome');
      $('#notify-test').focus();
    }
  });
  $('#notify-test').addEventListener('click', async () => {
    beep();
    const ok = await showNotification('Test from EVIE ⚡', 'This is what a swap or charger-ready alert looks like.', `test-${Date.now()}`);
    toast(ok ? 'Test notification sent.' : 'Notifications are not enabled.');
  });
  renderNotify();
}

// ---- form ----------------------------------------------------------------------
const FORM_COPY = {
  checkin: { title: (id) => `Check in to charger ${id}`, submit: 'Check in', action: 'checkin' },
  queue: { title: () => 'Join the queue', submit: 'Join queue', action: 'queue/join' },
  guest: { title: () => 'Add someone to the queue', submit: 'Add to queue', action: 'queue/join' },
  update: { title: (id) => `Update charger ${id}`, submit: 'Save', action: 'session/update' },
};

function openForm(mode, chargerId) {
  const v = app.view;
  const form = $('#entry-form');
  const copy = FORM_COPY[mode];
  const charger = v.chargers.find((ch) => ch.id === chargerId);
  const proxyFor = mode === 'checkin' && charger?.reservedFor?.addedBy === v.me ? charger.reservedFor : null;
  app.form = { mode, chargerId, proxy: Boolean(proxyFor) };
  form.reset();
  $('#form-title').textContent = proxyFor ? `Check ${proxyFor.name} in to charger ${chargerId}` : copy.title(chargerId);
  $('#form-submit').textContent = copy.submit;
  $('#form-error').textContent = '';
  $('#form-sub').textContent =
    {
      queue: "EVIE will alert you here when it's your turn — keep this page open.",
      guest: "For a colleague without EVIE. You'll get their alerts, so please pass them on. They can also check in themselves using the same name.",
    }[mode] ?? (proxyFor ? "Confirm their range. You'll get their swap alerts." : '');

  const remembered = JSON.parse(localStorage.getItem('evie.me') || '{}');
  if (mode !== 'guest') {
    form.name.value = remembered.name || '';
    form.targetRange.value = remembered.targetRange || '';
  }
  const entry = proxyFor ? v.queue.find((q) => q.id === proxyFor.id) : mode !== 'guest' && v.queue.find((q) => q.owner === v.me);
  if (entry) {
    form.name.value = entry.name;
    form.currentRange.value = entry.currentRange;
    form.targetRange.value = entry.targetRange;
  }
  if (mode === 'update' && charger?.session) {
    form.currentRange.value = charger.session.estRange;
    form.targetRange.value = charger.session.targetRange;
  }
  form.name.readOnly = Boolean(proxyFor);
  form.name.closest('label').hidden = mode === 'update';
  $('#name-label').textContent = mode === 'guest' || proxyFor ? 'Their name' : 'Your name';
  updateEstimate();
  $('#form-dialog').showModal();
  (mode === 'update' || form.name.value ? form.currentRange : form.name).focus();
}

function updateEstimate() {
  const form = $('#entry-form');
  const c = app.view?.config;
  const cur = Number(form.currentRange.value);
  const tgt = Number(form.targetRange.value);
  if (!c || !form.currentRange.value || !form.targetRange.value || tgt <= cur) {
    $('#form-estimate').textContent = '';
    return;
  }
  const ms = ((tgt - cur) / (c.chargerKw * c.milesPerKwh)) * 3_600_000;
  const over = ms > c.minSessionMinutes * 60_000;
  $('#form-estimate').textContent =
    `≈ ${mins(ms)} to add ${tgt - cur} mi.` +
    (over ? ` Guaranteed ${mins(c.minSessionMinutes * 60_000)}; after that a swap may be requested if someone is waiting.` : '');
}

async function submitForm(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const { mode, chargerId, proxy } = app.form;
  const body = {
    name: form.name.value,
    currentRange: form.currentRange.value,
    targetRange: form.targetRange.value,
    chargerId,
    forSomeoneElse: mode === 'guest',
  };
  const submit = $('#form-submit');
  submit.disabled = true;
  try {
    await api(FORM_COPY[mode].action, body);
    if ((mode === 'checkin' || mode === 'queue') && !proxy) {
      localStorage.setItem('evie.me', JSON.stringify({ name: body.name.trim(), targetRange: body.targetRange }));
    }
    $('#form-dialog').close();
    toast({ queue: "You're in the queue.", guest: `${body.name.trim()} is in the queue.` }[mode] ?? 'Saved.');
  } catch (err) {
    $('#form-error').textContent = err.message;
  } finally {
    submit.disabled = false;
  }
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 3000);
}

// ---- events --------------------------------------------------------------------
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action } = btn.dataset;
  const chargerId = Number(btn.dataset.charger);
  try {
    if (action === 'close-form') return $('#form-dialog').close();
    if (action === 'checkin') return openForm('checkin', chargerId);
    if (action === 'queue') return openForm('queue');
    if (action === 'guest') return openForm('guest');
    if (action === 'update') return openForm('update', chargerId);
    if (action === 'checkout') {
      await api('checkout', { chargerId });
      return toast('Checked out. Thanks!');
    }
    if (action === 'free' && confirm(`Mark charger ${chargerId} as free? Only do this if ${btn.dataset.name} has unplugged.`)) {
      await api('checkout', { chargerId, force: true });
      return toast(`Charger ${chargerId} marked free.`);
    }
    if (action === 'leave') {
      await api('queue/leave', { id: btn.dataset.id });
      return toast('Removed from the queue.');
    }
    if (action === 'remove' && confirm(`Remove ${btn.dataset.name} from the queue?`)) {
      await api('queue/leave', { id: btn.dataset.id, force: true });
    }
    if (action === 'ff') {
      app.backend.fastForward(30);
      return toast('Demo clock moved forward 30 minutes.');
    }
    if (action === 'reset-demo' && confirm('Clear all demo data?')) {
      app.backend.reset();
      return toast('Demo reset.');
    }
  } catch (err) {
    toast(err.message);
  }
});

$('#entry-form').addEventListener('submit', submitForm);
$('#entry-form').addEventListener('input', updateEstimate);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) app.audio?.resume?.();
});

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

setupNotify();
render();
setInterval(tickCountdowns, 1000);
setInterval(render, 30_000); // refresh relative estimates between pushes

connectBackend({ clientId: CLIENT, onView: accept, onStatus: setOnline }).then((backend) => {
  app.backend = backend;
  setOnline(app.online);
  handleDeepLink();
});
