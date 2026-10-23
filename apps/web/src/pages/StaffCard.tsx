import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CounterRegisterResponse, StaffCardDto, StampResultDto } from '@peciatka/shared';
import { api, ApiError } from '../lib/api';
import { formatDateTime, formatRelative, toLocalInput } from '../lib/format';
import { Button, Card, ErrorAlert, Input, Spinner, buttonClass } from '../components/ui';

type Feedback = { kind: 'success' | 'error' | 'reward'; text: string } | null;

/** После штампа касса сама возвращается к сканеру — следующая клиентка уже ждёт. */
const AUTO_RETURN_SECONDS = 5;

function Dots({ filled, total }: { filled: number; total: number }) {
  return (
    <div className="flex flex-wrap justify-center gap-2" aria-label={`${filled}/${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`size-7 rounded-full ${
            i < filled
              ? 'bg-stone-900'
              : i === total - 1
                ? 'border-2 border-dashed border-brand-600'
                : 'border-2 border-stone-300'
          }`}
        />
      ))}
    </div>
  );
}

export function StaffCardPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [appt, setAppt] = useState('');
  const [countdown, setCountdown] = useState<number | null>(null);
  // пришли с экрана «Новая клиентка» — сразу показываем QR для добавления карты в Wallet
  const registered = (useLocation().state as { registered?: CounterRegisterResponse } | null)?.registered;
  const [showQr, setShowQr] = useState(!!registered);
  useEffect(() => {
    if (!registered) return;
    setFeedback({
      kind: registered.firstStamp ? 'reward' : 'success',
      text: registered.created
        ? t(registered.firstStamp ? 'newcust.created_stamp' : 'newcust.created')
        : t('newcust.existing'),
    });
  }, [registered, t]);

  const key = ['staff-card', id];
  const card = useQuery({ queryKey: key, queryFn: () => api.get<StaffCardDto>(`/cards/${id}`) });
  const c = card.data;

  useEffect(() => {
    setAppt(c?.nextAppointmentAt ? toLocalInput(c.nextAppointmentAt, c.timezone) : '');
  }, [c?.nextAppointmentAt, c?.timezone]);

  // обратный отсчёт до возврата к сканеру
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      navigate('/');
      return;
    }
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, navigate]);
  const stay = () => setCountdown(null);

  const onError = (e: unknown) => {
    const err = e instanceof ApiError ? e : null;
    let text = t(`errors.${err?.code ?? 'internal'}`, { defaultValue: t('errors.internal') });
    if (err?.code === 'cooldown' && typeof err.details?.retryAt === 'string') {
      text = t('staffcard.cooldown', { when: formatDateTime(err.details.retryAt, c?.timezone) });
    }
    setFeedback({ kind: 'error', text });
    setCountdown(null);
    void card.refetch();
  };
  const update = (next: StaffCardDto) => {
    qc.setQueryData(key, next);
    void qc.invalidateQueries({ queryKey: ['customers'] });
  };

  const stamp = useMutation({
    mutationFn: () => api.post<StampResultDto>(`/cards/${id}/stamps`),
    onSuccess: (r) => {
      update(r.card);
      navigator.vibrate?.(r.rewardEarned ? [60, 60, 120] : 60);
      setFeedback(
        r.rewardEarned
          ? { kind: 'reward', text: t('staffcard.reward_earned') }
          : { kind: 'success', text: t('staffcard.stamp_added', { count: r.card.stampCount, n: r.card.stampsRequired }) },
      );
      // если клиентка только что получила награду — не уходим, её можно сразу применить
      setCountdown(r.rewardEarned ? null : AUTO_RETURN_SECONDS);
    },
    onError,
  });
  const redeem = useMutation({
    mutationFn: () => api.post<{ card: StaffCardDto }>(`/cards/${id}/rewards/redeem`),
    onSuccess: (r) => {
      update(r.card);
      setFeedback({ kind: 'success', text: t('staffcard.redeemed') });
      setCountdown(AUTO_RETURN_SECONDS);
    },
    onError,
  });
  const revoke = useMutation({
    mutationFn: () => api.post<{ card: StaffCardDto }>(`/cards/${id}/stamps/revoke-last`),
    onSuccess: (r) => {
      update(r.card);
      setFeedback({ kind: 'success', text: t('staffcard.revoked') });
      setCountdown(null);
    },
    onError,
  });
  const saveAppt = useMutation({
    mutationFn: () => api.put<{ card: StaffCardDto }>(`/cards/${id}/appointment`, { startsAt: appt }),
    onSuccess: (r) => {
      update(r.card);
      setFeedback({ kind: 'success', text: t('staffcard.appointment_saved') });
      setCountdown(AUTO_RETURN_SECONDS);
    },
    onError,
  });
  const removeAppt = useMutation({
    mutationFn: () => api.delete<{ card: StaffCardDto }>(`/cards/${id}/appointment`),
    onSuccess: (r) => update(r.card),
    onError,
  });

  if (card.isLoading) return <Spinner />;
  if (card.error || !c) return <ErrorAlert error={card.error} />;
  const busy = stamp.isPending || redeem.isPending || revoke.isPending;

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h1 className="text-3xl font-bold">{c.customer.name}</h1>
        <p className="text-sm text-stone-500">
          {t('staffcard.visits', { count: c.totalVisits })}
          {c.lastStampAt && ` · ${t('staffcard.last_visit', { when: formatRelative(c.lastStampAt) })}`}
        </p>
      </div>

      {feedback && (
        <div
          role="status"
          className={`rounded-2xl px-4 py-4 text-center text-lg font-semibold ${
            feedback.kind === 'error'
              ? 'bg-red-50 text-red-800'
              : feedback.kind === 'reward'
                ? 'bg-brand-100 text-brand-700'
                : 'bg-emerald-50 text-emerald-800'
          }`}
        >
          {feedback.text}
          {countdown !== null && (
            <div className="mt-2 flex items-center justify-center gap-3 text-sm font-normal">
              <span>{t('counter.back_in', { s: countdown })}</span>
              <button className="font-semibold underline" onClick={stay}>
                {t('counter.stay')}
              </button>
            </div>
          )}
        </div>
      )}

      {showQr && (
        <Card className="space-y-3 text-center">
          <h2 className="text-lg font-semibold">{t('walletqr.title')}</h2>
          <p className="text-sm text-stone-600">{t('walletqr.text')}</p>
          <div className="flex justify-center">
            <img src={`/api/cards/${id}/wallet-qr.svg`} alt="QR" className="size-56 rounded-xl bg-white p-2" />
          </div>
          <Button variant="secondary" className="w-full" onClick={() => setShowQr(false)}>
            {t('walletqr.done')}
          </Button>
        </Card>
      )}

      {/* Награда — первое, что видит администратор: её применяют при оплате */}
      {c.rewardsAvailable > 0 && (
        <div className="space-y-3 rounded-2xl border-2 border-brand-300 bg-brand-50 p-4 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">{t('counter.reward_title')}</p>
          <p className="text-2xl font-bold">{c.rewardText}</p>
          <Button
            className="min-h-14 w-full text-lg"
            loading={redeem.isPending}
            disabled={busy}
            onClick={() => window.confirm(t('staffcard.redeem_confirm', { reward: c.rewardText })) && redeem.mutate()}
          >
            {t('counter.redeem_now')}
          </Button>
        </div>
      )}

      <Card className="space-y-4 text-center">
        <p className="text-4xl font-bold tabular-nums">
          {c.stampCount}
          <span className="text-stone-400"> / {c.stampsRequired}</span>
        </p>
        <Dots filled={c.stampCount} total={c.stampsRequired} />
        <Button
          className="min-h-16 w-full text-xl"
          loading={stamp.isPending}
          disabled={busy || !!c.nextStampAllowedAt}
          onClick={() => stamp.mutate()}
        >
          {t('staffcard.add_stamp')}
        </Button>
        {c.nextStampAllowedAt && (
          <p className="text-sm text-stone-600">
            {t('staffcard.cooldown', { when: formatDateTime(c.nextStampAllowedAt, c.timezone) })}
          </p>
        )}
      </Card>

      {/* Любое касание блока записи останавливает автовозврат */}
      <Card className="space-y-3" >
        <div onFocusCapture={stay} onPointerDownCapture={stay} className="space-y-3">
          <h2 className="font-semibold">{t('staffcard.appointment')}</h2>
          {c.nextAppointmentAt && (
            <p className="rounded-xl bg-stone-100 px-4 py-3 text-sm">{formatDateTime(c.nextAppointmentAt, c.timezone)}</p>
          )}
          <Input type="datetime-local" value={appt} onChange={(e) => setAppt(e.target.value)} />
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" disabled={!appt} loading={saveAppt.isPending} onClick={() => saveAppt.mutate()}>
              {t('staffcard.appointment_save')}
            </Button>
            {c.nextAppointmentAt && (
              <Button variant="danger" loading={removeAppt.isPending} onClick={() => removeAppt.mutate()}>
                {t('staffcard.appointment_remove')}
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Link to="/" className={buttonClass('secondary', 'w-full')}>
        {t('counter.next')}
      </Link>

      <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 pb-2 text-sm text-stone-500">
        {c.revocable && (
          <button
            className="underline disabled:opacity-50"
            disabled={busy}
            onClick={() => window.confirm(t('staffcard.revoke_confirm')) && revoke.mutate()}
          >
            {t('staffcard.revoke')}
          </button>
        )}
        {!showQr && (
          <button className="underline" onClick={() => { stay(); setShowQr(true); }}>
            {t('walletqr.show')}
          </button>
        )}
        <Link to={`/customers/${c.customer.id}`} className="underline">
          {t('staffcard.customer_detail')}
        </Link>
      </div>
    </div>
  );
}
