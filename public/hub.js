import { initShell } from './shell.js';
import { connectBackend } from './backend.js';
import { fetchVisitor, richText, MISSING } from './visitor-data.js';

initShell();
const $ = (sel) => document.querySelector(sel);

const fact = (label, value) => `<div><dt>${label}</dt><dd>${value ? richText(value) : `<span class="muted">${MISSING}</span>`}</dd></div>`;

const { data, mode } = await fetchVisitor();
const f = data.fields;
$('#quick-info').innerHTML = [
  fact('Fire assembly point', f.assemblyPoint),
  fact('First aid', f.firstAid),
  fact('Reception', f.reception),
  fact('Guest Wi-Fi', f.wifi),
  fact('Parking', f.parking),
].join('');
const filled = Object.values(f).filter(Boolean).length;
$('#visitor-status').textContent = filled ? `${filled} topics` : mode === 'demo' ? 'Add details in Settings' : '';

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
