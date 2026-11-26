import { initShell } from './shell.js';
import { VISITOR_SECTIONS } from './visitor.js';
import { fetchVisitor, richText, MISSING } from './visitor-data.js';

initShell();
const $ = (sel) => document.querySelector(sel);
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

const { data, mode } = await fetchVisitor();
const f = data.fields;

$('#demo-note').hidden = mode !== 'demo';
$('#updated').textContent = data.updatedAt ? `Updated ${new Date(data.updatedAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}` : '';

$('#visitor-sections').innerHTML = VISITOR_SECTIONS.map(
  (s) => `<section class="panel" aria-labelledby="${s.id}-h">
    <div class="panel-head"><h2 id="${s.id}-h">${esc(s.title)}</h2></div>
    <div class="panel-body"><dl class="info-list">${s.fields
      .map(
        (fd) =>
          `<div id="${fd.key}"><dt>${esc(fd.label)}</dt><dd>${f[fd.key] ? richText(f[fd.key]) : `<span class="muted">${MISSING}</span>`}</dd></div>`,
      )
      .join('')}</dl></div>
  </section>`,
).join('');

// Re-apply the hash target now that the sections exist (e.g. visitor.html#safety-h from the home page).
if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
$('#print-btn').addEventListener('click', () => print());
