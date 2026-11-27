import { initShell } from './shell.js';
import { connectBackend } from './backend.js';
import { VISITOR_FIELDS } from './visitor.js';
import { fetchVisitor, richText, visitorText, MISSING } from './visitor-data.js';

initShell();
const $ = (sel) => document.querySelector(sel);

const QUICK = [
  ['alarmTest'],
  ['assemblyPoint'],
  ['firstAid'],
  ['defibrillator'],
  ['hours'],
  ['workplaceExperience', 'Need help?'],
];

const { data } = await fetchVisitor();
const text = visitorText(data);
const label = (key) => VISITOR_FIELDS.find((f) => f.key === key)?.label ?? key;
$('#quick-info').innerHTML = QUICK.map(
  ([key, title]) =>
    `<div><dt>${title ?? label(key)}</dt><dd>${text[key] ? richText(text[key]) : `<span class="muted">${MISSING}</span>`}</dd></div>`,
).join('');
$('#visitor-status').textContent = data.updatedAt ? `Updated ${new Date(data.updatedAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}` : '';

// Live EV charger summary (same device id as the charging page).
let clientId = localStorage.getItem('evie.client');
if (!clientId) {
  clientId = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  localStorage.setItem('evie.client', clientId);
}
connectBackend({
  clientId,
  onStatus: (online) => {
    if (!online) $('#ev-status').textContent = 'Offline';
  },
  onView: (v) => {
    const free = v.chargers.filter((ch) => ch.status === 'free').length;
    const waiting = v.queue.length;
    const el = $('#ev-status');
    el.textContent = `${free} of ${v.chargers.length} free${waiting ? ` · ${waiting} waiting` : ''}`;
    el.dataset.tone = free ? 'success' : 'busy';
    $('#updated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  },
});
