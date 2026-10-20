import i18n from './i18n';

const DEFAULT_TZ = 'Europe/Bratislava';

/** «ut 20. 10. 14:30» — в часовом поясе салона, на языке интерфейса. */
export function formatDateTime(iso: string, timeZone = DEFAULT_TZ) {
  return new Intl.DateTimeFormat(i18n.language, {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso));
}

export function formatDay(iso: string, timeZone = DEFAULT_TZ) {
  return new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'numeric', year: 'numeric', timeZone }).format(
    new Date(iso),
  );
}

/** «вчера», «3 дня назад», «через 5 часов». */
export function formatRelative(iso: string) {
  const diffMs = new Date(iso).getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' });
  const abs = Math.abs(diffMs);
  if (abs < 3600_000) return rtf.format(Math.round(diffMs / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diffMs / 3600_000), 'hour');
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diffMs / 86_400_000), 'day');
  return formatDay(iso);
}

/** Значение для <input type="datetime-local"> в часовом поясе салона. */
export function toLocalInput(iso: string, timeZone = DEFAULT_TZ) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(new Date(iso))
    .replace(' ', 'T');
}
