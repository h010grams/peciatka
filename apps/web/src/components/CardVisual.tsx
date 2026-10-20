import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../lib/format';

export interface CardLook {
  salonName: string;
  logoUrl: string | null;
  stampCount: number;
  stampsRequired: number;
  rewardText: string;
  rewardsAvailable?: number;
  bgColor: string;
  fgColor: string;
  labelColor: string;
  qrUrl?: string | null;
  /** следующая запись — показывается на лицевой стороне, как в Wallet */
  nextAppointmentAt?: string | null;
  timezone?: string;
}

/** Кружки-штампы: тот же рисунок, что сервер кладёт в Apple/Google Wallet. */
function StampStrip({ filled, total, bg, fg, label }: { filled: number; total: number; bg: string; fg: string; label: string }) {
  const W = 375;
  const H = 123;
  const rows = total <= 6 ? 1 : total <= 20 ? 2 : 3;
  const cols = Math.ceil(total / rows);
  const padX = 20;
  const padY = 13;
  const cellW = (W - padX * 2) / cols;
  const cellH = (H - padY * 2) / rows;
  const r = Math.min(cellW, cellH) * 0.38;
  const stroke = Math.max(1.4, r * 0.12);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`${filled}/${total}`}>
      {Array.from({ length: total }, (_, i) => {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const inRow = row === rows - 1 ? total - cols * (rows - 1) : cols;
        const cx = padX + ((cols - inRow) * cellW) / 2 + cellW * col + cellW / 2;
        const cy = padY + cellH * row + cellH / 2;
        const isLast = i === total - 1;
        if (i < filled) {
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={r} fill={fg} />
              <path
                d={`M ${cx - r * 0.42} ${cy + r * 0.02} L ${cx - r * 0.1} ${cy + r * 0.34} L ${cx + r * 0.45} ${cy - r * 0.3}`}
                fill="none"
                stroke={bg}
                strokeWidth={stroke * 1.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        }
        return (
          <g key={i}>
            <circle
              cx={cx}
              cy={cy}
              r={r - stroke / 2}
              fill="none"
              stroke={isLast ? label : fg}
              strokeOpacity={isLast ? 1 : 0.45}
              strokeWidth={stroke}
              strokeDasharray={isLast ? `${stroke * 2} ${stroke * 1.2}` : undefined}
            />
            {isLast && <circle cx={cx} cy={cy} r={r * 0.22} fill={label} />}
          </g>
        );
      })}
    </svg>
  );
}

/** Карта в стиле Wallet: для превью в настройках и на странице клиентки. */
export function CardVisual(c: CardLook) {
  const { t } = useTranslation();
  return (
    <div
      className="mx-auto w-full max-w-sm overflow-hidden rounded-2xl shadow-lg ring-1 ring-black/5"
      style={{ backgroundColor: c.bgColor, color: c.fgColor }}
    >
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3">
        {c.logoUrl ? (
          <img src={c.logoUrl} alt={c.salonName} className="h-9 max-w-[60%] object-contain object-left" />
        ) : (
          <span className="truncate text-base font-semibold">{c.salonName}</span>
        )}
        <div className="text-right">
          <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: c.labelColor }}>
            {t('card.stamps')}
          </div>
          <div className="text-lg font-semibold leading-tight">
            {c.stampCount}/{c.stampsRequired}
          </div>
        </div>
      </div>
      <StampStrip filled={c.stampCount} total={c.stampsRequired} bg={c.bgColor} fg={c.fgColor} label={c.labelColor} />
      <div className="flex items-end justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: c.labelColor }}>
            {t('card.reward_label', { n: c.stampsRequired })}
          </div>
          <div className="truncate text-sm">{c.rewardText}</div>
        </div>
        {!!c.rewardsAvailable && (
          <div className="shrink-0 text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: c.labelColor }}>
              {t('card.available')}
            </div>
            <div className="text-sm">🎁 {c.rewardsAvailable}</div>
          </div>
        )}
      </div>
      {c.nextAppointmentAt && (
        <div className="mx-4 mb-3 border-t pt-2.5" style={{ borderColor: `${c.fgColor}33` }}>
          <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: c.labelColor }}>
            {t('card.next_visit')}
          </div>
          <div className="text-base font-semibold">{formatDateTime(c.nextAppointmentAt, c.timezone)}</div>
        </div>
      )}
      {c.qrUrl !== undefined && (
        <div className="flex justify-center pb-5 pt-1">
          <div className="rounded-xl bg-white p-2.5">
            {c.qrUrl ? (
              <img src={c.qrUrl} alt="QR" className="size-40" />
            ) : (
              <div className="grid size-28 place-items-center text-xs text-stone-400">QR</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
