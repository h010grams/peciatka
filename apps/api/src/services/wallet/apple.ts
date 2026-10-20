import http2 from 'node:http2';
import { PKPass } from 'passkit-generator';
import { config, type AppleConfig } from '../../config.js';
import { t } from '../../lib/i18n.js';
import { prisma } from '../../lib/prisma.js';
import { resizeLogo, squareLogo, stripPng } from '../images.js';
import { urls } from '../urls.js';
import type { WalletCard } from '../walletCard.js';

/**
 * Apple Wallet: storeCard, подписанный сертификатом Pass Type ID.
 * Обновления: при изменении карты шлём пустой push через APNs на все устройства,
 * где карта установлена; iPhone сам забирает свежий .pkpass через PassKit Web Service.
 */

export const appleEnabled = () => config.apple !== null;

function cfg(): AppleConfig {
  if (!config.apple) throw new Error('Apple Wallet is not configured');
  return config.apple;
}

function rgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

export function buildPassJson(card: WalletCard, apple: Pick<AppleConfig, 'passTypeId' | 'teamId'>, hasLogo: boolean) {
  const { program, customer, salon } = card;
  const loc = customer.locale;
  const next = card.appointments[0];

  const secondary: object[] = [
    {
      key: 'reward',
      label: t(loc, 'reward_label', { n: program.stampsRequired }),
      value: program.rewardText,
    },
  ];
  if (card.rewardsAvailable > 0) {
    secondary.push({ key: 'available', label: t(loc, 'available'), value: `🎁 ${card.rewardsAvailable}`, textAlignment: 'PKTextAlignmentRight' });
  }

  return {
    formatVersion: 1,
    passTypeIdentifier: apple.passTypeId,
    teamIdentifier: apple.teamId,
    serialNumber: card.serialNumber,
    authenticationToken: card.appleAuthToken,
    webServiceURL: urls.appleWebService(),
    organizationName: salon.name,
    description: t(loc, 'description', { salon: salon.name }),
    ...(hasLogo ? {} : { logoText: salon.name }),
    backgroundColor: rgb(program.bgColor),
    foregroundColor: rgb(program.fgColor),
    labelColor: rgb(program.labelColor),
    sharingProhibited: true,
    voided: card.status !== 'ACTIVE',
    barcodes: [{ format: 'PKBarcodeFormatQR', message: card.qrToken, messageEncoding: 'iso-8859-1' }],
    ...(next ? { relevantDate: next.startsAt.toISOString() } : {}),
    storeCard: {
      headerFields: [
        { key: 'stamps', label: t(loc, 'stamps'), value: `${card.stampCount}/${program.stampsRequired}` },
      ],
      primaryFields: [],
      secondaryFields: secondary,
      auxiliaryFields: next
        ? [
            {
              key: 'next',
              label: t(loc, 'next_visit'),
              value: next.startsAt.toISOString(),
              dateStyle: 'PKDateStyleMedium',
              timeStyle: 'PKDateStyleShort',
            },
          ]
        : [],
      backFields: [
        // Единый канал уведомлений: смена значения → push на экране с этим текстом.
        { key: 'notice', label: t(loc, 'notice'), value: card.walletNotice ?? '—', changeMessage: '%@' },
        { key: 'customer', label: t(loc, 'customer'), value: customer.name },
        {
          key: 'terms',
          label: t(loc, 'how_it_works'),
          value: t(loc, 'terms', { n: program.stampsRequired, reward: program.rewardText }),
        },
        {
          key: 'salon',
          label: t(loc, 'salon'),
          value: [salon.name, salon.address, salon.phone].filter(Boolean).join('\n'),
        },
        { key: 'web', label: 'Web', value: urls.cardPage(card.serialNumber) },
      ],
    },
  };
}

export async function generatePass(card: WalletCard, apple: AppleConfig = cfg()): Promise<Buffer> {
  const { program } = card;
  const logo = program.logoAssetId
    ? (await prisma.asset.findUnique({ where: { id: program.logoAssetId }, select: { data: true } }))?.data
    : null;
  const logoBuf = logo ? Buffer.from(logo) : null;
  const colors = { bg: program.bgColor, fg: program.fgColor };

  const files: Record<string, Buffer> = {
    'pass.json': Buffer.from(JSON.stringify(buildPassJson(card, apple, !!logoBuf))),
    'icon.png': await squareLogo(logoBuf, colors, 29),
    'icon@2x.png': await squareLogo(logoBuf, colors, 58),
    'icon@3x.png': await squareLogo(logoBuf, colors, 87),
    'strip.png': await stripPng(program, card.stampCount, program.stampsRequired, 1),
    'strip@2x.png': await stripPng(program, card.stampCount, program.stampsRequired, 2),
    'strip@3x.png': await stripPng(program, card.stampCount, program.stampsRequired, 3),
  };
  if (logoBuf) {
    files['logo.png'] = await resizeLogo(logoBuf, 160, 50);
    files['logo@2x.png'] = await resizeLogo(logoBuf, 320, 100);
    files['logo@3x.png'] = await resizeLogo(logoBuf, 480, 150);
  }

  const pass = new PKPass(files, {
    wwdr: apple.wwdr,
    signerCert: apple.signerCert,
    signerKey: apple.signerKey,
    signerKeyPassphrase: apple.signerKeyPassphrase,
  });
  return pass.getAsBuffer();
}

// ───────── APNs ─────────

/**
 * Пустой push на каждое устройство. Возвращает токены, которые Apple считает
 * недействительными (карту удалили с телефона) — их регистрации нужно удалить.
 */
export async function pushUpdate(pushTokens: string[]): Promise<{ invalid: string[] }> {
  if (pushTokens.length === 0) return { invalid: [] };
  const apple = cfg();
  const session = http2.connect('https://api.push.apple.com', {
    cert: apple.signerCert,
    key: apple.signerKey,
    passphrase: apple.signerKeyPassphrase,
  });
  const invalid: string[] = [];
  try {
    await Promise.all(
      pushTokens.map(
        (token) =>
          new Promise<void>((resolve, reject) => {
            const req = session.request({
              ':method': 'POST',
              ':path': `/3/device/${token}`,
              'apns-topic': apple.passTypeId,
              'content-type': 'application/json',
            });
            let status = 0;
            let body = '';
            req.setEncoding('utf8');
            req.on('response', (h) => (status = Number(h[':status'])));
            req.on('data', (c: string) => (body += c));
            req.on('end', () => {
              if (status === 200) return resolve();
              const reason = body ? (JSON.parse(body) as { reason?: string }).reason : '';
              if (status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered') {
                invalid.push(token);
                return resolve();
              }
              reject(new Error(`APNs ${status} ${reason}`));
            });
            req.on('error', reject);
            req.end('{}');
          }),
      ),
    );
  } finally {
    session.close();
  }
  return { invalid };
}
