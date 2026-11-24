#!/usr/bin/env node
// Generates printable EVIE charger stickers (QR code + NFC tap zone) as SVG.
// Usage: npm run stickers -- --base https://evie.example.com --chargers 3
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import QRCode from 'qrcode';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    base: { type: 'string', default: process.env.EVIE_URL || 'http://evie.local:3000' },
    chargers: { type: 'string', default: process.env.CHARGERS || '3' },
    out: { type: 'string', default: path.join(HERE, 'dist') },
  },
});

let base;
try {
  base = new URL(values.base);
  if (!/^https?:$/.test(base.protocol)) throw new Error();
} catch {
  console.error(`Invalid --base URL: ${values.base}`);
  process.exit(1);
}
const BASE = base.origin + base.pathname.replace(/\/+$/, '');
const COUNT = Number.parseInt(values.chargers, 10);
if (!(COUNT >= 1 && COUNT <= 99)) {
  console.error('--chargers must be between 1 and 99');
  process.exit(1);
}

const TEAL = '#0f766e';
const TINT = '#ccfbf1';
const INK = '#14181f';
const MUTED = '#5b6472';
const FONT = "'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const BOLT = 'M36 8 16 36h14l-4 20 22-30H34z'; // same mark as public/icon.svg (64×64 box)

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const f = (n) => +n.toFixed(2);
const linkFor = (n) => `${BASE}/c/${n}`;

function qrPath(text, x, y, size) {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'H' }); // H tolerates the centre logo
  const n = modules.size;
  const m = size / n;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; ) {
      if (!modules.get(r, c)) { c++; continue; }
      const s = c;
      while (c < n && modules.get(r, c)) c++;
      d += `M${f(x + s * m)} ${f(y + r * m)}h${f((c - s) * m)}v${f(m)}h${f(-(c - s) * m)}z`;
    }
  }
  return `<path d="${d}" fill="${INK}" shape-rendering="crispEdges"/>`;
}

// Generic "tap phone" mark: phone outline + contactless waves.
function tapIcon(cx, cy) {
  const ox = cx - 5;
  const arcs = [18, 33, 48].map((r) => {
    const a = (50 * Math.PI) / 180;
    return `<path d="M${f(ox + r * Math.cos(-a))} ${f(cy + r * Math.sin(-a))}A${r} ${r} 0 0 1 ${f(ox + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}" fill="none" stroke="${TEAL}" stroke-width="7" stroke-linecap="round"/>`;
  });
  return `<rect x="${cx - 55}" y="${cy - 36}" width="42" height="72" rx="9" fill="#fff" stroke="${INK}" stroke-width="6"/>
    <line x1="${cx - 41}" y1="${cy + 24}" x2="${cx - 27}" y2="${cy + 24}" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
    ${arcs.join('\n    ')}`;
}

// One 60 × 100 mm sticker (1 unit = 0.1 mm).
function card(n) {
  const url = linkFor(n);
  const shown = url.replace(/^https?:\/\//, '');
  const numSize = n > 9 ? 84 : 112;
  return `<g>
  <defs><clipPath id="evie-clip-${n}"><rect width="600" height="1000" rx="40"/></clipPath></defs>
  <g clip-path="url(#evie-clip-${n})" font-family="${FONT}">
    <rect width="600" height="1000" fill="#fff"/>

    <rect width="600" height="210" fill="${TEAL}"/>
    <path d="${BOLT}" transform="translate(34 30) scale(.95)" fill="#fff"/>
    <text x="96" y="80" font-size="48" font-weight="800" letter-spacing="3" fill="#fff">EVIE</text>
    <text x="44" y="172" font-size="58" font-weight="700" fill="#fff">Charger</text>
    <circle cx="488" cy="105" r="78" fill="#fff"/>
    <text x="488" y="${f(105 + numSize * 0.36)}" text-anchor="middle" font-size="${numSize}" font-weight="800" fill="${TEAL}">${n}</text>

    ${qrPath(url, 100, 270, 400)}
    <rect x="252" y="422" width="96" height="96" rx="20" fill="#fff"/>
    <rect x="262" y="432" width="76" height="76" rx="16" fill="${TEAL}"/>
    <path d="${BOLT}" transform="translate(262 432) scale(1.1875)" fill="#fff"/>

    <text x="300" y="724" text-anchor="middle" font-size="36" font-weight="700" fill="${INK}">Scan or tap to check in</text>

    <circle cx="150" cy="845" r="95" fill="${TINT}" stroke="${TEAL}" stroke-width="4" stroke-dasharray="14 10"/>
    ${tapIcon(150, 845)}
    <text x="272" y="830" font-size="46" font-weight="800" fill="${INK}">Tap here</text>
    <text x="272" y="870" font-size="25" fill="${MUTED}">NFC · hold your phone</text>
    <text x="272" y="902" font-size="25" fill="${MUTED}">against the circle</text>

    <rect y="940" width="600" height="60" fill="${TEAL}"/>
    <text x="300" y="980" text-anchor="middle" font-size="25" font-weight="600" fill="#fff">${esc(shown)}</text>
  </g>
  <rect x="1" y="1" width="598" height="998" rx="40" fill="none" stroke="#c8cdd4" stroke-width="2"/>
</g>`;
}

const svg = (w, h, vw, vh, body, title) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${vw} ${vh}">
<title>${esc(title)}</title>
${body}
</svg>
`;

fs.rmSync(values.out, { recursive: true, force: true });
fs.mkdirSync(values.out, { recursive: true });

const ids = Array.from({ length: COUNT }, (_, i) => i + 1);
for (const n of ids) {
  fs.writeFileSync(path.join(values.out, `charger-${n}.svg`), svg(60, 100, 600, 1000, card(n), `EVIE charger ${n} sticker`));
}

// A4 print sheets: 3 × 2 stickers per page, 6 mm gutters.
const PER_PAGE = 6;
for (let p = 0; p * PER_PAGE < COUNT; p++) {
  const page = ids.slice(p * PER_PAGE, (p + 1) * PER_PAGE);
  const body = page
    .map((n, i) => `<g transform="translate(${90 + (i % 3) * 660} ${455 + Math.floor(i / 3) * 1060})">${card(n)}</g>`)
    .join('\n');
  const note = `<text x="1050" y="2880" text-anchor="middle" font-family="${FONT}" font-size="28" fill="${MUTED}">EVIE charger stickers · print at 100% on A4 · cut along the grey outline · 60 × 100 mm</text>`;
  fs.writeFileSync(path.join(values.out, `sheet-${p + 1}.svg`), svg(210, 297, 2100, 2970, `<rect width="2100" height="2970" fill="#fff"/>\n${body}\n${note}`, 'EVIE sticker sheet'));
}

console.log(`Stickers written to ${values.out}\nNFC / QR links:`);
for (const n of ids) console.log(`  Charger ${n}: ${linkFor(n)}`);
