import { Link, Outlet, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { joinSchema, type Locale, type PublicCardDto, type PublicSalonDto } from '@peciatka/shared';
import { api } from '../lib/api';
import { CardVisual } from '../components/CardVisual';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { Alert, Button, ErrorAlert, Field, Input, Spinner } from '../components/ui';

const APP_NAME = 'Pečiatka';

function savedCard(slug: string): string | null {
  try {
    return localStorage.getItem(`card:${slug}`);
  } catch {
    return null;
  }
}
function rememberCard(slug: string, serial: string) {
  try {
    localStorage.setItem(`card:${slug}`, serial);
  } catch {
    // приватный режим — не страшно, карта всё равно в Wallet
  }
}

function usePublicSalon(slug: string) {
  return useQuery({
    queryKey: ['public-salon', slug],
    queryFn: () => api.get<PublicSalonDto>(`/public/salons/${slug}`),
    retry: false,
  });
}

export function PublicLayout() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-10 pt-4">
      <div className="mb-4 flex justify-end">
        <LanguageSwitcher />
      </div>
      <Outlet />
      <p className="mt-auto pt-10 text-center text-xs text-stone-400">{APP_NAME}</p>
    </div>
  );
}

// ───────── /j/:slug — регистрация по QR с постера ─────────

export function JoinPage() {
  const { slug = '' } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const salon = usePublicSalon(slug);
  const form = useForm({ resolver: zodResolver(joinSchema), defaultValues: { name: '', phone: '', email: '' } });
  const join = useMutation({
    mutationFn: (v: object) =>
      api.post<{ serial: string }>(`/public/salons/${slug}/join`, { ...v, locale: i18n.language as Locale }),
    onSuccess: ({ serial }) => {
      rememberCard(slug, serial);
      navigate(`/c/${serial}`);
    },
  });

  if (salon.isLoading) return <Spinner />;
  if (salon.error) return <Alert>{t('join.not_found')}</Alert>;
  const s = salon.data!;
  const p = s.program;
  const existing = savedCard(slug);
  const { errors } = form.formState;

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold">{s.name}</h1>
        <p className="text-stone-600">{t('join.title')}</p>
      </div>

      {!p ? (
        <Alert kind="info">{t('join.no_program')}</Alert>
      ) : (
        <>
          <CardVisual
            salonName={s.name}
            logoUrl={p.logoUrl}
            stampCount={0}
            stampsRequired={p.stampsRequired}
            rewardText={p.rewardText}
            bgColor={p.bgColor}
            fgColor={p.fgColor}
            labelColor={p.labelColor}
          />
          <p className="text-center font-semibold">
            {t('join.reward_line', { n: p.stampsRequired, reward: p.rewardText })}
          </p>

          {existing && (
            <Alert kind="info">
              {t('join.have_card')}{' '}
              <Link to={`/c/${existing}`} className="font-semibold underline">
                {t('join.open_my_card')}
              </Link>
            </Alert>
          )}

          <form className="space-y-4" onSubmit={form.handleSubmit((v) => join.mutate(v))} noValidate>
            <ErrorAlert error={join.error} />
            <Field label={t('join.name')} error={errors.name?.message}>
              <Input autoComplete="given-name" {...form.register('name')} />
            </Field>
            <Field label={t('join.phone')} error={errors.phone?.message}>
              <Input type="tel" inputMode="tel" autoComplete="tel" placeholder="0905 123 456" {...form.register('phone')} />
            </Field>
            <Field label={t('join.email')} error={errors.email?.message}>
              <Input type="email" inputMode="email" autoComplete="email" {...form.register('email')} />
            </Field>
            <p className="-mt-2 text-xs text-stone-500">{t('join.contact_hint')}</p>

            <label className="flex gap-3 text-sm">
              <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-stone-900" {...form.register('consent')} />
              <span>
                {t('join.consent', { salon: s.name })}{' '}
                <Link to={`/j/${slug}/privacy`} className="underline">
                  {t('join.privacy_link')}
                </Link>
              </span>
            </label>
            {errors.consent && <p className="-mt-2 text-sm text-red-600">{t(errors.consent.message ?? 'v.consent')}</p>}

            <Button type="submit" className="w-full" loading={join.isPending}>
              {t('join.submit')}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}

// ───────── /c/:serial — карта клиентки ─────────

function platform(): 'ios' | 'android' | 'other' {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

function WalletButton({ href, kind }: { href: string; kind: 'apple' | 'google' }) {
  const { t } = useTranslation();
  return (
    <a
      href={href}
      className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-black px-4 text-sm font-semibold text-white active:bg-stone-800"
    >
      <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="6" width="18" height="13" rx="3" />
        <path d="M3 10h18M16 14.5h2" strokeLinecap="round" />
      </svg>
      {t(kind === 'apple' ? 'public_card.add_apple' : 'public_card.add_google')}
    </a>
  );
}

export function CardPage() {
  const { serial = '' } = useParams();
  const { t } = useTranslation();
  const card = useQuery({
    queryKey: ['public-card', serial],
    queryFn: () => api.get<PublicCardDto>(`/public/cards/${serial}`),
    retry: false,
    refetchInterval: 20_000, // веб-карта обновляется после штампа без перезагрузки
    refetchOnWindowFocus: true,
  });

  if (card.isLoading) return <Spinner />;
  if (card.error) return <Alert>{t('public_card.not_found')}</Alert>;
  const c = card.data!;
  const os = platform();
  const buttons = (
    [
      c.wallet.apple && { kind: 'apple' as const, href: `/api/public/cards/${serial}/pass.pkpass` },
      c.wallet.google && { kind: 'google' as const, href: `/api/public/cards/${serial}/google` },
    ].filter(Boolean) as { kind: 'apple' | 'google'; href: string }[]
  )
    // на iPhone — только Apple, на Android — только Google, на компьютере — обе
    .filter((b) => os === 'other' || (os === 'ios' ? b.kind === 'apple' : b.kind === 'google'));
  const left = c.stampsRequired - c.stampCount;

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h1 className="text-xl font-bold">{c.salonName}</h1>
        <p className="text-stone-600">{c.customerName}</p>
      </div>

      {buttons.length > 0 && (
        <div className="space-y-2">
          {buttons.map((b) => (
            <WalletButton key={b.kind} {...b} />
          ))}
          <p className="text-center text-xs text-stone-500">{t('public_card.wallet_hint')}</p>
        </div>
      )}

      <CardVisual
        salonName={c.salonName}
        logoUrl={c.logoUrl}
        stampCount={c.stampCount}
        stampsRequired={c.stampsRequired}
        rewardText={c.rewardText}
        rewardsAvailable={c.rewardsAvailable}
        bgColor={c.bgColor}
        fgColor={c.fgColor}
        labelColor={c.labelColor}
        qrUrl={`/api/public/cards/${serial}/qr.svg`}
        nextAppointmentAt={c.nextAppointmentAt}
        timezone={c.timezone}
      />

      <div className="space-y-2 text-center">
        {c.rewardsAvailable > 0 ? (
          <p className="text-lg font-semibold">{t('public_card.reward_ready', { reward: c.rewardText })}</p>
        ) : (
          <p className="font-semibold">{t('public_card.stamps_left', { count: left })}</p>
        )}
        <p className="text-sm text-stone-500">{t('public_card.show_qr')}</p>
        {buttons.length === 0 && <p className="text-xs text-stone-500">{t('public_card.save_page')}</p>}
      </div>
    </div>
  );
}

// ───────── /j/:slug/privacy ─────────

export function PrivacyPage() {
  const { slug = '' } = useParams();
  const { t } = useTranslation();
  const salon = usePublicSalon(slug);
  if (salon.isLoading) return <Spinner />;
  if (salon.error) return <Alert>{t('join.not_found')}</Alert>;
  const s = salon.data!;
  const address = [s.address, s.phone].filter(Boolean).join(', ');
  const vars = { salon: s.name, address: address ? `, ${address}` : '', app: APP_NAME };
  return (
    <article className="space-y-3 text-sm leading-relaxed text-stone-700">
      <h1 className="text-xl font-bold text-stone-900">{t('privacy.title')}</h1>
      {(['p_controller', 'p_data', 'p_purpose', 'p_basis', 'p_retention', 'p_rights', 'p_processor'] as const).map((k) => (
        <p key={k}>{t(`privacy.${k}`, vars)}</p>
      ))}
      <Link to={`/j/${slug}`} className="inline-block pt-2 font-semibold underline">
        {t('common.back')}
      </Link>
    </article>
  );
}
