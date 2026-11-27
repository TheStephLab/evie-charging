import { initShell } from './shell.js';
import { GUIDE, VISITOR_SECTIONS } from './visitor.js';
import { fetchVisitor, richText, visitorText, MISSING } from './visitor-data.js';

initShell();
const $ = (sel) => document.querySelector(sel);
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

const { data, mode } = await fetchVisitor();
const text = visitorText(data);

$('#demo-note').hidden = mode !== 'demo';
$('#updated').textContent = data.updatedAt
  ? `Updated ${new Date(data.updatedAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`
  : `From the ${GUIDE}`;

const panel = (s) => `<section class="panel" aria-labelledby="${s.id}-h">
    <div class="panel-head"><h2 id="${s.id}-h">${esc(s.title)}</h2></div>
    <div class="panel-body"><dl class="info-list">${s.fields
      .map(
        (fd) =>
          `<div id="${fd.key}"><dt>${esc(fd.label)}</dt><dd>${text[fd.key] ? richText(text[fd.key]) : `<span class="muted">${MISSING}</span>`}</dd></div>`,
      )
      .join('')}</dl></div>
  </section>`;

// Each section has a slot in the page; any without one goes at the end.
for (const s of VISITOR_SECTIONS) {
  const slot = document.querySelector(`[data-section="${s.id}"]`);
  if (slot) slot.outerHTML = panel(s);
  else $('#visitor-sections').insertAdjacentHTML('beforeend', panel(s));
}

// Re-apply the hash target now that the sections exist (e.g. visitor.html#safety-h from another page).
if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
$('#print-btn').addEventListener('click', () => print());
