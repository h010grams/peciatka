import { useTranslation } from 'react-i18next';
import { LOCALES, type Locale } from '@peciatka/shared';
import { api } from '../lib/api';
import { setLocale } from '../lib/i18n';

const LABELS: Record<Locale, string> = { sk: 'SK', en: 'EN', uk: 'UA' };

/** Переключатель языка; для залогиненного пользователя сохраняет выбор в профиле. */
export function LanguageSwitcher({ persist = false }: { persist?: boolean }) {
  const { i18n } = useTranslation();
  return (
    <div className="flex rounded-lg bg-stone-100 p-0.5 text-xs font-semibold">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => {
            setLocale(l);
            if (persist) void api.patch('/auth/me', { locale: l });
          }}
          className={
            i18n.language === l ? 'rounded-md bg-white px-2 py-1 shadow-sm' : 'px-2 py-1 text-stone-500'
          }
        >
          {LABELS[l]}
        </button>
      ))}
    </div>
  );
}
