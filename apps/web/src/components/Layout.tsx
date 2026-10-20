import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@peciatka/shared';
import { api } from '../lib/api';
import { useCurrentRole, useLogout, useMe, useSetMe } from '../lib/auth';
import { LanguageSwitcher } from './LanguageSwitcher';
import { Spinner } from './ui';

/** Оболочка для залогиненных: шапка + нижняя навигация (удобно большим пальцем). */
export function AppLayout() {
  const { t } = useTranslation();
  const { data: me, isLoading } = useMe();
  const role = useCurrentRole();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const setMe = useSetMe();
  const qc = useQueryClient();

  if (isLoading) return <Spinner />;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  // Касса: сканер — главный экран. Владельцу ещё клиенты и настройки.
  const nav = [
    { to: '/', label: t('nav.scan'), icon: '⌖' },
    { to: '/customers', label: t('nav.customers'), icon: '☺' },
    ...(role === 'OWNER' ? [{ to: '/settings', label: t('nav.settings'), icon: '⚙' }] : []),
  ];

  async function switchSalon(salonId: string) {
    const next = await api.post<MeResponse>('/auth/switch-salon', { salonId });
    qc.clear();
    setMe(next);
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-stone-200 bg-stone-50/90 px-4 py-3 backdrop-blur">
        {me.salons.length > 1 ? (
          <select
            className="min-w-0 truncate bg-transparent text-base font-semibold"
            value={me.currentSalonId ?? ''}
            onChange={(e) => void switchSalon(e.target.value)}
          >
            {me.salons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="truncate text-base font-semibold">{me.salons[0]?.name ?? 'Pečiatka'}</span>
        )}
        <div className="flex shrink-0 items-center gap-2">
          <LanguageSwitcher persist />
          <button
            className="text-sm text-stone-500"
            onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/login') })}
          >
            {t('common.logout')}
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 pb-28 pt-4">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-2xl">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs ${isActive ? 'font-semibold text-stone-900' : 'text-stone-500'}`
              }
            >
              <span className="text-lg leading-none">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

/** Оболочка для публичных страниц (логин, регистрация). */
export function AuthLayout() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-6">
      <div className="mb-8 flex items-center justify-between">
        <span className="flex items-center gap-2 text-lg font-bold">
          <img src="/favicon.svg" alt="" className="size-7" /> Pečiatka
        </span>
        <LanguageSwitcher />
      </div>
      <Outlet />
    </div>
  );
}
