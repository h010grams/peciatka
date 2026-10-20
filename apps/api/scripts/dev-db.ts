/**
 * Локальный PostgreSQL без Docker: бинарники ставятся через npm (embedded-postgres).
 * Запуск: `pnpm db` — держите терминал открытым, Ctrl+C останавливает базу.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), '../.pgdata');
const firstRun = !existsSync(dataDir);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port: 5434,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

if (firstRun) await pg.initialise();
await pg.start();

for (const db of ['peciatka', 'peciatka_test']) {
  try {
    await pg.createDatabase(db);
    console.log(`created database ${db}`);
  } catch {
    // уже существует
  }
}

console.log('✅ PostgreSQL: postgresql://postgres:postgres@localhost:5434/peciatka  (Ctrl+C — остановить)');

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
