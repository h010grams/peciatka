import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  type Locale,
  type MeResponse,
} from '@peciatka/shared';
import { api } from '../lib/api';
import { useMe, useSetMe } from '../lib/auth';
import { Alert, Button, ErrorAlert, Field, Input } from '../components/ui';

function useRedirectTarget() {
  const location = useLocation();
  return (location.state as { from?: string } | null)?.from ?? '/';
}

export function LoginPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const setMe = useSetMe();
  const navigate = useNavigate();
  const target = useRedirectTarget();
  const form = useForm({ resolver: zodResolver(loginSchema) });
  const login = useMutation({
    mutationFn: (v: unknown) => api.post<MeResponse>('/auth/login', v),
    onSuccess: (me) => {
      setMe(me);
      navigate(target, { replace: true });
    },
  });

  if (me) return <Navigate to={target} replace />;
  const { errors } = form.formState;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('auth.login_title')}</h1>
      <form className="space-y-4" onSubmit={form.handleSubmit((v) => login.mutate(v))} noValidate>
        <ErrorAlert error={login.error} />
        <Field label={t('common.email')} error={errors.email?.message}>
          <Input type="email" autoComplete="email" inputMode="email" {...form.register('email')} />
        </Field>
        <Field label={t('common.password')} error={errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...form.register('password')} />
        </Field>
        <Button type="submit" className="w-full" loading={login.isPending}>
          {t('auth.login_submit')}
        </Button>
      </form>
      <div className="space-y-2 text-center text-sm">
        <Link to="/forgot-password" className="text-stone-600 underline">
          {t('auth.forgot_link')}
        </Link>
        <p className="text-stone-600">
          {t('auth.no_account')}{' '}
          <Link to="/register" className="font-semibold text-stone-900 underline">
            {t('auth.register_link')}
          </Link>
        </p>
      </div>
    </div>
  );
}

export function RegisterPage() {
  const { t, i18n } = useTranslation();
  const { data: me } = useMe();
  const setMe = useSetMe();
  const navigate = useNavigate();
  const form = useForm({ resolver: zodResolver(registerSchema) });
  const register = useMutation({
    mutationFn: (v: object) => api.post<MeResponse>('/auth/register', { ...v, locale: i18n.language as Locale }),
    onSuccess: (me) => {
      setMe(me);
      navigate('/', { replace: true });
    },
  });

  if (me) return <Navigate to="/" replace />;
  const { errors } = form.formState;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t('auth.register_title')}</h1>
        <p className="text-stone-600">{t('auth.register_subtitle')}</p>
      </div>
      <form className="space-y-4" onSubmit={form.handleSubmit((v) => register.mutate(v))} noValidate>
        <ErrorAlert error={register.error} />
        <Field label={t('auth.salon_name')} error={errors.salonName?.message}>
          <Input autoComplete="organization" {...form.register('salonName')} />
        </Field>
        <Field label={t('auth.your_name')} error={errors.name?.message}>
          <Input autoComplete="name" {...form.register('name')} />
        </Field>
        <Field label={t('common.email')} error={errors.email?.message}>
          <Input type="email" autoComplete="email" inputMode="email" {...form.register('email')} />
        </Field>
        <Field label={t('common.password')} error={errors.password?.message}>
          <Input type="password" autoComplete="new-password" {...form.register('password')} />
        </Field>
        <Button type="submit" className="w-full" loading={register.isPending}>
          {t('auth.register_submit')}
        </Button>
      </form>
      <p className="text-center text-sm text-stone-600">
        {t('auth.have_account')}{' '}
        <Link to="/login" className="font-semibold text-stone-900 underline">
          {t('auth.login_submit')}
        </Link>
      </p>
    </div>
  );
}

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const form = useForm({ resolver: zodResolver(forgotPasswordSchema) });
  const forgot = useMutation({ mutationFn: (v: unknown) => api.post('/auth/forgot-password', v) });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t('auth.forgot_title')}</h1>
        <p className="text-stone-600">{t('auth.forgot_text')}</p>
      </div>
      {forgot.isSuccess ? (
        <Alert kind="success">{t('auth.forgot_sent')}</Alert>
      ) : (
        <form className="space-y-4" onSubmit={form.handleSubmit((v) => forgot.mutate(v))} noValidate>
          <ErrorAlert error={forgot.error} />
          <Field label={t('common.email')} error={form.formState.errors.email?.message}>
            <Input type="email" autoComplete="email" inputMode="email" {...form.register('email')} />
          </Field>
          <Button type="submit" className="w-full" loading={forgot.isPending}>
            {t('auth.forgot_submit')}
          </Button>
        </form>
      )}
      <Link to="/login" className="block text-center text-sm text-stone-600 underline">
        {t('auth.to_login')}
      </Link>
    </div>
  );
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [done, setDone] = useState(false);
  const form = useForm({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token: params.get('token') ?? '' },
  });
  const reset = useMutation({
    mutationFn: (v: unknown) => api.post('/auth/reset-password', v),
    onSuccess: () => setDone(true),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('auth.reset_title')}</h1>
      {done ? (
        <Alert kind="success">{t('auth.reset_done')}</Alert>
      ) : (
        <form className="space-y-4" onSubmit={form.handleSubmit((v) => reset.mutate(v))} noValidate>
          <ErrorAlert error={reset.error} />
          {form.formState.errors.token && <Alert>{t('errors.token_invalid')}</Alert>}
          <Field label={t('auth.new_password')} error={form.formState.errors.password?.message}>
            <Input type="password" autoComplete="new-password" {...form.register('password')} />
          </Field>
          <Button type="submit" className="w-full" loading={reset.isPending}>
            {t('auth.reset_submit')}
          </Button>
        </form>
      )}
      <Link to="/login" className="block text-center text-sm text-stone-600 underline">
        {t('auth.to_login')}
      </Link>
    </div>
  );
}
