import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuditItem, CustomerDetailDto, CustomerListResponse } from '@peciatka/shared';
import { api } from '../lib/api';
import { useCurrentRole } from '../lib/auth';
import { formatDateTime, formatDay, formatRelative } from '../lib/format';
import { Button, Card, ErrorAlert, Input, Select, Spinner, buttonClass } from '../components/ui';

const PAGE = 50;

export function CustomersPage() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  const list = useInfiniteQuery({
    queryKey: ['customers', 'list', query, sort],
    queryFn: ({ pageParam }) =>
      api.get<CustomerListResponse>(`/customers?q=${encodeURIComponent(query)}&sort=${sort}&limit=${PAGE}&offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('customers.title')}</h1>
      <div className="flex gap-2">
        <Input type="search" placeholder={t('scan.search_placeholder')} value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-auto shrink-0" aria-label="sort">
          {(['recent', 'visits', 'new', 'name'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`customers.sort_${s}`)}
            </option>
          ))}
        </Select>
      </div>

      {list.isLoading && <Spinner />}
      <ErrorAlert error={list.error} />
      {list.data && total === 0 && !query && <Card className="text-center text-stone-600">{t('customers.empty')}</Card>}

      {items.length > 0 && (
        <>
          <p className="text-sm text-stone-500">{t('customers.total', { count: total })}</p>
          <Card flush>
            <ul className="divide-y divide-stone-100">
              {items.map((c) => (
                <li key={c.id}>
                  <Link to={`/customers/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {c.name} {c.rewardsAvailable > 0 && <span title="reward">🎁</span>}
                      </p>
                      <p className="truncate text-sm text-stone-500">{c.phone ?? c.email}</p>
                    </div>
                    <div className="shrink-0 text-right text-sm">
                      <p className="font-medium tabular-nums">{t('customers.visits', { count: c.totalVisits })}</p>
                      <p className="text-stone-500">
                        {c.lastVisitAt ? t('customers.last_visit', { when: formatRelative(c.lastVisitAt) }) : '—'}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          {list.hasNextPage && (
            <Button variant="secondary" className="w-full" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
              {t('customers.more')}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isOwner = useCurrentRole() === 'OWNER';
  const customer = useQuery({ queryKey: ['customer', id], queryFn: () => api.get<CustomerDetailDto>(`/customers/${id}`) });
  const del = useMutation({
    mutationFn: () => api.delete(`/customers/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['customers'] });
      navigate('/customers', { replace: true });
    },
  });

  if (customer.isLoading) return <Spinner />;
  if (customer.error) return <ErrorAlert error={customer.error} />;
  const c = customer.data!;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{c.name}</h1>
        <p className="text-sm text-stone-500">{[c.phone, c.email].filter(Boolean).join(' · ')}</p>
      </div>

      <Card className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-2xl font-bold tabular-nums">{c.totalVisits}</p>
          <p className="text-xs text-stone-500">{t('stats.visits')}</p>
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums">{c.stampCount}</p>
          <p className="text-xs text-stone-500">{t('card.stamps')}</p>
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums">{c.rewardsAvailable}</p>
          <p className="text-xs text-stone-500">{t('card.available')}</p>
        </div>
      </Card>

      {c.cardId && (
        <Link to={`/cards/${c.cardId}`} className={buttonClass('primary', 'w-full')}>{t('customers.open_card')}</Link>
      )}

      <Card flush>
        <h2 className="px-4 pt-4 font-semibold">{t('customers.history')}</h2>
        <ul className="divide-y divide-stone-100">
          {c.history.map((h) => (
            <li key={h.id} className="flex justify-between gap-3 px-4 py-2.5 text-sm">
              <span className={h.type === 'STAMP_REVOKED' ? 'text-stone-400 line-through' : ''}>
                {t(`customers.h_${h.type}`)}
                {h.actorName && <span className="text-stone-500"> · {h.actorName}</span>}
              </span>
              <span className="shrink-0 text-stone-500">{formatDateTime(h.at)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="space-y-1 text-xs text-stone-500">
        <p>{t('customers.registered', { date: formatDay(c.createdAt) })}</p>
        <p>{t('customers.consent', { date: formatDay(c.consentAt), version: c.consentVersion })}</p>
      </div>

      {isOwner && (
        <Card className="space-y-2">
          <ErrorAlert error={del.error} />
          <a href={`/api/customers/${id}/export`} download className={buttonClass('secondary', 'w-full')}>{t('customers.export')}</a>
          <Button
            variant="danger"
            className="w-full"
            loading={del.isPending}
            onClick={() => window.confirm(t('customers.delete_confirm', { name: c.name })) && del.mutate()}
          >
            {t('customers.delete')}
          </Button>
        </Card>
      )}
    </div>
  );
}

export function AuditPage() {
  const { t } = useTranslation();
  const log = useInfiniteQuery({
    queryKey: ['audit'],
    queryFn: ({ pageParam }) =>
      api.get<{ items: AuditItem[] }>(`/audit${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => (last.items.length === 50 ? last.items.at(-1)!.createdAt : undefined),
  });
  const items = log.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('audit.title')}</h1>
      {log.isLoading && <Spinner />}
      <ErrorAlert error={log.error} />
      {log.data && items.length === 0 && <p className="text-stone-500">{t('audit.empty')}</p>}
      {items.length > 0 && (
        <Card flush>
          <ul className="divide-y divide-stone-100">
            {items.map((i) => (
              <li key={i.id} className="flex justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{t(`audit.a.${i.action}`, { defaultValue: i.action })}</span>
                  <span className="text-stone-500"> · {i.actorName ?? t('audit.system')}</span>
                </span>
                <span className="shrink-0 text-stone-500">{formatDateTime(i.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {log.hasNextPage && (
        <Button variant="secondary" className="w-full" loading={log.isFetchingNextPage} onClick={() => log.fetchNextPage()}>
          {t('audit.more')}
        </Button>
      )}
    </div>
  );
}
