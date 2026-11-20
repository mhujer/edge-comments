import { createId, isoTimestamp } from '../shared/identity';
import {
  MAX_TURNSTILE_HOSTNAMES,
  parseSiteSettings,
  tooManyHostnamesError,
  type SiteFields,
  type SiteSettings,
} from '../shared/site-input';

function sqlText(value: string): string {
  return "'" + value.replaceAll("'", "''") + "'";
}

/** The admin form's validation, plus the 1 to `MAX_TURNSTILE_HOSTNAMES` Turnstile hostnames that the first Site needs. */
export function parseFirstSite(fields: SiteFields): SiteSettings | string {
  const settings = parseSiteSettings(fields);
  if (typeof settings === 'string') return settings;
  if (!settings.origins.length) return 'Enter at least one Allowed origin.';
  const hostnames = new Set(
    settings.origins.map((origin) => new URL(origin).hostname),
  );
  if (hostnames.size > MAX_TURNSTILE_HOSTNAMES) return tooManyHostnamesError;
  return settings;
}

/** SQL that creates the Site only while the database has no Sites yet. */
export function createSiteSql(settings: SiteSettings): string {
  const id = sqlText(createId());
  const now = sqlText(isoTimestamp());
  const statements = [
    `INSERT INTO site (id, name, moderation_mode, default_language, created_at, updated_at)
     SELECT ${id}, ${sqlText(settings.name)}, ${sqlText(settings.moderationMode)}, ${sqlText(settings.defaultLanguage)}, ${now}, ${now}
     WHERE NOT EXISTS (SELECT 1 FROM site);`,
    ...settings.origins.map(
      (origin) => `INSERT INTO site_origin (id, site_id, origin)
     SELECT ${sqlText(createId())}, ${id}, ${sqlText(origin)}
     WHERE EXISTS (SELECT 1 FROM site WHERE id = ${id});`,
    ),
  ];
  return statements.join('\n\n') + '\n';
}
