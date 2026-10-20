import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { STATS_PERIODS, type ProgramDto, type StatsDto, type StatsPeriod } from '@peciatka/shared';
import { api } from '../lib/api';
import { useCurrentRole, useMe } from '../lib/auth';
import i18n from '../lib/i18n';
import { Card, ErrorAlert, Spinner } from '../components/ui';

function Tile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Card className="space-y-0.5 p-4">
      <p className="text-3xl font-bold tabular-nums">{value}</p>
      <p className="text-sm font-medium text-stone-700">{label}</p>
      {hint && <p className="text-xs text-stone-500">{hint}</p>}
    </Card>
  );
}

const dayLabel = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(i18n.language, { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

/** Одна серия → один цвет, без легенды; подсказка при наведении/тапе на каждый столбец. */
function DailyChart({ data }: { data: StatsDto['daily'] }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(1, ...data.map((d) => d.visits));
  const active = hover !== null ? data[hover] : null;
  const ticks = [0, Math.floor((data.length - 1) / 2), data.length - 1];

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{t('stats.daily_title')}</h2>
        <button className="text-sm text-stone-500 underline" onClick={() => setAsTable((v) => !v)}>
          {asTable ? t('stats.chart') : t('stats.table')}
        </button>
      </div>

      {asTable ? (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-stone-500">
              <tr>
                <th className="py-1 font-medium">{t('stats.date')}</th>
                <th className="py-1 text-right font-medium">{t('stats.visits')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {[...data].reverse().map((d) => (
                <tr key={d.date}>
                  <td className="py-1.5">{dayLabel(d.date, { weekday: 'short', day: 'numeric', month: 'numeric' })}</td>
                  <td className="py-1.5 text-right tabular-nums">{d.visits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          {/* подсказка над столбцом */}
          <div className="h-6 text-sm text-stone-700">
            {active && (
              <span>
                <span className="font-semibold tabular-nums">{active.visits}</span> ·{' '}
                {dayLabel(active.date, { weekday: 'short', day: 'numeric', month: 'numeric' })}
              </span>
            )}
          </div>
          <div className="flex h-40 border-b border-stone-300" onMouseLeave={() => setHover(null)}>
            {data.map((d, i) => (
              <button
                key={d.date}
                type="button"
                aria-label={`${d.date}: ${d.visits}`}
                // зона попадания — вся колонка, а не только столбец
                className="group flex h-full flex-1 items-end px-px"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onClick={() => setHover(i)}
              >
                <span
                  className={`block w-full rounded-t-[4px] ${hover === i ? 'bg-brand-700' : 'bg-brand-600'}`}
                  style={{ height: d.visits ? `${(d.visits / max) * 100}%` : 0 }}
                />
              </button>
            ))}
          </div>
          <div className="relative mt-1 h-4 text-xs text-stone-500">
            {ticks.map((i, k) => (
              <span
                key={k}
                className="absolute"
                style={{ left: `${((i + 0.5) / data.length) * 100}%`, transform: k === 0 ? 'none' : k === 2 ? 'translateX(-100%)' : 'translateX(-50%)' }}
              >
                {dayLabel(data[i]!.date, { day: 'numeric', month: 'numeric' })}
              </span>
            ))}
          </div>
          <p className="absolute right-0 top-6 text-xs text-stone-400 tabular-nums">{max}</p>
        </div>
      )}
    </Card>
  );
}

function Setup({ hasProgram, isOwner }: { hasProgram: boolean; isOwner: boolean }) {
  const { t } = useTranslation();
  const steps = [
    { label: t('dashboard.step_program'), to: '/program', done: hasProgram },
    { label: t('dashboard.step_poster'), to: '/program', done: false },
    ...(isOwner ? [{ label: t('dashboard.step_staff'), to: '/staff', done: false }] : []),
  ];
  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">{t('dashboard.next_steps')}</h2>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-3">
            <span
              className={`flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                s.done ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-100 text-brand-700'
              }`}
            >
              {s.done ? '✓' : i + 1}
            </span>
            <Link to={s.to} className={s.done ? 'text-stone-400 line-through' : 'underline'}>
              {s.label}
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const role = useCurrentRole();
  const [period, setPeriod] = useState<StatsPeriod>('30d');
  const isOwner = role === 'OWNER';

  const program = useQuery({ queryKey: ['program'], queryFn: () => api.get<{ program: ProgramDto | null }>('/program') });
  const stats = useQuery({
    queryKey: ['stats', period],
    queryFn: () => api.get<StatsDto>(`/stats?period=${period}`),
    enabled: isOwner,
  });

  // у мастера главный экран — сканер
  if (role === 'STAFF') return <Navigate to="/scan" replace />;
  if (program.isLoading) return <Spinner />;
  const s = stats.data;
  const showSetup = !program.data?.program || (s && s.totalCustomers === 0);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('dashboard.welcome', { name: me?.user.name })}</h1>
      {showSetup && <Setup hasProgram={!!program.data?.program} isOwner={isOwner} />}

      <div className="flex rounded-xl bg-stone-200/60 p-1 text-sm font-medium">
        {STATS_PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`flex-1 rounded-lg py-2 ${period === p ? 'bg-white shadow-sm' : 'text-stone-600'}`}
          >
            {t(`stats.period_${p}`)}
          </button>
        ))}
      </div>

      <ErrorAlert error={stats.error} />
      {stats.isLoading && <Spinner />}
      {s && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Tile label={t('stats.visits')} value={s.visits} />
            <Tile label={t('stats.new_customers')} value={s.newCustomers} />
            <Tile label={t('stats.returning')} value={s.returningCustomers} hint={t('stats.returning_hint')} />
            <Tile label={t('stats.rewards_redeemed')} value={s.rewardsRedeemed} />
          </div>
          <DailyChart data={s.daily} />
          <Card className="grid grid-cols-3 gap-2 p-4 text-center">
            <div>
              <p className="text-xl font-bold tabular-nums">{s.totalCustomers}</p>
              <p className="text-xs text-stone-500">{t('stats.total_customers')}</p>
            </div>
            <div>
              <p className="text-xl font-bold tabular-nums">{s.activeCustomers}</p>
              <p className="text-xs text-stone-500">{t('stats.active')}</p>
            </div>
            <div>
              <p className="text-xl font-bold tabular-nums">{s.rewardsEarned}</p>
              <p className="text-xs text-stone-500">{t('stats.rewards_earned')}</p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
