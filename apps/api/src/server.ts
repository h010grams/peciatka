import { config } from './config.js';
import { buildApp } from './app.js';
import { prisma } from './lib/prisma.js';
import { startReminderJob, stopReminderJob } from './jobs/reminders.js';
import { startWalletWorker, stopWalletWorker } from './services/wallet/sync.js';

const app = await buildApp({
  logger: { level: config.isProd ? 'info' : 'warn' },
});

await app.listen({ port: config.PORT, host: config.HOST });

if (config.WORKERS_ENABLED) {
  startWalletWorker();
  startReminderJob();
}
console.log(
  `Wallet: Apple ${config.apple ? 'on' : 'off'}, Google ${config.google ? 'on' : 'off'} · ${config.APP_URL}`,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    stopWalletWorker();
    stopReminderJob();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
