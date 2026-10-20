import { execSync } from 'node:child_process';

/**
 * Перед прогоном применяем миграции к тестовой БД (как в продакшене — заодно
 * проверяем сами файлы миграций). Данные между тестами чистит resetDb() через TRUNCATE.
 */
export default function setup() {
  execSync('prisma migrate deploy', { stdio: 'inherit' });
}
