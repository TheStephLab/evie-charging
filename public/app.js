import { connectBackend } from './backend.js';
import { initShell } from './shell.js';

initShell();

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
  return s >= 3600 ? mins(left) : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
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
  el.textContent = online ? (demo ? 'Demo' : 'Live') : 'Offline';
  el.title = online ? '' : 'Offline — showing the last known state';
  el.dataset.state = online ? (demo ? 'demo' : 'live') : app.backend ? 'offline' : 'connecting';
  document.querySelectorAll('main [data-action]').forEach((b) => {
    b.disabled = !online;
  });
  if (app.view && queueFull(app.view)) ['#join-queue', '#guest-btn'].forEach((s) => ($(s).disabled = true));
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
  if (ch.status === 'free') return openForm('checkin', id);
  toast(`Charger ${id} is in use by ${ch.session?.name}.`);
  if (!v.queue.some((q) => q.owner === v.me)) openForm('queue');
}

// ---- rendering -----------------------------------------------------------------
const youTag = (rec, me) =>
  rec.owner === me ? '<span class="tag">You</span>' : rec.addedBy === me ? '<span class="tag outline">Added by you</span>' : '';

function renderMetrics(v) {
  const t = now();
  const free = v.chargers.filter((ch) => ch.status === 'free').length;
  const charging = v.chargers.filter((ch) => ch.session).length;
  const waiting = v.queue.length;
  let next = 'Now';
  let nextNote = 'A charger is free';
  if (!free) {
    const times = v.chargers.map((ch) =>
      ch.session ? (ch.session.swapRequestedAt ? t : Math.max(t, ch.session.eligibleAt)) : t,
    );
    const soonest = Math.min(...times);
    next = soonest - t < 60_000 ? 'Soon' : clock(soonest);
    nextNote = waiting ? `Estimate; ${waiting} ahead of a new arrival` : 'Estimated next charger';
  }
  const metric = (title, value, note, suffix = '') =>
    `<div class="metric"><div class="metric-top">${title}</div><strong>${value}${suffix ? `<small>${suffix}</small>` : ''}</strong><small>${note}</small></div>`;
  const full = queueFull(v);
  const required = v.chargers.filter((ch) => ch.session?.need === 'required').length;
  $('#metrics').innerHTML = [
    metric('Free now', free, free ? 'Plug in and check in' : 'All chargers in use', `of ${v.chargers.length}`),
    metric('Charging', charging, charging ? `${required} need it to get home · ${charging - required} top-up` : 'Nobody charging'),
    metric('In the queue', waiting, full ? `Full (maximum ${v.config.maxQueue})` : waiting ? 'Waiting for a charger' : 'Nobody waiting'),
    metric('Next charger', next, nextNote),
  ].join('');
  $('#metrics .metric')?.classList.toggle('lit', free > 0);
  $('#chargers-count').textContent = `${free} of ${v.chargers.length} free`;
  $('#queue-count').textContent = waiting ? (full ? `${waiting} waiting · full` : `${waiting} waiting`) : '';
  $('#queue-count').className = `badge${full ? ' amber' : ''}`;
  $('#updated').textContent = `Updated ${clock(v.now)}`;
}

const queueFull = (v) => Boolean(v.config.maxQueue > 0 && v.queue.length >= v.config.maxQueue);

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
    : '<tr class="empty"><td colspan="5">Nobody waiting.</td></tr>';
  renderMetrics(v);

  const freeNow = v.chargers.some((ch) => ch.status === 'free');
  const full = queueFull(v);
  $('#join-queue').hidden = Boolean(mine || myEntry);
  $('#join-queue').disabled = full || !app.online;
  $('#queue-hint').textContent = mine
    ? "You're charging."
    : myEntry
      ? ''
      : freeNow
        ? 'A charger is free — just plug in and check in on it above.'
        : full
          ? `The queue is full (${v.config.maxQueue} waiting). Please check back when someone has had their turn.`
          : 'All chargers are busy. Join the queue and EVIE will tell you when one is yours.';

  $('#demo').hidden = !v.demo;
  const f = v.features ?? {};
  $('#guest-btn').hidden = !f.addSomeoneElse;
  $('#guest-btn').disabled = full || !app.online;
  $('#notify-panel').hidden = !f.browserNotifications;
  document.querySelectorAll('[data-nav="notify"]').forEach((a) => (a.hidden = !f.browserNotifications));
  renderAlerts(v, mine, myEntry);
  renderRules(v.config);
  setOnline(app.online);
  if (focusKey && !document.activeElement?.closest?.('main [data-action]')) $(`main ${focusKey}`)?.focus();
}

function chargerCard(ch, me, mine) {
  const s = ch.session;
  const isMine = s?.owner === me;
  const manages = s && (isMine || s.addedBy === me);
  const label = { free: 'Free', charging: 'Charging', swap: 'Swap requested' }[ch.status];
  const tone = { free: 'success', charging: 'blue', swap: 'red' }[ch.status];
  let body = '';
  let actions = '';
  const nextUp = app.view.queue.find((q) => q.alert?.chargerId === ch.id);

  if (ch.status === 'free') {
    body = `<p class="note">Available now. First come, first served.</p>${
      nextUp ? `<p class="note">${esc(nextUp.name)} is next in the queue and has been told.</p>` : ''
    }`;
    if (!mine) actions = `<button class="btn primary" data-action="checkin" data-charger="${ch.id}">Check in</button>`;
    // People you added can be checked in on any free charger.
    for (const q of app.view.queue.filter((e) => e.addedBy === me)) {
      actions += `<button class="btn" data-action="checkin" data-charger="${ch.id}" data-entry="${q.id}">Check ${esc(q.name)} in</button>`;
    }
  } else {
    const t = now();
    const adv = app.view.features?.advancedScheduling;
    const who = isMine ? 'Please unplug' : s.addedBy === me ? `Ask ${esc(s.name)} to unplug` : 'Asked to unplug';
    let note = '';
    if (s.swapRequestedAt) {
      const due = s.swapRequestedAt + app.view.config.swapGraceMinutes * 60_000;
      note = `<p class="note warn">${who}${s.swapFor ? ` for ${esc(s.swapFor)}` : ''} — ${due > t ? `within ${countdown(due)}` : 'overdue'}.</p>`;
    } else if (adv && t < s.protectedUntil) {
      note = `<p class="note">Guaranteed until ${clock(s.protectedUntil)}.</p>`;
    } else if (adv) {
      note = `<p class="note">${s.need === 'required' ? 'Guaranteed time used. Only asked to swap for someone who also needs it to get home.' : 'Guaranteed time used. May be asked to swap if someone is waiting.'}</p>`;
    }
    const guaranteed = app.view.config.minSessionMinutes * 60_000;
    const pct = Math.max(0, Math.min(100, ((t - s.startedAt) / guaranteed) * 100));
    body = `<p class="who">${esc(s.name)}${youTag(s, me)}</p>
      <p>${needBadge(s.need)}</p>
      <dl class="facts">
        <dt>Since</dt><dd>${clock(s.startedAt)} (${mins(t - s.startedAt)})</dd>
      </dl>
      ${adv && !s.swapRequestedAt ? `<progress max="100" value="${pct.toFixed(0)}" aria-label="Guaranteed charging time used">${pct.toFixed(0)}%</progress>` : ''}${note}`;
    actions = manages
      ? `<button class="btn ${s.swapRequestedAt ? 'primary' : ''}" data-action="checkout" data-charger="${ch.id}">${isMine ? 'Unplugged — check out' : `${esc(s.name)} unplugged`}</button>`
      : `<button class="btn link" data-action="free" data-charger="${ch.id}" data-name="${esc(s.name)}">They've left — mark free</button>`;
  }

  const highlight = manages || (nextUp && (nextUp.owner === me || nextUp.addedBy === me));
  return `<article class="charger-card${highlight ? ' mine' : ''}" data-status="${ch.status}" aria-labelledby="ch-${ch.id}">
    <header><h3 id="ch-${ch.id}"><span class="ch-label">Charger</span> <span class="ch-num">${ch.id}</span></h3><span class="badge ${tone}">${label}</span></header>
    ${body}
    <div class="actions">${actions}</div>
  </article>`;
}

function queueItem(q, me) {
  const manages = q.owner === me || q.addedBy === me;
  const status = q.alert
    ? `<span class="badge success">Charger ${q.alert.chargerId} is free</span> First to check in gets it`
    : q.eta - now() < 60_000
      ? 'Next charger that frees up'
      : `Expected ~${clock(q.eta)} <span class="muted">(in ${mins(q.eta - now())})</span>`;
  return `<tr class="${manages ? 'mine' : ''}">
    <td class="pos">${q.position}</td>
    <td><span class="who">${esc(q.name)}</span>${youTag(q, me)}</td>
    <td class="need-cell">${needBadge(q.need)}</td>
    <td>${status}</td>
    <td class="act">${manages
      ? `<button class="btn" data-action="leave" data-id="${q.id}">${q.owner === me ? 'Leave' : 'Remove'}</button>`
      : `<button class="btn link" data-action="remove" data-id="${q.id}" data-name="${esc(q.name)}">Remove</button>`}</td>
  </tr>`;
}

function renderAlerts(v, mine, myEntry) {
  const me = v.me;
  const alerts = [];
  const alert = (html, button) => alerts.push(`<div class="notice warning"><div>${html}</div>${button}</div>`);

  if (myEntry?.alert && !mine) {
    const a = myEntry.alert;
    alert(
      `<strong>Charger ${a.chargerId} is free and you're next.</strong><br>Chargers aren't reserved: whoever plugs in and checks in first gets it.`,
      `<button class="btn primary" data-action="checkin" data-charger="${a.chargerId}">I've plugged in</button>`,
    );
    ping(`free:${a.chargerId}:${a.at}`, `Charger ${a.chargerId} is free`, "You're next in the queue. First to check in gets it.");
  }
  if (mine?.session.swapRequestedAt) {
    const s = mine.session;
    alert(
      `<strong>Time to swap, please.</strong><br>${s.swapFor ? esc(s.swapFor) : 'Someone'} is waiting for charger ${mine.id}. You've been charging for ${mins(now() - s.startedAt)}.`,
      `<button class="btn primary" data-action="checkout" data-charger="${mine.id}">Unplugged — check out</button>`,
    );
    ping(`swap:${s.id}:${s.swapRequestedAt}`, 'Please move your car', `${s.swapFor || 'Someone'} needs charger ${mine.id}.`);
  }
  // Alerts for people you added: you're their messenger.
  for (const q of v.queue.filter((e) => e.addedBy === me && e.alert)) {
    alert(
      `<strong>Charger ${q.alert.chargerId} is free and ${esc(q.name)} is next.</strong><br>Let them know. It isn't reserved, so the first to check in gets it.`,
      `<button class="btn primary" data-action="checkin" data-charger="${q.alert.chargerId}" data-entry="${q.id}">Check ${esc(q.name)} in</button>`,
    );
    ping(`free:${q.alert.chargerId}:${q.alert.at}:${q.id}`, `Charger ${q.alert.chargerId} is free for ${q.name}`, 'Please let them know.');
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
  document.title = alerts.length ? '🔔 Action needed · EV charging' : 'EV charging · 101 Science Park Hub';
}

function renderRules(c) {
  const f = app.view?.features ?? {};
  const rules = [
    'Mornings are first come, first served: plug into any free charger and check in.',
    "When you check in or join the queue, say whether it's a <strong>top-up</strong> or you <strong>need it to get home</strong>. Please be honest, it's what keeps this fair.",
  ];
  if (f.advancedScheduling) {
    rules.push(
      `Everyone gets at least <strong>${mins(c.minSessionMinutes * 60_000)}</strong> before they can be asked to swap.`,
      `When someone is waiting, <strong>top-ups are asked to swap first</strong>. Anyone charging for over <strong>${mins(c.maxSessionMinutes * 60_000)}</strong> goes before that.`,
      'People who need a charge to get home go to the front of the queue, and are only asked to swap for someone else who needs it to get home.',
    );
  } else {
    rules.push('If all chargers are busy, join the queue. Please unplug and check out once you have the charge you need.');
  }
  rules.push("Chargers are never reserved. When one frees up, the next person in the queue is alerted, but it goes to whoever plugs in and checks in first.");
  rules.push(`Up to <strong>${c.maxQueue}</strong> people can wait in the queue. People already charging don't count towards this.`);
  if (f.addSomeoneElse) {
    rules.push("You can add a colleague to the queue. You'll get their alerts, and they can also claim their charger by checking in with the same name.");
  }
  if (f.email) rules.push("Add your email when you check in or queue, and EVIE will email you when it's your turn. It's deleted overnight.");
  rules.push('No accounts: your device remembers you, and everything resets overnight.');
  $('#rules').innerHTML = rules.map((r) => `<li>${r}</li>`).join('');
}

function needBadge(need) {
  return need === 'required'
    ? '<span class="badge need-required">Needs it to get home</span>'
    : '<span class="badge need-topup">Top-up</span>';
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
  if (!app.view?.features?.browserNotifications) return; // in-page banner only
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
  checkin: { title: (id) => `Check in to charger ${id}`, action: 'checkin' },
  queue: { title: () => 'Join the queue', action: 'queue/join' },
  guest: { title: () => 'Add someone to the queue', action: 'queue/join' },
};

function openForm(mode, chargerId, entryId) {
  const v = app.view;
  const form = $('#entry-form');
  const copy = FORM_COPY[mode];
  const proxyFor = mode === 'checkin' && entryId ? v.queue.find((q) => q.id === entryId && q.addedBy === v.me) : null;
  app.form = { mode, chargerId, proxy: Boolean(proxyFor), entryId: proxyFor?.id };
  form.reset();
  $('#form-title').textContent = proxyFor ? `Check ${proxyFor.name} in to charger ${chargerId}` : copy.title(chargerId);
  $('#form-error').textContent = '';
  $('#form-sub').textContent =
    {
      queue: "EVIE will alert you here when it's your turn — keep this page open.",
      guest: "For a colleague without EVIE. You'll get their alerts, so please pass them on. They can also check in themselves using the same name.",
    }[mode] ?? (proxyFor ? "You'll get their swap alerts, so please pass them on." : '');

  const remembered = JSON.parse(localStorage.getItem('evie.me') || '{}');
  const entry = proxyFor ?? (mode !== 'guest' ? v.queue.find((q) => q.owner === v.me) : null);
  form.name.value = entry?.name ?? (mode !== 'guest' ? remembered.name || '' : '');
  form.name.readOnly = Boolean(proxyFor);
  $('#name-label').textContent = mode === 'guest' || proxyFor ? 'Their name' : 'Your name';
  $('#need-legend').textContent = mode === 'guest' || proxyFor ? 'What kind of charge do they need?' : 'What kind of charge is it?';
  $('#need-hint').textContent = { checkin: 'Tap one to check in.', queue: 'Tap one to join the queue.', guest: 'Tap one to add them to the queue.' }[mode];
  form.querySelectorAll('.need-btn').forEach((btn) => {
    btn.classList.toggle('chosen', btn.value === entry?.need);
    btn.disabled = false;
  });
  const showEmail = Boolean(v.features?.email) && !proxyFor;
  form.email.closest('label').hidden = !showEmail;
  form.email.value = showEmail && mode !== 'guest' ? remembered.email || '' : '';
  $('#email-label').textContent = mode === 'guest' ? 'Their email (optional)' : 'Email for alerts (optional)';
  $('#form-dialog').showModal();
  const chosen = form.querySelector('.need-btn.chosen');
  (form.name.value ? (chosen ?? form.querySelector('.need-btn')) : form.name).focus();
}

async function submitForm(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const { mode, chargerId, proxy, entryId } = app.form;
  const need = e.submitter?.value;
  if (!need) return; // Enter in the name field: wait for a choice.
  if (!form.name.value.trim()) {
    $('#form-error').textContent = 'Please enter a name.';
    return form.name.focus();
  }
  const body = {
    name: form.name.value,
    need,
    chargerId,
    entryId,
    forSomeoneElse: mode === 'guest',
    email: form.email.closest('label').hidden ? undefined : form.email.value.trim(),
  };
  const buttons = form.querySelectorAll('.need-btn');
  buttons.forEach((b) => (b.disabled = true));
  try {
    await api(FORM_COPY[mode].action, body);
    if ((mode === 'checkin' || mode === 'queue') && !proxy) {
      const me = { name: body.name.trim() };
      me.email = body.email !== undefined ? body.email : JSON.parse(localStorage.getItem('evie.me') || '{}').email;
      localStorage.setItem('evie.me', JSON.stringify(me));
    }
    $('#form-dialog').close();
    toast(
      { queue: "You're in the queue.", guest: `${body.name.trim()} is in the queue.` }[mode] ??
        (proxy ? `${form.name.value.trim()} is checked in.` : 'Checked in. Happy charging!'),
    );
  } catch (err) {
    $('#form-error').textContent = err.message;
  } finally {
    buttons.forEach((b) => (b.disabled = false));
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
    if (action === 'checkin') return openForm('checkin', chargerId, btn.dataset.entry);
    if (action === 'queue') return openForm('queue');
    if (action === 'guest') return openForm('guest');
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
// Enter in a text field would otherwise submit the first choice (Top-up) by default.
$('#entry-form').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
  e.preventDefault();
  const form = e.currentTarget;
  (form.querySelector('.need-btn.chosen') ?? form.querySelector('.need-btn')).focus();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) app.audio?.resume?.();
});

setupNotify();
render();
setInterval(tickCountdowns, 1000);
setInterval(render, 30_000); // refresh relative estimates between pushes

connectBackend({ clientId: CLIENT, onView: accept, onStatus: setOnline }).then((backend) => {
  app.backend = backend;
  setOnline(app.online);
  handleDeepLink();
});
