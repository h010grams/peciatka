import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/** Случайный URL-safe токен (по умолчанию 256 бит). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Токены храним только в виде хэша: утечка БД не даёт войти в чужую сессию. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Хэш-заглушка: при логине с несуществующим email тоже тратим время на verify,
// чтобы по времени ответа нельзя было понять, зарегистрирован ли адрес.
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hash('dummy-password-for-timing');
  return dummyHash;
}
