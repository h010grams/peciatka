import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { joinSchema, LOCALES, type CounterRegisterResponse, type Locale } from '@peciatka/shared';
import { api } from '../lib/api';
import { Button, Card, ErrorAlert, Field, Input, Select } from '../components/ui';

const LOCALE_NAMES = { sk: 'Slovenčina', en: 'English', uk: 'Українська' } as const;

/** Регистрация клиентки на кассе: 20 секунд вместо «отсканируйте постер и заполните форму». */
export function NewCustomerPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const form = useForm({
    resolver: zodResolver(joinSchema),
    defaultValues: { name: '', phone: '', email: '', locale: (i18n.language as Locale) ?? 'sk' },
  });
  const register = useMutation({
    mutationFn: (v: object) => api.post<CounterRegisterResponse>('/cards/register', v),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['customers'] });
      // на экране карты сразу показываем QR, чтобы клиентка добавила карту в Wallet
      navigate(`/cards/${r.cardId}`, { state: { registered: r } });
    },
  });
  const { errors } = form.formState;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t('newcust.title')}</h1>
        <p className="text-sm text-stone-600">{t('newcust.text')}</p>
      </div>
      <Card>
        <form className="space-y-4" onSubmit={form.handleSubmit((v) => register.mutate(v))} noValidate>
          <ErrorAlert error={register.error} />
          <Field label={t('join.name')} error={errors.name?.message}>
            <Input autoComplete="off" autoFocus {...form.register('name')} />
          </Field>
          <Field label={t('join.phone')} error={errors.phone?.message}>
            <Input type="tel" inputMode="tel" autoComplete="off" placeholder="0905 123 456" {...form.register('phone')} />
          </Field>
          <Field label={t('join.email')} error={errors.email?.message}>
            <Input type="email" inputMode="email" autoComplete="off" {...form.register('email')} />
          </Field>
          <p className="-mt-2 text-xs text-stone-500">{t('join.contact_hint')}</p>
          <Field label={t('newcust.language')}>
            <Select {...form.register('locale')}>
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_NAMES[l]}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-stone-900" {...form.register('consent')} />
            <span>{t('newcust.consent')}</span>
          </label>
          {errors.consent && <p className="-mt-2 text-sm text-red-600">{t(errors.consent.message ?? 'v.consent')}</p>}
          <Button type="submit" className="min-h-14 w-full text-lg" loading={register.isPending}>
            {t('newcust.submit')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
