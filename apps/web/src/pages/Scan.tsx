import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QrScanner from 'qr-scanner';
import type { CustomerListResponse, StaffCardDto } from '@peciatka/shared';
import { api, ApiError } from '../lib/api';
import { formatRelative } from '../lib/format';
import { Alert, Button, Card, Input } from '../components/ui';

/** QR на карте — это случайный токен; ссылка (например, с постера) картой не является. */
function looksLikeCardToken(value: string) {
  return /^[\w-]{10,64}$/.test(value.trim());
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function ScanPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const busy = useRef(false);
  const [state, setState] = useState<'starting' | 'running' | 'error'>('starting');
  const [message, setMessage] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 300);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const scanner = new QrScanner(
      video,
      async ({ data }) => {
        if (busy.current) return;
        busy.current = true;
        const resume = (msg: string) => {
          setMessage(msg);
          setTimeout(() => {
            busy.current = false;
            setMessage(null);
          }, 1800);
        };
        if (!looksLikeCardToken(data)) return resume(t('scan.not_card'));
        setMessage(t('scan.scanning'));
        try {
          const card = await api.get<StaffCardDto>(`/cards/by-qr/${encodeURIComponent(data.trim())}`);
          navigator.vibrate?.(40);
          qc.setQueryData(['staff-card', card.id], card);
          navigate(`/cards/${card.id}`);
        } catch (e) {
          const code = e instanceof ApiError ? e.code : 'internal';
          resume(t(`errors.${code}`, { defaultValue: t('errors.internal') }));
        }
      },
      { preferredCamera: 'environment', highlightScanRegion: true, highlightCodeOutline: true, maxScansPerSecond: 5 },
    );
    scannerRef.current = scanner;
    scanner
      .start()
      .then(() => setState('running'))
      .catch(() => setState('error'));
    return () => {
      scanner.destroy();
      scannerRef.current = null;
    };
  }, [navigate, qc, t]);

  const results = useQuery({
    queryKey: ['customers', 'search', query],
    queryFn: () => api.get<CustomerListResponse>(`/customers?q=${encodeURIComponent(query)}&limit=10`),
    enabled: query.length >= 2,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('scan.title')}</h1>

      <div className="relative overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
        {message && (
          <div className="absolute inset-x-3 bottom-3 rounded-xl bg-white/95 px-4 py-3 text-center text-sm font-medium">
            {message}
          </div>
        )}
        {state === 'error' && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white">
            <div className="space-y-3">
              <p>{t('scan.camera_error')}</p>
              <Button variant="secondary" onClick={() => window.location.reload()}>
                {t('common.retry')}
              </Button>
            </div>
          </div>
        )}
      </div>
      {state !== 'error' && <p className="text-center text-sm text-stone-500">{t('scan.hint')}</p>}

      <Card className="space-y-3">
        <h2 className="font-semibold">{t('scan.manual')}</h2>
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('scan.search_placeholder')}
          autoComplete="off"
        />
        {results.data && results.data.items.length === 0 && <Alert kind="info">{t('errors.customer_not_found')}</Alert>}
        <ul className="divide-y divide-stone-100">
          {results.data?.items
            .filter((c) => c.cardId)
            .map((c) => (
              <li key={c.id}>
                <Link to={`/cards/${c.cardId}`} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.name}</p>
                    <p className="truncate text-sm text-stone-500">{c.phone ?? c.email}</p>
                  </div>
                  <span className="shrink-0 text-sm text-stone-500">
                    {c.stampCount} ✓{c.lastVisitAt ? ` · ${formatRelative(c.lastVisitAt)}` : ''}
                  </span>
                </Link>
              </li>
            ))}
        </ul>
      </Card>
    </div>
  );
}
