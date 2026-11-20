import {
  isLanguage,
  isModerationMode,
  type Language,
  type ModerationMode,
} from './site-settings';

/** Raw Site fields as typed by the Admin, with one Allowed origin per line. */
export interface SiteFields {
  name: string;
  origins: string;
  moderationMode: string;
  defaultLanguage: string;
}

export interface SiteSettings {
  name: string;
  origins: string[];
  moderationMode: ModerationMode;
  defaultLanguage: Language;
}

/** Turnstile's per-widget limit; the one widget lists the hostname of every Allowed origin. */
export const MAX_TURNSTILE_HOSTNAMES = 10;

export const tooManyHostnamesError = `Turnstile allows at most ${MAX_TURNSTILE_HOSTNAMES} distinct hostnames across all Sites. Use fewer Allowed origins.`;

const originPattern =
  /^https?:\/\/(?:\[[\da-f:.]+\]|[^\s/\\:?#@]+)(?::\d+)?\/?$/i;

/** Normalised, de-duplicated Allowed origins, or an error message. */
export function parseAllowedOrigins(text: string): string[] | string {
  const origins = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const value = line.trim();
    if (!value) continue;
    const url = originPattern.test(value) ? URL.parse(value) : null;
    if (!url)
      return `“${value}” is an invalid Allowed origin. Use scheme://host[:port] with no path.`;
    origins.add(url.origin);
  }
  return [...origins];
}

/** Validated Site settings, or an error message for the first invalid field. */
export function parseSiteSettings(fields: SiteFields): SiteSettings | string {
  const { moderationMode, defaultLanguage } = fields;
  const name = fields.name.trim();
  if (!name) return 'Enter a Site name.';
  if (!isModerationMode(moderationMode)) return 'Choose a moderation mode.';
  if (!isLanguage(defaultLanguage)) return 'Choose a default language.';
  const origins = parseAllowedOrigins(fields.origins);
  if (typeof origins === 'string') return origins;
  return { name, origins, moderationMode, defaultLanguage };
}
