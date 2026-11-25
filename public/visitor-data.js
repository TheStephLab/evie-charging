// Loads and saves visitor centre content from the server, or from this browser in demo mode.
import { DEMO_VISITOR_KEY, cleanVisitor, loadVisitor } from './visitor.js';

export async function fetchVisitor() {
  try {
    const res = await fetch('api/visitor', { cache: 'no-store' });
    if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
      const data = await res.json();
      localStorage.setItem('evie.visitor.cache', JSON.stringify(data));
      return { data, mode: 'server' };
    }
  } catch {
    // Offline: fall back to the last copy we saw.
    const cached = localStorage.getItem('evie.visitor.cache');
    if (cached && localStorage.getItem('evie.mode') !== 'demo') return { data: JSON.parse(cached), mode: 'offline' };
  }
  return { data: loadVisitor(JSON.parse(localStorage.getItem(DEMO_VISITOR_KEY) || 'null')), mode: 'demo' };
}

export function saveDemoVisitor(input) {
  const v = cleanVisitor(input);
  localStorage.setItem(DEMO_VISITOR_KEY, JSON.stringify(v));
  return v;
}

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

// Plain text → safe HTML with line breaks and clickable UK-style phone numbers.
export function richText(text) {
  return esc(text)
    .replace(/(\+?\d[\d ]{7,}\d)/g, (m) => `<a href="tel:${m.replace(/\s/g, '')}">${m}</a>`)
    .replace(/\n/g, '<br>');
}

export const MISSING = 'Not added yet. Please ask at reception.';
