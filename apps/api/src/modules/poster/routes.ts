import { createRequire } from 'node:module';
import type { FastifyPluginAsync } from 'fastify';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { localeSchema, type Locale } from '@peciatka/shared';
import { notFound } from '../../lib/errors.js';
import { t } from '../../lib/i18n.js';
import { prisma } from '../../lib/prisma.js';
import { requireTenant } from '../../plugins/auth.js';
import { urls } from '../../services/urls.js';

const require = createRequire(import.meta.url);
// Inter содержит латиницу с диакритикой (č, ľ, ť…) и кириллицу; стандартный Helvetica в PDF — нет.
const FONT_REGULAR = require.resolve('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf');
const FONT_BOLD = require.resolve('@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf');

const SIZES = { a4: [595.28, 841.89], a5: [419.53, 595.28] } as const;

async function renderPoster(p: {
  salonName: string;
  joinUrl: string;
  stampsRequired: number;
  rewardText: string;
  bgColor: string;
  fgColor: string;
  logo: Buffer | null;
  locale: Locale;
  size: keyof typeof SIZES;
}): Promise<Buffer> {
  const [W, H] = SIZES[p.size];
  const k = W / SIZES.a4[0]; // масштаб для A5
  const doc = new PDFDocument({ size: [W, H], margin: 0, info: { Title: `${p.salonName} – QR` } });
  doc.registerFont('regular', FONT_REGULAR);
  doc.registerFont('bold', FONT_BOLD);
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const pad = 48 * k;
  const inner = W - pad * 2;

  // Цветная шапка в цветах карты
  const headerH = (p.logo ? 230 : 160) * k;
  doc.rect(0, 0, W, headerH).fill(p.bgColor);
  let y = 50 * k;
  if (p.logo) {
    doc.image(p.logo, pad, y, { fit: [inner, 70 * k], align: 'center' });
    y += 85 * k;
  }
  doc.fillColor(p.fgColor).font('bold').fontSize(30 * k).text(p.salonName, pad, y, { width: inner, align: 'center' });
  y = doc.y + 6 * k;
  doc.font('regular').fontSize(16 * k).text(t(p.locale, 'poster_title'), pad, y, { width: inner, align: 'center' });

  // QR
  const qrSize = 300 * k;
  const qr = await QRCode.toBuffer(p.joinUrl, { width: 1200, margin: 0, errorCorrectionLevel: 'M' });
  y = headerH + 40 * k;
  doc.image(qr, (W - qrSize) / 2, y, { width: qrSize, height: qrSize });
  y += qrSize + 28 * k;

  doc.fillColor('#1c1917').font('bold').fontSize(20 * k);
  doc.text(t(p.locale, 'poster_reward', { n: p.stampsRequired, reward: p.rewardText }), pad, y, { width: inner, align: 'center' });
  y = doc.y + 12 * k;
  doc.font('regular').fontSize(14 * k).fillColor('#44403c');
  doc.text(t(p.locale, 'poster_text'), pad, y, { width: inner, align: 'center' });
  y = doc.y + 6 * k;
  doc.text(t(p.locale, 'no_wallet'), pad, y, { width: inner, align: 'center' });

  // Подвал: адрес на случай, если QR не сканируется
  doc.fontSize(10 * k).fillColor('#78716c');
  doc.text(t(p.locale, 'poster_wallet'), pad, H - 70 * k, { width: inner, align: 'center' });
  doc.text(p.joinUrl, pad, H - 52 * k, { width: inner, align: 'center' });

  doc.end();
  return done;
}

/** /api/poster — QR и постер для стойки (любой участник салона). */
export const posterRoutes: FastifyPluginAsync = async (app) => {
  async function load(salonId: string) {
    const salon = await prisma.salon.findUniqueOrThrow({ where: { id: salonId }, include: { programs: true } });
    const program = salon.programs[0];
    if (!program) throw notFound('program_missing');
    return { salon, program };
  }

  app.get<{ Querystring: { lang?: string; size?: string } }>(
    '/poster.pdf',
    { preHandler: requireTenant() },
    async (req, reply) => {
      const { salon, program } = await load(req.tenant!.salonId);
      const locale = localeSchema.catch(salon.defaultLocale).parse(req.query.lang);
      const size = req.query.size === 'a5' ? 'a5' : 'a4';
      const logo = program.logoAssetId
        ? (await prisma.asset.findUnique({ where: { id: program.logoAssetId } }))?.data
        : null;
      const pdf = await renderPoster({
        salonName: salon.name,
        joinUrl: urls.joinPage(salon.slug),
        stampsRequired: program.stampsRequired,
        rewardText: program.rewardText,
        bgColor: program.bgColor,
        fgColor: program.fgColor,
        logo: logo ? Buffer.from(logo) : null,
        locale,
        size,
      });
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${salon.slug}-qr-${size}.pdf"`)
        .send(pdf);
    },
  );

  app.get('/qr.png', { preHandler: requireTenant() }, async (req, reply) => {
    const salon = await prisma.salon.findUniqueOrThrow({ where: { id: req.tenant!.salonId } });
    const png = await QRCode.toBuffer(urls.joinPage(salon.slug), { width: 1024, margin: 2 });
    return reply
      .header('Content-Type', 'image/png')
      .header('Content-Disposition', `attachment; filename="${salon.slug}-qr.png"`)
      .send(png);
  });
};
