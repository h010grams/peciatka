import type { z } from 'zod';

/** Разбирает вход по Zod-схеме; ZodError перехватывает общий error handler (→ 400). */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  return schema.parse(data ?? {});
}
