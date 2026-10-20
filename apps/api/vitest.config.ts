import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

loadEnv({ path: '../../.env' });

const testDbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5434/peciatka_test';
// globalSetup выполняется в этом же процессе — ему тоже нужна тестовая БД
process.env.DATABASE_URL = testDbUrl;

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDbUrl,
      APP_URL: 'http://localhost:5174',
      WORKERS_ENABLED: 'false',
      // ключи Wallet из .env/certs не должны влиять на тесты — включаем их в тестах вручную
      APPLE_PASS_TYPE_ID: '',
      GOOGLE_WALLET_ISSUER_ID: '',
    },
    globalSetup: ['./test/global-setup.ts'],
    // одна БД на все тесты — запускаем файлы последовательно
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
