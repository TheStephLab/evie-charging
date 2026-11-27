import {
  FEATURES,
  TUNING,
  REQUIREMENT_HELP,
  DEMO_SETTINGS_KEY,
  DEMO_TOKEN,
  cleanSettings,
  loadSettings,
} from './settings.js';
import { DEFAULT_CONFIG } from './scheduler.js';
import { initShell } from './shell.js';
import { VISITOR_SECTIONS, VISITOR_FIELDS, MAX_FIELD_LENGTH } from './visitor.js';
import { fetchVisitor, saveDemoVisitor, visitorText } from './visitor-data.js';

initShell();

const $ = (sel) => document.querySelector(sel);
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const TOKEN_KEY = 'evie.admin';

// A settings link can carry the token in the URL fragment, which is never sent to the server.
const fromHash = new URLSearchParams(location.hash.slice(1)).get('token');
if (fromHash) {
  sessionStorage.setItem(TOKEN_KEY, fromHash);
  history.replaceState(null, '', location.pathname + location.search);
}

let backend = null;
let view = null;

// ---- backends --------------------------------------------------------------------
const serverBackend = {
  mode: 'server',
  async call(method, pathName, body) {
    const res = await fetch(`api/admin/${pathName}`, {
      method,
      headers: { authorization: `Bearer ${sessionStorage.getItem(TOKEN_KEY) ?? ''}`, 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
    return data;
  },
  load() {
    return this.call('GET', 'settings');
  },
  save(settings) {
    return this.call('POST', 'settings', settings);
  },
  testEmail(to) {
    return this.call('POST', 'test-email', { to });
  },
  saveVisitor(input) {
    return this.call('POST', 'visitor', input);
  },
};

const demoBackend = {
  mode: 'demo',
  view(settings) {
    return { settings, base: DEFAULT_CONFIG, caps: { smtp: false, webhook: false }, smtp: null };
  },
  async load() {
    if (sessionStorage.getItem(TOKEN_KEY) !== DEMO_TOKEN) throw Object.assign(new Error('That token is not valid.'), { status: 401 });
    return this.view(loadSettings(JSON.parse(localStorage.getItem(DEMO_SETTINGS_KEY) || 'null'), DEFAULT_CONFIG));
  },
  async save(input) {
    const current = (await this.load()).settings;
    const next = cleanSettings(input, current);
    localStorage.setItem(DEMO_SETTINGS_KEY, JSON.stringify(next));
    return this.view(next);
  },
  async saveVisitor(input) {
    await this.load(); // token check
    return saveDemoVisitor(input);
  },
};

async function detect() {
  try {
    const res = await fetch('api/admin/settings', { cache: 'no-store' });
    if (res.headers.get('content-type')?.includes('application/json')) return serverBackend;
  } catch {
    /* offline or static */
  }
  return demoBackend;
}

// ---- rendering -------------------------------------------------------------------
function showLocked(message = '') {
  $('#locked').hidden = false;
  $('#settings-form').hidden = true;
  $('#unlock-error').textContent = message;
  $('#token-help').innerHTML =
    backend.mode === 'demo'
      ? 'This is the demo on a static host, so settings only affect <strong>this browser</strong>. A static site can\'t keep a secret, so the demo token is <code>demo</code>. On the EVIE server the token is a long random secret.'
      : 'Settings are protected by an admin token rather than an account. Use the settings link printed when the server first started, the <code>data/admin-token</code> file, or the <code>ADMIN_TOKEN</code> environment variable.';
  $('#unlock-form').token.focus();
}

function render() {
  const { settings, caps, smtp } = view;
  $('#locked').hidden = true;
  $('#settings-form').hidden = false;
  renderVisitorEditor();

  $('#features').innerHTML = FEATURES.map((f) => {
    const missing = f.requires && !caps[f.requires];
    const id = `f-${f.key}`;
    return `<div class="switch-row">
      <input type="checkbox" role="switch" id="${id}" name="${f.key}" ${settings.features[f.key] ? 'checked' : ''} aria-describedby="${id}-d">
      <label for="${id}"><strong>${esc(f.label)}</strong></label>
      <p id="${id}-d" class="muted">${esc(f.description)}${missing ? `<br><span class="req badge amber">${esc(REQUIREMENT_HELP[f.requires])} It stays inactive until then.</span>` : ''}</p>
    </div>`;
  }).join('');

  const adv = settings.features.advancedScheduling;
  const field = (t) => `<label>${esc(t.label)} (${t.unit})
      <input type="number" name="${t.key}" min="${t.min}" max="${t.max}" value="${settings.tuning[t.key]}" inputmode="numeric" required>
    </label>`;
  $('#tuning').innerHTML = `${TUNING.filter((t) => !t.advanced).map(field).join('')}
    <fieldset id="adv-fields" ${adv ? '' : 'disabled'} aria-label="Advanced scheduling">${TUNING.filter((t) => t.advanced).map(field).join('')}</fieldset>
    <p class="muted" id="adv-note" ${adv ? 'hidden' : ''}>Turn on Advanced scheduling to use the swap settings.</p>`;

  if (smtp) {
    $('#smtp-status').innerHTML = `<span class="badge success">Configured</span> ${esc(smtp.host)}:${smtp.port} (${smtp.secure ? 'TLS' : 'STARTTLS'}${smtp.auth ? ', authenticated' : ''}), sending as <code>${esc(smtp.from)}</code>.`;
  } else {
    $('#smtp-status').innerHTML =
      backend.mode === 'demo'
        ? '<span class="badge amber">Not available in the demo</span> Email needs the EVIE server, because SMTP credentials can\'t be kept safe in a browser.'
        : '<span class="badge amber">Not configured</span> Set <code>SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code> and <code>SMTP_FROM</code> on the server, then restart it.';
  }
  $('#test-email').hidden = !smtp;
  renderWebhook();
}

function renderWebhook() {
  const hook = view.webhook;
  const status = $('#webhook-status');
  if (backend.mode === 'demo') {
    status.innerHTML =
      '<span class="badge amber">Not available in the demo</span> Posting to Teams needs the EVIE server: the browser can\'t keep the webhook URL secret.';
    $('#webhook-fields').hidden = true;
    return;
  }
  $('#webhook-fields').hidden = false;
  const on = view.settings.features.teamWebhook;
  const fmt = { teams: 'Microsoft Teams card', text: 'plain text' };
  status.innerHTML = hook
    ? `<span class="badge success">Configured</span> <code>${esc(hook.masked)}</code> · ${fmt[hook.resolvedFormat]}${hook.source === 'env' ? ' · from the <code>WEBHOOK_URL</code> environment variable (saving here overrides it)' : ''}${on ? '' : '<br><span class="badge amber wrap">Turn on “Team chat webhook” under Features and save to start posting.</span>'}`
    : '<span class="badge">Not configured</span> Paste a webhook URL to post free-charger alerts and swap requests to a channel.';
  $('#webhook-format').value = hook && hook.source === 'settings' ? hook.format : 'auto';
  $('#webhook-clear').hidden = !(hook && hook.source === 'settings');
  $('#webhook-url').placeholder = hook ? 'Paste a new URL to replace it' : 'https://…';
}

async function webhookAction(name, body, done) {
  $('#webhook-error').textContent = '';
  const buttons = ['#webhook-save', '#webhook-test', '#webhook-clear'].map((s) => $(s));
  buttons.forEach((b) => (b.disabled = true));
  try {
    const result = await backend.call('POST', name, body);
    if (result.settings) {
      view = result;
      renderWebhook();
      // The feature list depends on whether a webhook exists.
      const form = $('#settings-form');
      const pending = collect();
      render();
      for (const f of FEATURES) form.elements[f.key].checked = pending.features[f.key];
    }
    done(result);
  } catch (err) {
    if (err.status === 401) return showLocked(err.message);
    $('#webhook-error').textContent = err.message;
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

const webhookBody = () => ({ url: $('#webhook-url').value.trim(), format: $('#webhook-format').value });

// ---- visitor centre editor ------------------------------------------------------
let visitorLoaded = false;
async function renderVisitorEditor() {
  if (visitorLoaded) return; // keep unsaved edits when other settings are saved
  visitorLoaded = true;
  const { data } = await fetchVisitor();
  const text = visitorText(data);
  $('#visitor-editor').innerHTML = VISITOR_SECTIONS.map(
    (s) => `<div class="editor-section"><h3>${esc(s.title)}</h3><div class="editor-grid">${s.fields
      .map(
        (f) => `<label>${esc(f.label)}
          <textarea name="v-${f.key}" maxlength="${MAX_FIELD_LENGTH}" rows="4" aria-describedby="v-${f.key}-hint">${esc(text[f.key])}</textarea>
          <small class="hint" id="v-${f.key}-hint">${esc(f.hint)}${f.default ? ' Clear it to go back to the guide’s wording.' : ''}</small>
        </label>`,
      )
      .join('')}</div></div>`,
  ).join('');
}

$('#visitor-save').addEventListener('click', async () => {
  $('#visitor-error').textContent = '';
  const fields = Object.fromEntries(VISITOR_FIELDS.map((f) => [f.key, document.querySelector(`[name="v-${f.key}"]`).value]));
  $('#visitor-save').disabled = true;
  try {
    await backend.saveVisitor({ fields });
    toast('Visitor information saved.');
  } catch (err) {
    if (err.status === 401) return showLocked(err.message);
    $('#visitor-error').textContent = err.message;
  } finally {
    $('#visitor-save').disabled = false;
  }
});

$('#webhook-save').addEventListener('click', () => {
  if (!$('#webhook-url').value.trim() && !view.webhook) return ($('#webhook-error').textContent = 'Paste the webhook URL first.');
  webhookAction('webhook', webhookBody(), () => {
    $('#webhook-url').value = '';
    toast(view.settings.features.teamWebhook ? 'Webhook saved.' : 'Webhook saved. Turn on “Team chat webhook” under Features to start posting.');
  });
});
$('#webhook-test').addEventListener('click', () =>
  webhookAction('test-webhook', webhookBody(), () => toast('Test message sent. Check the channel.')),
);
$('#webhook-clear').addEventListener('click', () => {
  if (!confirm('Remove the webhook URL? EVIE will stop posting to the channel.')) return;
  webhookAction('webhook', { clear: true }, () => toast('Webhook removed.'));
});
$('#webhook-url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('#webhook-save').click();
  }
});

function collect() {
  const form = $('#settings-form');
  return {
    features: Object.fromEntries(FEATURES.map((f) => [f.key, form.elements[f.key].checked])),
    tuning: Object.fromEntries(TUNING.map((t) => [t.key, form.elements[t.key].value])),
  };
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 3000);
}

async function unlock() {
  try {
    view = await backend.load();
    render();
  } catch (err) {
    if (err.status === 401) sessionStorage.removeItem(TOKEN_KEY);
    showLocked(err.status === 401 ? 'The saved token is no longer valid.' : err.message);
  }
}

// ---- events ----------------------------------------------------------------------
$('#unlock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const token = form.token.value.trim();
  if (!token) return ($('#unlock-error').textContent = 'Enter the admin token.');
  sessionStorage.setItem(TOKEN_KEY, token);
  try {
    view = await backend.load();
    form.reset();
    render();
  } catch (err) {
    if (err.status === 401) sessionStorage.removeItem(TOKEN_KEY);
    $('#unlock-error').textContent = err.message;
  }
});

$('#settings-form').addEventListener('change', (e) => {
  if (e.target.name === 'advancedScheduling') {
    $('#adv-fields').disabled = !e.target.checked;
    $('#adv-note').hidden = e.target.checked;
  }
});

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#save-error').textContent = '';
  $('#save-btn').disabled = true;
  try {
    view = await backend.save(collect());
    render();
    toast('Settings saved. The chargers page updates straight away.');
  } catch (err) {
    if (err.status === 401) return showLocked(err.message);
    $('#save-error').textContent = err.message;
  } finally {
    $('#save-btn').disabled = false;
  }
});

$('#test-btn').addEventListener('click', async () => {
  const to = $('#test-to').value.trim();
  if (!to) return toast('Enter an email address first.');
  $('#test-btn').disabled = true;
  try {
    await backend.testEmail(to);
    toast(`Test email sent to ${to}.`);
  } catch (err) {
    $('#save-error').textContent = err.message;
  } finally {
    $('#test-btn').disabled = false;
  }
});

$('#lock-btn').addEventListener('click', () => {
  sessionStorage.removeItem(TOKEN_KEY);
  view = null;
  visitorLoaded = false;
  showLocked('');
});

backend = await detect();
if (backend.mode === 'demo') {
  const note = $('#mode-note');
  note.hidden = false;
  note.textContent = 'Demo mode: these settings are stored in this browser only.';
}
if (sessionStorage.getItem(TOKEN_KEY)) await unlock();
else showLocked();
