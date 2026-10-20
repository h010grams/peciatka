import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { badRequest } from '../lib/errors.js';

/**
 * Размеры Apple Wallet для storeCard (в точках, @1x):
 *   logo ≤ 160×50, icon 29×29, strip 375×123.
 * Храним логотип в @3x (480×150), остальное генерируем на лету.
 */
export const LOGO_MAX = { width: 480, height: 150 };
const STRIP_3X = { width: 1125, height: 369 };

const ALLOWED = new Set(['jpeg', 'png', 'webp']);

export async function processLogoUpload(input: Buffer) {
  let meta;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw badRequest('image_invalid');
  }
  // SVG не принимаем: это XML со скриптами, и Wallet его всё равно не поддерживает.
  if (!meta.format || !ALLOWED.has(meta.format)) throw badRequest('image_format');

  const { data, info } = await sharp(input)
    .rotate()
    .trim({ threshold: 10 }) // убираем пустые поля по краям
    .resize({ ...LOGO_MAX, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });

  return {
    data,
    width: info.width,
    height: info.height,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}

/** Логотип в рамке `width`×`height` (для разных плотностей Apple). */
export function resizeLogo(logo: Buffer, width: number, height: number) {
  return sharp(logo).resize({ width, height, fit: 'inside' }).png().toBuffer();
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * Квадратный логотип на белом фоне — для Google Wallet (программа, круглая маска)
 * и иконки Apple (показывается в уведомлениях).
 */
export async function squareLogo(logo: Buffer | null, colors: { bg: string; fg: string }, size: number) {
  if (!logo) return defaultMark(colors, size);
  const inner = Math.round(size * 0.7);
  const resized = await sharp(logo).resize({ width: inner, height: inner, fit: 'inside' }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: '#ffffff' } })
    .composite([{ input: resized, gravity: 'center' }])
    .png()
    .toBuffer();
}

/** Знак по умолчанию, пока салон не загрузил логотип: «печать» в цветах карты. */
function defaultMark(colors: { bg: string; fg: string }, size: number) {
  const s = size;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 100 100">
    <rect width="100" height="100" fill="${colors.bg}"/>
    <circle cx="50" cy="50" r="26" fill="none" stroke="${colors.fg}" stroke-width="8"/>
    <circle cx="50" cy="50" r="9" fill="${colors.fg}"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Полоса со штампами: N кружков, заполненные — с галочкой.
 * Для Apple (strip) и Google (heroImage). Без текста — не зависим от шрифтов сервера.
 */
export function stripSvg(p: { bgColor: string; fgColor: string; labelColor: string }, filled: number, total: number) {
  const { width: W, height: H } = STRIP_3X;
  const rows = total <= 6 ? 1 : total <= 20 ? 2 : 3;
  const cols = Math.ceil(total / rows);
  const padX = 60;
  const padY = 40;
  const cellW = (W - padX * 2) / cols;
  const cellH = (H - padY * 2) / rows;
  const r = Math.min(cellW, cellH) * 0.38;
  const stroke = Math.max(4, r * 0.12);
  const { r: fr, g: fg, b: fb } = hexToRgb(p.fgColor);

  const circles: string[] = [];
  for (let i = 0; i < total; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    // последний ряд центрируем, если он неполный
    const inRow = row === rows - 1 ? total - cols * (rows - 1) : cols;
    const offsetX = ((cols - inRow) * cellW) / 2;
    const cx = padX + offsetX + cellW * col + cellW / 2;
    const cy = padY + cellH * row + cellH / 2;
    const isLast = i === total - 1;
    if (i < filled) {
      circles.push(
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${p.fgColor}"/>`,
        `<path d="M ${cx - r * 0.42} ${cy + r * 0.02} L ${cx - r * 0.1} ${cy + r * 0.34} L ${cx + r * 0.45} ${cy - r * 0.3}" fill="none" stroke="${p.bgColor}" stroke-width="${stroke * 1.4}" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    } else {
      // кружок награды выделяем цветом подписей
      const color = isLast ? p.labelColor : `rgba(${fr},${fg},${fb},0.45)`;
      circles.push(
        `<circle cx="${cx}" cy="${cy}" r="${r - stroke / 2}" fill="none" stroke="${color}" stroke-width="${stroke}" ${isLast ? `stroke-dasharray="${stroke * 2} ${stroke * 1.2}"` : ''}/>`,
      );
      if (isLast) {
        // «подарок»: звёздочка в центре
        circles.push(`<circle cx="${cx}" cy="${cy}" r="${r * 0.22}" fill="${p.labelColor}"/>`);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${p.bgColor}"/>
  ${circles.join('\n  ')}
</svg>`;
}

const stripCache = new Map<string, Buffer>();

/** PNG полосы в нужной плотности (scale 1/2/3). Кешируем: комбинаций немного. */
export async function stripPng(
  p: { bgColor: string; fgColor: string; labelColor: string },
  filled: number,
  total: number,
  scale: 1 | 2 | 3 = 3,
) {
  const key = `${p.bgColor}${p.fgColor}${p.labelColor}:${filled}/${total}@${scale}`;
  const hit = stripCache.get(key);
  if (hit) return hit;
  const png = await sharp(Buffer.from(stripSvg(p, filled, total)))
    .resize({ width: (STRIP_3X.width / 3) * scale, height: (STRIP_3X.height / 3) * scale })
    .png()
    .toBuffer();
  if (stripCache.size > 2000) stripCache.clear();
  stripCache.set(key, png);
  return png;
}
