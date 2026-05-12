export const CHILE_TIME_ZONE = 'America/Santiago';

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return new Date(value as string | number);
}

function pad(value: unknown, size = 2): string {
  return String(value).padStart(size, '0');
}

interface ChileParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function getChileParts(value: unknown): ChileParts | null {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHILE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    hour12: false,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value || 0);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
  };
}

export function formatChileTimestamp(value: unknown): string | null {
  const parts = getChileParts(value);
  if (!parts) return null;
  return [
    `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`,
  ].join(' ');
}

export function parseChileTimestamp(rawValue: unknown): Date | null {
  if (!rawValue) return null;
  const value = String(rawValue).trim().replace('T', ' ').replace('Z', '');
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/,
  );
  if (!match) return null;
  const [, year, month, day, hour = '00', minute = '00', second = '00', millis = '0'] = match;
  const millisecond = Number(pad(millis, 3).slice(0, 3));
  const utcGuess = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    millisecond,
  );
  const chileParts = getChileParts(new Date(utcGuess));
  if (!chileParts) return null;
  const chileAsUtc = Date.UTC(
    chileParts.year,
    chileParts.month - 1,
    chileParts.day,
    chileParts.hour,
    chileParts.minute,
    chileParts.second,
    millisecond,
  );
  const parsed = new Date(utcGuess - (chileAsUtc - utcGuess));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
