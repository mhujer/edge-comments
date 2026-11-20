const ABSOLUTE_URL_AUTHORITY = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i;

type PageKeyType = 'path' | 'explicit';

export function normalizePageKey(
  raw: string,
  type?: PageKeyType,
): string | null {
  const keyType =
    type ??
    (raw.startsWith('/') || ABSOLUTE_URL_AUTHORITY.test(raw)
      ? 'path'
      : 'explicit');
  let key = raw.trim();
  if (keyType === 'path') {
    const path = raw.replace(ABSOLUTE_URL_AUTHORITY, '').split(/[?#]/, 1)[0];
    try {
      key =
        decodeURIComponent(path)
          .normalize('NFC')
          .replace(/\/{2,}/g, '/')
          .replace(/\/index\.html?(?=\/?$)/, '')
          .replace(/\/$/, '') || '/';
    } catch {
      return null;
    }
  }
  const length = [...key].length;
  return length > 0 && length <= 500 ? key : null;
}
