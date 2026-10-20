import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import type { InviteInfoResponse, MeResponse } from '@peciatka/shared';
import { api } from '../lib/api';
import { useLogout, useMe, useSetMe } from '../lib/auth';
import { Alert, Button, Card, ErrorAlert, Field, Input, Spinner, buttonClass } from '../components/ui';

const newAccountSchema = z.object({
  name: z.string().trim().min(1, 'v.required').max(100, 'v.too_long'),
  password: z.string().min(8, 'v.password_min').max(200, 'v.too_long'),
});

export function AcceptInvitePage() {
  const { token = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: me, isLoading: meLoading } = useMe();
  const setMe = useSetMe();
  const logout = useLogout();

  const info = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<InviteInfoResponse>(`/invites/${token}`),
    retry: false,
  });
  const accept = useMutation({
    mutationFn: (body: object) => api.post<MeResponse>(`/invites/${token}/accept`, body),
    onSuccess: (next) => {
      setMe(next);
      navigate('/', { replace: true });
    },
  });
  const form = useForm({ resolver: zodResolver(newAccountSchema) });

  if (info.isLoading || meLoading) return <Spinner />;
  if (info.error) return <ErrorAlert error={info.error} />;
  const invite = info.data!;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('invite.title')}</h1>
      <Card>
        <p className="text-lg">
          {t('invite.text', { salon: invite.salonName, role: t(`roles.${invite.role}`) })}
        </p>
        <p className="mt-1 text-sm text-stone-500">{invite.email}</p>
      </Card>
      <ErrorAlert error={accept.error} />

      {me ? (
        me.user.email === invite.email ? (
          <Button className="w-full" loading={accept.isPending} onClick={() => accept.mutate({})}>
            {t('invite.accept')}
          </Button>
        ) : (
          <div className="space-y-3">
            <Alert kind="info">
              {t('invite.wrong_account', { current: me.user.email, email: invite.email })}
            </Alert>
            <Button variant="secondary" className="w-full" onClick={() => logout.mutate()}>
              {t('common.logout')}
            </Button>
          </div>
        )
      ) : invite.userExists ? (
        <div className="space-y-3">
          <Alert kind="info">{t('invite.login_required', { email: invite.email })}</Alert>
          <Link to="/login" state={{ from: `/invite/${token}` }} className={buttonClass('primary', 'w-full')}>{t('auth.login_submit')}</Link>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={form.handleSubmit((v) => accept.mutate(v))} noValidate>
          <p className="text-stone-600">{t('invite.create_account')}</p>
          <Field label={t('auth.your_name')} error={form.formState.errors.name?.message}>
            <Input autoComplete="name" {...form.register('name')} />
          </Field>
          <Field label={t('common.password')} error={form.formState.errors.password?.message}>
            <Input type="password" autoComplete="new-password" {...form.register('password')} />
          </Field>
          <Button type="submit" className="w-full" loading={accept.isPending}>
            {t('invite.accept')}
          </Button>
        </form>
      )}
    </div>
  );
}
