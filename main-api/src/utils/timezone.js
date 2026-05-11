const CHILE_TIME_ZONE = "America/Santiago";

function toDate(value) {
  if (value instanceof Date) return value;
  return new Date(value);
}

function pad(value, size = 2) {
  return String(value).padStart(size, "0");
}

function getChileParts(value) {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CHILE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    hour12: false,
  }).formatToParts(date);

  const part = (type) => Number(parts.find((item) => item.type === type)?.value || 0);

  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
}

function formatChileTimestamp(value) {
  const parts = getChileParts(value);
  if (!parts) return null;

  return [
    `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`,
  ].join(" ");
}

function parseChileTimestamp(rawValue) {
  if (!rawValue) return null;

  const value = String(rawValue).trim().replace("T", " ").replace("Z", "");
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/
  );

  if (!match) return null;

  const [, year, month, day, hour = "00", minute = "00", second = "00", millis = "0"] = match;
  const millisecond = Number(pad(millis, 3).slice(0, 3));
  const utcGuess = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    millisecond
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
    millisecond
  );
  const parsed = new Date(utcGuess - (chileAsUtc - utcGuess));

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

module.exports = {
  CHILE_TIME_ZONE,
  formatChileTimestamp,
  parseChileTimestamp,
};
