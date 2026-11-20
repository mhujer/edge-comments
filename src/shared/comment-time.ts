const relativeUnits = [
  ['year', 365 * 86400],
  ['month', 30 * 86400],
  ['week', 7 * 86400],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
] as const;

export function commentTime(language: string, now = Date.now()) {
  const relative = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  const full = new Intl.DateTimeFormat(language, {
    dateStyle: 'full',
    timeStyle: 'short',
  });

  return {
    relativeDate(iso: string) {
      const seconds = (Date.parse(iso) - now) / 1000;
      for (const [unit, length] of relativeUnits) {
        if (Math.abs(seconds) >= length) {
          return relative.format(Math.trunc(seconds / length), unit);
        }
      }
      return relative.format(0, 'second');
    },
    fullDate(iso: string) {
      return full.format(Date.parse(iso));
    },
  };
}
