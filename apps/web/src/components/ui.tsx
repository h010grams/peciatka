import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../lib/api';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
};

/** Классы кнопки — и для <button>, и для ссылок, которые выглядят как кнопки. */
export function buttonClass(variant: Variant = 'primary', className?: string) {
  return cx(
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition disabled:opacity-50',
    variant === 'primary' && 'bg-stone-900 text-white active:bg-stone-700',
    variant === 'secondary' && 'border border-stone-300 bg-white text-stone-900 active:bg-stone-100',
    variant === 'ghost' && 'text-stone-600 active:bg-stone-100',
    variant === 'danger' && 'text-red-700 active:bg-red-50',
    className,
  );
}

export function Button({ variant = 'primary', loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button {...rest} disabled={disabled || loading} className={buttonClass(variant, className)}>
      {loading && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      {...rest}
      className={cx(
        'min-h-11 w-full rounded-xl border border-stone-300 bg-white px-3 text-base outline-none focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10 aria-[invalid=true]:border-red-500',
        className,
      )}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      {...rest}
      className={cx(
        'min-h-11 w-full rounded-xl border border-stone-300 bg-white px-3 text-base outline-none focus:border-stone-900',
        className,
      )}
    />
  );
});

/** Подпись + поле + ошибка. Ошибка — ключ i18n из Zod-схемы (`v.*`). */
export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-stone-700">{label}</span>
      {children}
      {error && <span className="block text-sm text-red-600">{t(error)}</span>}
    </label>
  );
}

export function Card({ children, className, flush }: { children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <div className={cx('rounded-2xl border border-stone-200 bg-white', !flush && 'p-5', className)}>{children}</div>
  );
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'success' | 'info'; children: ReactNode }) {
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={cx(
        'rounded-xl px-4 py-3 text-sm',
        kind === 'error' && 'bg-red-50 text-red-800',
        kind === 'success' && 'bg-emerald-50 text-emerald-800',
        kind === 'info' && 'bg-stone-100 text-stone-700',
      )}
    >
      {children}
    </div>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const code = error instanceof ApiError ? error.code : 'internal';
  return <Alert>{t(`errors.${code}`, { defaultValue: t('errors.internal') })}</Alert>;
}

export function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <span className="size-6 animate-spin rounded-full border-2 border-stone-400 border-t-transparent" />
    </div>
  );
}
