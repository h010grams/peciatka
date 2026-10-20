import type { ApiErrorBody } from '@peciatka/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    /** доп. поля ошибки, например retryAt для лимита штампов */
    public details?: Record<string, unknown>,
  ) {
    super(code);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  const isForm = body instanceof FormData;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {},
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (data as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, error?.code ?? 'internal', error as Record<string, unknown> | undefined);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  patch: <T>(url: string, body: unknown = {}) => request<T>('PATCH', url, body),
  put: <T>(url: string, body: unknown = {}) => request<T>('PUT', url, body),
  upload: <T>(url: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<T>('POST', url, form);
  },
  delete: <T>(url: string) => request<T>('DELETE', url),
};
