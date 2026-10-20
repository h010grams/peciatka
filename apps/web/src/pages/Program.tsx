import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { programSchema, type ProgramDto, type SalonDto } from '@peciatka/shared';
import { api } from '../lib/api';
import { useCurrentRole } from '../lib/auth';
import { CardVisual } from '../components/CardVisual';
import { Alert, Button, Card, ErrorAlert, Field, Input, Spinner, buttonClass } from '../components/ui';

const DEFAULTS = {
  name: 'Vernostná karta',
  stampsRequired: 10,
  rewardText: '',
  cooldownHours: 12,
  bgColor: '#1C1917',
  fgColor: '#FFFFFF',
  labelColor: '#E7B9A8',
};

/** Готовые сочетания цветов — проще, чем подбирать три цвета с нуля. */
const PRESETS = [
  { bgColor: '#1C1917', fgColor: '#FFFFFF', labelColor: '#E7B9A8' },
  { bgColor: '#F5E6E0', fgColor: '#3F2A24', labelColor: '#B5644C' },
  { bgColor: '#7A1F3D', fgColor: '#FFFFFF', labelColor: '#F4C7D3' },
  { bgColor: '#1F3A34', fgColor: '#FFFFFF', labelColor: '#C9DCC8' },
  { bgColor: '#E8EEF6', fgColor: '#1E2A44', labelColor: '#4C6FA8' },
];

export function ProgramPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const isOwner = useCurrentRole() === 'OWNER';
  const fileRef = useRef<HTMLInputElement>(null);

  const program = useQuery({ queryKey: ['program'], queryFn: () => api.get<{ program: ProgramDto | null }>('/program') });
  const salon = useQuery({ queryKey: ['salon'], queryFn: () => api.get<SalonDto>('/salon') });
  const form = useForm({ resolver: zodResolver(programSchema), defaultValues: DEFAULTS });
  const values = useWatch({ control: form.control });

  useEffect(() => {
    const p = program.data?.program;
    if (p) {
      const { id: _id, logoUrl: _l, ...rest } = p;
      form.reset(rest);
    }
  }, [program.data, form]);

  const setProgram = (data: { program: ProgramDto }) => qc.setQueryData(['program'], data);
  const save = useMutation({ mutationFn: (v: unknown) => api.put<{ program: ProgramDto }>('/program', v), onSuccess: setProgram });
  const upload = useMutation({ mutationFn: (f: File) => api.upload<{ program: ProgramDto }>('/program/logo', f), onSuccess: setProgram });
  const removeLogo = useMutation({ mutationFn: () => api.delete<{ program: ProgramDto }>('/program/logo'), onSuccess: setProgram });

  if (program.isLoading || salon.isLoading) return <Spinner />;
  const current = program.data?.program ?? null;
  const { errors } = form.formState;
  const lang = i18n.language;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t('program.title')}</h1>

      <div className="-mx-4 bg-stone-50/95 px-4 pb-3 pt-1 md:sticky md:top-16 md:z-[5] md:backdrop-blur">
        <CardVisual
          salonName={salon.data?.name ?? ''}
          logoUrl={current?.logoUrl ?? null}
          stampCount={Math.min(3, Number(values.stampsRequired) || 0)}
          stampsRequired={Math.min(30, Math.max(2, Number(values.stampsRequired) || 2))}
          rewardText={values.rewardText || t('program.reward_placeholder')}
          bgColor={values.bgColor ?? DEFAULTS.bgColor}
          fgColor={values.fgColor ?? DEFAULTS.fgColor}
          labelColor={values.labelColor ?? DEFAULTS.labelColor}
        />
      </div>

      <Card>
        <form className="space-y-4" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
          <fieldset disabled={!isOwner} className="space-y-4">
            <ErrorAlert error={save.error} />
            {save.isSuccess && !form.formState.isDirty && <Alert kind="success">{t('common.saved')}</Alert>}
            <Field label={t('program.reward_text')} error={errors.rewardText?.message}>
              <Input placeholder={t('program.reward_placeholder')} {...form.register('rewardText')} />
            </Field>
            <Field label={t('program.stamps_required')} error={errors.stampsRequired?.message}>
              <Input type="number" inputMode="numeric" min={2} max={30} {...form.register('stampsRequired')} />
            </Field>

            <div className="space-y-2">
              <span className="text-sm font-medium text-stone-700">{t('program.colors')}</span>
              <div className="flex gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.bgColor}
                    type="button"
                    aria-label={p.bgColor}
                    onClick={() => {
                      for (const [k, v] of Object.entries(p)) {
                        form.setValue(k as keyof typeof p, v, { shouldDirty: true, shouldValidate: true });
                      }
                    }}
                    className="flex size-10 items-center justify-center rounded-full ring-1 ring-black/10"
                    style={{ backgroundColor: p.bgColor }}
                  >
                    <span className="size-3 rounded-full" style={{ backgroundColor: p.labelColor }} />
                  </button>
                ))}
              </div>
              <details className="pt-1">
                <summary className="cursor-pointer text-sm text-stone-500">{t('program.more_colors')}</summary>
              <div className="mt-3 grid grid-cols-3 gap-3">
                {(['bgColor', 'fgColor', 'labelColor'] as const).map((k) => (
                  <label key={k} className="space-y-1 text-xs text-stone-600">
                    <span>{t(`program.${k === 'bgColor' ? 'bg' : k === 'fgColor' ? 'fg' : 'label'}`)}</span>
                    <input
                      type="color"
                      className="h-11 w-full cursor-pointer rounded-xl border border-stone-300 bg-white p-1"
                      value={values[k] ?? '#000000'}
                      onChange={(e) =>
                        form.setValue(k, e.target.value.toUpperCase(), { shouldDirty: true, shouldValidate: true })
                      }
                    />
                  </label>
                ))}
              </div>
              </details>
            </div>

            <details>
              <summary className="cursor-pointer text-sm text-stone-500">{t('program.advanced')}</summary>
              <div className="mt-3 space-y-4">
                <Field label={t('program.name')} error={errors.name?.message}>
                  <Input {...form.register('name')} />
                </Field>
                <Field label={t('program.cooldown')} error={errors.cooldownHours?.message}>
                  <Input type="number" inputMode="numeric" min={0} max={168} {...form.register('cooldownHours')} />
                </Field>
                <p className="-mt-2 text-xs text-stone-500">{t('program.cooldown_hint')}</p>
              </div>
            </details>

            {isOwner && (
              <Button type="submit" className="w-full" loading={save.isPending}>
                {t('common.save')}
              </Button>
            )}
            {current && <p className="text-xs text-stone-500">{t('program.resync_note')}</p>}
          </fieldset>
        </form>
      </Card>

      {isOwner && (
        <Card className="space-y-3">
          <h2 className="font-semibold">{t('program.logo')}</h2>
          {!current ? (
            <p className="text-sm text-stone-500">{t('program.create_first')}</p>
          ) : (
            <>
              <ErrorAlert error={upload.error ?? removeLogo.error} />
              {current.logoUrl && (
                <div className="flex items-center justify-center rounded-xl bg-stone-100 p-4">
                  <img src={current.logoUrl} alt="" className="max-h-16" />
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload.mutate(f);
                  e.target.value = '';
                }}
              />
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" loading={upload.isPending} onClick={() => fileRef.current?.click()}>
                  {t('program.logo_upload')}
                </Button>
                {current.logoUrl && (
                  <Button variant="danger" loading={removeLogo.isPending} onClick={() => removeLogo.mutate()}>
                    {t('program.logo_remove')}
                  </Button>
                )}
              </div>
              <p className="text-xs text-stone-500">{t('program.logo_hint')}</p>
            </>
          )}
        </Card>
      )}

      {current && salon.data && (
        <Card className="space-y-3">
          <h2 className="font-semibold">{t('poster.title')}</h2>
          <p className="text-sm text-stone-600">{t('poster.text')}</p>
          <div className="grid gap-2">
            <a href={`/api/poster/poster.pdf?size=a4&lang=${lang}`} target="_blank" rel="noreferrer" className={buttonClass('primary', 'w-full')}>{t('poster.download')}</a>
            <details>
              <summary className="cursor-pointer text-center text-sm text-stone-500">{t('poster.more_formats')}</summary>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <a href={`/api/poster/poster.pdf?size=a5&lang=${lang}`} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'w-full')}>{t('poster.a5')}</a>
                <a href="/api/poster/qr.png" download className={buttonClass('secondary', 'w-full')}>{t('poster.qr_png')}</a>
              </div>
            </details>
            <a href={`/j/${salon.data.slug}`} target="_blank" rel="noreferrer" className="pt-1 text-center text-sm underline">
              {t('poster.open_public')}
            </a>
          </div>
        </Card>
      )}
    </div>
  );
}
