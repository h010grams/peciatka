// Генерирует картинки для LinkedIn-постов: node marketing/linkedin/make-images.mjs
// Формат 1080×1350 (вертикальный — занимает больше места в ленте).
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const sharp = require('sharp');
const out = dirname(fileURLToPath(import.meta.url));

const C = {
  ink: '#1C1917',
  paper: '#FAF7F5',
  cream: '#F5E6E0',
  accent: '#B5644C',
  accentSoft: '#E7B9A8',
  muted: '#78716C',
  line: '#D6D3D1',
  green: '#2F7D5B',
  red: '#B4332F',
};
const W = 1080;
const H = 1350;
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const text = (x, y, s, { size = 40, weight = 400, fill = C.ink, anchor = 'start', family = FONT } = {}) =>
  `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;

const footer = (dark = false) =>
  `<g>
    <circle cx="96" cy="${H - 92}" r="18" fill="none" stroke="${dark ? C.accentSoft : C.accent}" stroke-width="5"/>
    <circle cx="96" cy="${H - 92}" r="6.5" fill="${dark ? C.accentSoft : C.accent}"/>
    ${text(128, H - 80, 'Pečiatka', { size: 34, weight: 700, fill: dark ? '#FFFFFF' : C.ink })}
    ${text(W - 72, H - 80, 'building in public', { size: 28, fill: dark ? C.accentSoft : C.muted, anchor: 'end' })}
  </g>`;

// ───────── #2: что НЕ будет в первой версии ─────────
function notBuilding() {
  const items = ['Online booking', 'Payments', 'Mass SMS campaigns', 'Its own mobile app'];
  const rows = items
    .map((s, i) => {
      const y = 560 + i * 130;
      return `
      <rect x="72" y="${y - 78}" width="${W - 144}" height="104" rx="24" fill="#FFFFFF" stroke="${C.line}" stroke-width="2"/>
      <circle cx="140" cy="${y - 26}" r="26" fill="#F7E3E1"/>
      <path d="M ${128} ${y - 38} L ${152} ${y - 14} M ${152} ${y - 38} L ${128} ${y - 14}" stroke="${C.red}" stroke-width="6" stroke-linecap="round"/>
      <text x="196" y="${y - 12}" font-family="${FONT}" font-size="46" font-weight="500" fill="${C.muted}" text-decoration="line-through">${esc(s)}</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${C.paper}"/>
    ${text(72, 170, 'THE HARDEST DECISION', { size: 30, weight: 700, fill: C.accent })}
    ${text(72, 262, 'Version 1 will', { size: 84, weight: 800 })}
    ${text(72, 362, 'NOT have:', { size: 84, weight: 800, fill: C.accent })}
    ${rows}
    <rect x="72" y="1040" width="${W - 144}" height="150" rx="28" fill="${C.ink}"/>
    ${text(112, 1104, 'Just one thing that works on day one:', { size: 34, fill: C.accentSoft })}
    ${text(112, 1160, 'clients who come back.', { size: 48, weight: 700, fill: '#FFFFFF' })}
    ${footer()}
  </svg>`;
}

// ───────── T1: как обновляется карта в Apple и Google Wallet ─────────
function box(x, y, w, h, title, sub, { fill = '#FFFFFF', stroke = C.line, tc = C.ink, sc = C.muted } = {}) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>
    ${text(x + w / 2, y + h / 2 - (sub ? 6 : -12), title, { size: 34, weight: 700, fill: tc, anchor: 'middle' })}
    ${sub ? text(x + w / 2, y + h / 2 + 36, sub, { size: 25, fill: sc, anchor: 'middle' }) : ''}`;
}
function arrow(x1, y1, x2, y2, label, { color = C.accent, dashed = false, labelSide = 'right' } = {}) {
  const lx = labelSide === 'right' ? Math.max(x1, x2) + 18 : Math.min(x1, x2) - 18;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="5" ${dashed ? 'stroke-dasharray="14 10"' : ''} marker-end="url(#head)"/>
    ${label ? text(lx, (y1 + y2) / 2 + 9, label, { size: 25, fill: C.ink, anchor: labelSide === 'right' ? 'start' : 'end' }) : ''}`;
}
function architecture() {
  const colW = 440;
  const lx = 72;
  const rx = W - 72 - colW;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><marker id="head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${C.accent}"/></marker></defs>
    <rect width="${W}" height="${H}" fill="${C.paper}"/>
    ${text(72, 150, 'HOW A WALLET CARD UPDATES', { size: 30, weight: 700, fill: C.accent })}
    ${text(72, 232, 'One stamp, two platforms,', { size: 62, weight: 800 })}
    ${text(72, 306, 'two very different flows.', { size: 62, weight: 800 })}

    ${box(240, 380, 600, 120, 'My server', 'Fastify · PostgreSQL', { fill: C.ink, stroke: C.ink, tc: '#FFFFFF', sc: C.accentSoft })}

    <line x1="${lx + colW / 2}" y1="500" x2="${lx + colW / 2}" y2="548" stroke="${C.accent}" stroke-width="5"/>
    <line x1="${rx + colW / 2}" y1="500" x2="${rx + colW / 2}" y2="548" stroke="${C.accent}" stroke-width="5"/>
    <rect x="${lx + colW / 2 - 130}" y="548" width="260" height="58" rx="29" fill="${C.cream}" stroke="${C.accent}" stroke-width="2.5"/>
    <rect x="${rx + colW / 2 - 130}" y="548" width="260" height="58" rx="29" fill="${C.cream}" stroke="${C.accent}" stroke-width="2.5"/>
    ${text(lx + colW / 2, 588, 'Apple Wallet', { size: 30, weight: 800, anchor: 'middle' })}
    ${text(rx + colW / 2, 588, 'Google Wallet', { size: 30, weight: 800, anchor: 'middle' })}
    ${arrow(lx + colW / 2, 606, lx + colW / 2, 642, '', {})}
    ${arrow(rx + colW / 2, 606, rx + colW / 2, 642, '', {})}

    ${box(lx, 650, colW, 120, 'APNs', 'empty push: "something changed"')}
    ${box(rx, 650, colW, 120, 'Wallet REST API', 'update the card object')}

    ${arrow(lx + colW / 2, 770, lx + colW / 2, 860, '', {})}
    ${arrow(rx + colW / 2, 770, rx + colW / 2, 860, '', {})}

    ${box(lx, 870, colW, 120, 'iPhone', 'asks: "what changed since X?"')}
    ${box(rx, 870, colW, 120, 'Google', 'delivers it to the phone')}

    ${arrow(lx + colW / 2, 990, lx + colW / 2, 1070, '', {})}
    ${box(lx, 1080, colW, 120, 'New signed .pkpass', 'downloaded from my server', { fill: C.cream, stroke: C.accentSoft })}
    ${box(rx, 1080, colW, 120, 'Card updated', '+ notification (max ~3/day)', { fill: C.cream, stroke: C.accentSoft })}
    ${arrow(rx + colW / 2, 990, rx + colW / 2, 1070, '', {})}
    ${footer()}
  </svg>`;
}

// ───────── T2: два скана одновременно → один штамп ─────────
function qr(x, y, s) {
  // упрощённый QR: три «глаза» и немного модулей
  const m = s / 7;
  const eye = (ex, ey) =>
    `<rect x="${ex}" y="${ey}" width="${m * 3}" height="${m * 3}" fill="${C.ink}"/><rect x="${ex + m * 0.75}" y="${ey + m * 0.75}" width="${m * 1.5}" height="${m * 1.5}" fill="#FFFFFF"/><rect x="${ex + m * 1.15}" y="${ey + m * 1.15}" width="${m * 0.7}" height="${m * 0.7}" fill="${C.ink}"/>`;
  const dots = [[4, 0], [5, 1], [4, 2], [3, 4], [5, 4], [6, 5], [4, 6], [6, 6], [3, 3]]
    .map(([cx, cy]) => `<rect x="${x + cx * m}" y="${y + cy * m}" width="${m}" height="${m}" fill="${C.ink}"/>`)
    .join('');
  return eye(x, y) + eye(x + m * 4, y) + eye(x, y + m * 4) + dots;
}
function phone(cx, y, label) {
  return `<rect x="${cx - 80}" y="${y}" width="160" height="270" rx="30" fill="#57534E"/>
    <rect x="${cx - 66}" y="${y + 16}" width="132" height="238" rx="18" fill="#FFFFFF"/>
    <rect x="${cx - 18}" y="${y + 24}" width="36" height="7" rx="3.5" fill="#57534E"/>
    ${qr(cx - 42, y + 62, 84)}
    ${text(cx, y + 206, '+1', { size: 40, weight: 800, fill: C.accent, anchor: 'middle' })}
    ${text(cx, y + 320, label, { size: 32, weight: 600, fill: '#FFFFFF', anchor: 'middle' })}`;
}
function concurrency() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><marker id="head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${C.accentSoft}"/></marker></defs>
    <rect width="${W}" height="${H}" fill="${C.ink}"/>
    ${text(72, 150, 'SAME CARD · SAME SECOND', { size: 30, weight: 700, fill: C.accentSoft })}
    ${text(72, 232, 'Two scans.', { size: 72, weight: 800, fill: '#FFFFFF' })}
    ${text(72, 316, 'How many stamps?', { size: 72, weight: 800, fill: C.accentSoft })}

    ${phone(300, 380, 'Stylist A')}
    ${phone(780, 380, 'Stylist B')}

    <line x1="330" y1="725" x2="490" y2="800" stroke="${C.accentSoft}" stroke-width="5" marker-end="url(#head)"/>
    <line x1="750" y1="725" x2="590" y2="800" stroke="${C.accentSoft}" stroke-width="5" marker-end="url(#head)"/>

    <rect x="200" y="810" width="680" height="130" rx="24" fill="#292524" stroke="${C.accentSoft}" stroke-width="3"/>
    ${text(540, 865, 'SELECT … FOR UPDATE', { size: 40, weight: 700, fill: '#FFFFFF', anchor: 'middle', family: "Menlo, 'SF Mono', monospace" })}
    ${text(540, 912, 'the second request waits for the first', { size: 28, fill: C.accentSoft, anchor: 'middle' })}

    <rect x="72" y="990" width="440" height="140" rx="24" fill="#E7F2EC"/>
    ${text(110, 1050, '✓  1 stamp', { size: 46, weight: 800, fill: C.green })}
    ${text(110, 1098, 'Stylist A — added', { size: 28, fill: '#3F6B57' })}
    <rect x="568" y="990" width="440" height="140" rx="24" fill="#F7E3E1"/>
    ${text(606, 1050, '✕  rejected', { size: 46, weight: 800, fill: C.red })}
    ${text(606, 1098, 'B sees the fresh stamp', { size: 28, fill: '#8A3B37' })}
    ${footer(true)}
  </svg>`;
}

const jobs = [
  ['post-02-not-building.png', notBuilding()],
  ['post-t1-architecture.png', architecture()],
  ['post-t2-concurrency.png', concurrency()],
];
for (const [name, svg] of jobs) {
  await sharp(Buffer.from(svg), { density: 144 }).resize(W, H).png().toFile(join(out, name));
  console.log('✓', name);
}
