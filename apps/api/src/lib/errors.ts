/** Ошибка с машинным кодом; фронт переводит `code` через i18n (`errors.<code>`). */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
  }
}

export const unauthorized = () => new AppError(401, 'unauthorized');
export const forbidden = () => new AppError(403, 'forbidden');
export const notFound = (code = 'not_found') => new AppError(404, code);
export const conflict = (code: string, details?: Record<string, unknown>) => new AppError(409, code, details);
export const badRequest = (code: string) => new AppError(400, code);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** id из URL: не-uuid сразу 404, а не ошибка приведения типа в Postgres. */
export function assertUuid(id: string, code = 'not_found'): string {
  if (!UUID_RE.test(id)) throw notFound(code);
  return id;
}
