import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  // Публичный адрес, на который ведут ссылки в письмах, QR-коды и Wallet.
  APP_URL: z.string().url().default('http://localhost:5174'),
  APP_NAME: z.string().default('Pečiatka'),
  // Если ключа нет, письма выводятся в лог (удобно в разработке).
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('Pečiatka <noreply@example.com>'),
  // Фоновые задачи (синхронизация Wallet, напоминания). В тестах выключены.
  WORKERS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // ── Apple Wallet ── сертификаты: *_B64 (base64 PEM, для хостинга) или файлы в certs/
  APPLE_PASS_TYPE_ID: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_SIGNER_CERT_B64: z.string().optional(),
  APPLE_SIGNER_KEY_B64: z.string().optional(),
  APPLE_SIGNER_KEY_PASSPHRASE: z.string().optional(),
  APPLE_WWDR_CERT_B64: z.string().optional(),

  // ── Google Wallet ── ключ сервисного аккаунта: base64 JSON или certs/google-sa.json
  GOOGLE_WALLET_ISSUER_ID: z.string().optional(),
  GOOGLE_WALLET_SA_KEY_B64: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
const env = parsed.data;

const certsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../certs');

/** Секрет из base64-переменной или из файла в certs/. */
function secret(b64: string | undefined, file: string): string | undefined {
  if (b64) return Buffer.from(b64, 'base64').toString('utf8');
  const path = resolve(certsDir, file);
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

function appleConfig() {
  const signerCert = secret(env.APPLE_SIGNER_CERT_B64, 'signerCert.pem');
  const signerKey = secret(env.APPLE_SIGNER_KEY_B64, 'signerKey.pem');
  const wwdr = secret(env.APPLE_WWDR_CERT_B64, 'wwdr.pem');
  if (!env.APPLE_PASS_TYPE_ID || !env.APPLE_TEAM_ID || !signerCert || !signerKey || !wwdr) return null;
  return {
    passTypeId: env.APPLE_PASS_TYPE_ID,
    teamId: env.APPLE_TEAM_ID,
    signerCert,
    signerKey,
    signerKeyPassphrase: env.APPLE_SIGNER_KEY_PASSPHRASE,
    wwdr,
  };
}

function googleConfig() {
  const raw = secret(env.GOOGLE_WALLET_SA_KEY_B64, 'google-sa.json');
  if (!env.GOOGLE_WALLET_ISSUER_ID || !raw) return null;
  const key = JSON.parse(raw) as { client_email: string; private_key: string };
  return { issuerId: env.GOOGLE_WALLET_ISSUER_ID, clientEmail: key.client_email, privateKey: key.private_key };
}

export type AppleConfig = NonNullable<ReturnType<typeof appleConfig>>;
export type GoogleConfig = NonNullable<ReturnType<typeof googleConfig>>;

export const config = {
  ...env,
  isProd: env.NODE_ENV === 'production',
  // Secure-cookie нужна на https; локально по http браузер её не примет.
  cookieSecure: env.APP_URL.startsWith('https://'),
  apple: appleConfig() as AppleConfig | null,
  google: googleConfig() as GoogleConfig | null,
};
