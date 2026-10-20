import { config } from '../config.js';

/** Все публичные адреса в одном месте (их видят Apple, Google и клиентки). */
export const urls = {
  joinPage: (slug: string) => `${config.APP_URL}/j/${slug}`,
  cardPage: (serial: string) => `${config.APP_URL}/c/${serial}`,
  logo: (programId: string, version: number) =>
    `${config.APP_URL}/api/public/programs/${programId}/logo.png?v=${version}`,
  logoSquare: (programId: string, version: number) =>
    `${config.APP_URL}/api/public/programs/${programId}/logo-square.png?v=${version}`,
  strip: (programId: string, filled: number, version: number) =>
    `${config.APP_URL}/api/public/programs/${programId}/strip/${filled}.png?v=${version}`,
  appleWebService: () => `${config.APP_URL}/api/wallet/apple`,
};
