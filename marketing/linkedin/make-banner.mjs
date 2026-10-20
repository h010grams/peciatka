// Обложка профиля LinkedIn 1584×396: node marketing/linkedin/make-banner.mjs
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const sharp = require('sharp');
const out = dirname(fileURLToPath(import.meta.url));

const W = 1584;
const H = 396;
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const C = { ink: '#1C1917', cream: '#F5E6E0', accent: '#B5644C', soft: '#E7B9A8', muted: '#A8A29E', card: '#7A1F3D' };

// Мини-карта лояльности справа (как в продукте): 10 кружков, 4 заполнены
function card(x, y) {
  const w = 380;
  const h = 240;
  let dots = '';
  for (let i = 0; i < 10; i++) {
    const cx = x + 56 + (i % 5) * 67;
    const cy = y + 110 + Math.floor(i / 5) * 62;
    if (i < 4) {
      dots += `<circle cx="${cx}" cy="${cy}" r="22" fill="#FFFFFF"/>
        <path d="M ${cx - 9} ${cy} L ${cx - 2} ${cy + 7} L ${cx + 10} ${cy - 7}" fill="none" stroke="${C.card}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    } else if (i === 9) {
      dots += `<circle cx="${cx}" cy="${cy}" r="20" fill="none" stroke="${C.soft}" stroke-width="3" stroke-dasharray="6 4"/><circle cx="${cx}" cy="${cy}" r="5" fill="${C.soft}"/>`;
    } else {
      dots += `<circle cx="${cx}" cy="${cy}" r="20" fill="none" stroke="#FFFFFF" stroke-opacity="0.45" stroke-width="3"/>`;
    }
  }
  return `<g>
    <rect x="${x + 10}" y="${y + 14}" width="${w}" height="${h}" rx="24" fill="#000" opacity="0.25"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="24" fill="${C.card}"/>
    <text x="${x + 28}" y="${y + 48}" font-family="${FONT}" font-size="22" font-weight="700" fill="#FFFFFF">Nail Studio</text>
    <text x="${x + w - 28}" y="${y + 36}" font-family="${FONT}" font-size="13" font-weight="700" fill="${C.soft}" text-anchor="end" letter-spacing="1">STAMPS</text>
    <text x="${x + w - 28}" y="${y + 60}" font-family="${FONT}" font-size="22" font-weight="700" fill="#FFFFFF" text-anchor="end">4/10</text>
    ${dots}
    <text x="${x + 28}" y="${y + 218}" font-family="${FONT}" font-size="15" fill="${C.soft}">Reward (visit 10): 15% off</text>
  </g>`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${C.ink}"/>
  <circle cx="${W - 120}" cy="-40" r="260" fill="${C.accent}" opacity="0.18"/>
  <!-- левая часть закрыта фото профиля на десктопе — текст начинается правее -->
  <text x="560" y="150" font-family="${FONT}" font-size="20" font-weight="700" fill="${C.soft}" letter-spacing="2">FULL-STACK DEVELOPER · OPEN TO REMOTE</text>
  <text x="560" y="214" font-family="${FONT}" font-size="50" font-weight="800" fill="#FFFFFF">Building Pečiatka</text>
  <text x="560" y="262" font-family="${FONT}" font-size="26" fill="${C.cream}">Digital loyalty cards in Apple &amp; Google Wallet</text>
  <text x="560" y="312" font-family="${FONT}" font-size="20" fill="${C.muted}">TypeScript · React · Node.js · PostgreSQL</text>
  ${card(1130, 70)}
</svg>`;

await sharp(Buffer.from(svg), { density: 144 }).resize(W, H).png().toFile(join(out, 'linkedin-banner.png'));
console.log('✓ linkedin-banner.png');
