import { useEffect } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LOCALES, updateSalonSchema, type SalonDto } from '@peciatka/shared';
import { api } from '../lib/api';
import { meKey, useCurrentRole, useMe } from '../lib/auth';
import { Alert, Button, Card, ErrorAlert, Field, Input, Select, Spinner } from '../components/ui';

const LOCALE_NAMES = { sk: 'Slovenčina', en: 'English', uk: 'Українська' } as const;

export function SettingsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const role = useCurrentRole();
  const { data: me } = useMe();
  const isOwner = role === 'OWNER';

  const salon = useQuery({ queryKey: ['salon'], queryFn: () => api.get<SalonDto>('/salon') });
  const form = useForm({ resolver: zodResolver(updateSalonSchema) });

  useEffect(() => {
    if (salon.data) {
      const { name, address, phone, defaultLocale } = salon.data;
      form.reset({ name, address: address ?? '', phone: phone ?? '', defaultLocale });
    }
  }, [salon.data, form]);

  const save = useMutation({
    mutationFn: (v: unknown) => api.patch<SalonDto>('/salon', v),
    onSuccess: (data) => {
      qc.setQueryData(['salon'], data);
      void qc.invalidateQueries({ queryKey: meKey }); // имя салона в шапке
    },
  });

  if (salon.isLoading) return <Spinner />;
  if (salon.error) return <ErrorAlert error={salon.error} />;
  const { errors } = form.formState;
  const publicUrl = `${window.location.origin}/j/${salon.data!.slug}`;

  return (
    <div className="space-y-5">
      <Card flush>
        <ul className="divide-y divide-stone-100">
          {[
            { to: '/program', label: t('nav.program') },
            ...(isOwner
              ? [
                  { to: '/staff', label: t('nav.staff') },
                  { to: '/audit', label: t('nav.audit') },
                ]
              : []),
          ].map((l) => (
            <li key={l.to}>
              <Link to={l.to} className="flex items-center justify-between px-5 py-4 font-medium">
                {l.label} <span className="text-stone-400">›</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <h1 className="text-2xl font-bold">{t('settings.title')}</h1>

      <Card>
        <form className="space-y-4" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
          <fieldset disabled={!isOwner} className="space-y-4">
            <ErrorAlert error={save.error} />
            {save.isSuccess && !form.formState.isDirty && <Alert kind="success">{t('common.saved')}</Alert>}
            <Field label={t('settings.salon_name')} error={errors.name?.message}>
              <Input {...form.register('name')} />
            </Field>
            <Field label={t('settings.address')} error={errors.address?.message}>
              <Input autoComplete="street-address" {...form.register('address')} />
            </Field>
            <Field label={t('settings.phone')} error={errors.phone?.message}>
              <Input type="tel" inputMode="tel" {...form.register('phone')} />
            </Field>
            <Field label={t('settings.default_locale')}>
              <Select {...form.register('defaultLocale')}>
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {LOCALE_NAMES[l]}
                  </option>
                ))}
              </Select>
            </Field>
            {isOwner && (
              <Button type="submit" className="w-full" loading={save.isPending}>
                {t('common.save')}
              </Button>
            )}
          </fieldset>
        </form>
      </Card>

      <Card className="space-y-1">
        <p className="text-sm text-stone-500">{t('settings.public_link')}</p>
        <p className="break-all font-mono text-sm">{publicUrl}</p>
      </Card>

      <Card className="space-y-1">
        <p className="text-sm text-stone-500">{t('settings.profile')}</p>
        <p className="font-medium">{me?.user.name}</p>
        <p className="text-sm text-stone-500">{me?.user.email}</p>
      </Card>
    </div>
  );
}
