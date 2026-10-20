import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createInviteSchema, ROLES, type StaffResponse } from '@peciatka/shared';
import { api } from '../lib/api';
import { formatDate } from '../lib/i18n';
import { Alert, Button, Card, ErrorAlert, Field, Input, Select, Spinner } from '../components/ui';

const staffKey = ['staff'];

export function StaffPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const staff = useQuery({ queryKey: staffKey, queryFn: () => api.get<StaffResponse>('/staff') });
  const refresh = () => qc.invalidateQueries({ queryKey: staffKey });

  const form = useForm({ resolver: zodResolver(createInviteSchema), defaultValues: { role: 'STAFF' as const } });
  const invite = useMutation({
    mutationFn: (v: unknown) => api.post<{ url: string }>('/staff/invites', v),
    onSuccess: (res) => {
      setInviteUrl(res.url);
      setCopied(false);
      form.reset({ email: '', role: 'STAFF' });
      void refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/staff/invites/${id}`),
    onSuccess: refresh,
  });
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/staff/members/${id}`, { active }),
    onSuccess: refresh,
  });

  async function copy() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      // буфер обмена недоступен (http на телефоне) — ссылку видно на экране
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t('staff.title')}</h1>

      <Card className="space-y-4">
        <h2 className="font-semibold">{t('staff.invite_title')}</h2>
        <form className="space-y-3" onSubmit={form.handleSubmit((v) => invite.mutate(v))} noValidate>
          <ErrorAlert error={invite.error} />
          <Field label={t('common.email')} error={form.formState.errors.email?.message}>
            <Input type="email" inputMode="email" autoComplete="off" {...form.register('email')} />
          </Field>
          <Field label={t('staff.role')}>
            <Select {...form.register('role')}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" className="w-full" loading={invite.isPending}>
            {t('staff.invite_submit')}
          </Button>
        </form>
        {inviteUrl && (
          <Alert kind="success">
            <p>{t('staff.invite_sent')}</p>
            <p className="mt-2 break-all font-mono text-xs">{inviteUrl}</p>
            <button className="mt-2 font-semibold underline" onClick={() => void copy()}>
              {copied ? t('common.copied') : t('common.copy')}
            </button>
          </Alert>
        )}
      </Card>

      {staff.isLoading && <Spinner />}
      <ErrorAlert error={staff.error ?? toggle.error ?? revoke.error} />

      {staff.data && (
        <>
          <Card flush className="space-y-1 pb-1">
            <h2 className="px-5 pt-4 font-semibold">{t('staff.members')}</h2>
            <ul className="divide-y divide-stone-100">
              {staff.data.members.map((m) => (
                <li key={m.membershipId} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className={`truncate font-medium ${m.active ? '' : 'text-stone-400 line-through'}`}>
                      {m.name} {m.isMe && <span className="text-xs text-stone-500">({t('staff.you')})</span>}
                    </p>
                    <p className="truncate text-sm text-stone-500">
                      {m.email} · {t(`roles.${m.role}`)}
                      {!m.active && ` · ${t('staff.inactive')}`}
                    </p>
                  </div>
                  {!m.isMe && (
                    <Button
                      variant={m.active ? 'danger' : 'secondary'}
                      className="shrink-0"
                      loading={toggle.isPending && toggle.variables?.id === m.membershipId}
                      onClick={() => toggle.mutate({ id: m.membershipId, active: !m.active })}
                    >
                      {m.active ? t('staff.deactivate') : t('staff.activate')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          {staff.data.invites.length > 0 && (
            <Card flush className="space-y-1 pb-1">
              <h2 className="px-5 pt-4 font-semibold">{t('staff.pending')}</h2>
              <ul className="divide-y divide-stone-100">
                {staff.data.invites.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{i.email}</p>
                      <p className="text-sm text-stone-500">
                        {t(`roles.${i.role}`)} · {t('staff.expires', { date: formatDate(i.expiresAt) })}
                      </p>
                    </div>
                    <Button variant="danger" className="shrink-0" onClick={() => revoke.mutate(i.id)}>
                      {t('staff.revoke')}
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
