import { createId, isoTimestamp } from '../../shared/identity';
import {
  MAX_TURNSTILE_HOSTNAMES,
  tooManyHostnamesError,
  type SiteSettings,
} from '../../shared/site-input';
import {
  pageFields,
  type AdminSite,
  type CommentStatus,
  type PageFields,
} from './data';

export type { SiteSettings } from '../../shared/site-input';

export interface SiteSummary extends SiteSettings {
  id: string;
  pageCount: number;
  pendingCount: number;
}

interface SiteRow extends Omit<SiteSettings, 'origins'> {
  id: string;
  originsJson: string;
}

const settingsColumns = `
  site.id, site.name, site.moderation_mode AS moderationMode,
  site.default_language AS defaultLanguage,
  (SELECT json_group_array(origin)
     FROM (SELECT origin FROM site_origin WHERE site_id = site.id ORDER BY origin)
  ) AS originsJson`;

function withOrigins<T extends SiteRow>({ originsJson, ...site }: T) {
  return { ...site, origins: JSON.parse(originsJson) as string[] };
}

export async function listSites(db: D1Database): Promise<SiteSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT ${settingsColumns},
              (SELECT count(*) FROM page WHERE site_id = site.id) AS pageCount,
              (SELECT count(*) FROM page JOIN comment ON comment.page_id = page.id
                WHERE page.site_id = site.id AND comment.status = 'pending') AS pendingCount
         FROM site ORDER BY site.name COLLATE NOCASE, site.id`,
    )
    .all<SiteRow & { pageCount: number; pendingCount: number }>();
  return results.map(withOrigins);
}

/** Sites keyed by id, each with a stable colour for moderation lists. */
export async function listAdminSites(db: D1Database) {
  const { results } = await db
    .prepare(`SELECT ${settingsColumns} FROM site ORDER BY site.id`)
    .all<SiteRow>();
  return new Map<string, AdminSite>(
    results
      .map(withOrigins)
      .map(({ id, name, origins }, index) => [
        id,
        { id, name, origins, colorClass: `site-color-${index % 5}` },
      ]),
  );
}

export async function getSite(db: D1Database, id: string) {
  const row = await db
    .prepare(`SELECT ${settingsColumns} FROM site WHERE site.id = ?`)
    .bind(id)
    .first<SiteRow>();
  return row && withOrigins(row);
}

export async function saveSite(
  db: D1Database,
  id: string,
  settings: SiteSettings,
  creating: boolean,
) {
  const { name, moderationMode, defaultLanguage, origins } = settings;
  const now = isoTimestamp();
  const submittedOrigins = JSON.stringify(origins);
  const newOrigins = JSON.stringify(
    origins.map((origin) => ({ id: createId(), origin })),
  );
  const conflicts = `
    FROM json_each(?) AS requested
    JOIN site_origin ON site_origin.origin = requested.value
    WHERE site_origin.site_id <> ?`;
  // Distinct hostnames after the save: other Sites' origins plus the submitted ones.
  // Origins are normalised (scheme://host[:port]), so the hostname is what follows
  // "://", up to "]" for IPv6 or up to the port's ":" otherwise.
  const hostnameCount = `
    (SELECT count(DISTINCT CASE
              WHEN substr(rest, 1, 1) = '[' THEN substr(rest, 1, instr(rest, ']'))
              WHEN instr(rest, ':') > 0 THEN substr(rest, 1, instr(rest, ':') - 1)
              ELSE rest
            END)
       FROM (SELECT substr(origin, instr(origin, '://') + 3) AS rest
               FROM site_origin WHERE site_id <> ?
             UNION ALL
             SELECT substr(value, instr(value, '://') + 3) FROM json_each(?)))`;
  // Every write is gated on this inside one D1 batch, so concurrent saves can't slip past it.
  const allowed = `NOT EXISTS (SELECT 1 ${conflicts})
    AND ${hostnameCount} <= ${MAX_TURNSTILE_HOSTNAMES}`;
  const allowedBindings = [submittedOrigins, id, id, submittedOrigins];
  const saveSettings = creating
    ? db
        .prepare(
          `INSERT INTO site (id, name, moderation_mode, default_language, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ? WHERE ${allowed}`,
        )
        .bind(
          id,
          name,
          moderationMode,
          defaultLanguage,
          now,
          now,
          ...allowedBindings,
        )
    : db
        .prepare(
          `UPDATE site SET name = ?, moderation_mode = ?, default_language = ?, updated_at = ?
            WHERE id = ? AND ${allowed}`,
        )
        .bind(
          name,
          moderationMode,
          defaultLanguage,
          now,
          id,
          ...allowedBindings,
        );

  // Read the Site already holding a submitted Allowed origin and the hostname count, and gate all writes inside the same D1 transaction.
  const [conflictsResult, hostnamesResult, , , inserted] = await db.batch<{
    name: string;
    origin: string;
    hostnames: number;
  }>([
    db
      .prepare(
        `SELECT (SELECT name FROM site WHERE site.id = site_origin.site_id) AS name,
                site_origin.origin
         ${conflicts}
         ORDER BY requested.key LIMIT 1`,
      )
      .bind(submittedOrigins, id),
    db
      .prepare(`SELECT ${hostnameCount} AS hostnames`)
      .bind(id, submittedOrigins),
    saveSettings,
    db
      .prepare(
        `DELETE FROM site_origin
          WHERE site_id = ? AND origin NOT IN (SELECT value FROM json_each(?))
            AND ${allowed}`,
      )
      .bind(id, submittedOrigins, ...allowedBindings),
    db
      .prepare(
        `INSERT INTO site_origin (id, site_id, origin)
         SELECT json_extract(requested.value, '$.id'), ?, json_extract(requested.value, '$.origin')
           FROM json_each(?) AS requested
          WHERE ${allowed}
            AND NOT EXISTS (
              SELECT 1 FROM site_origin
               WHERE site_id = ? AND origin = json_extract(requested.value, '$.origin')
            )`,
      )
      .bind(id, newOrigins, ...allowedBindings, id),
  ]);
  const conflict = conflictsResult.results[0];
  if (conflict)
    return { error: `${conflict.origin} already belongs to ${conflict.name}.` };
  if (hostnamesResult.results[0].hostnames > MAX_TURNSTILE_HOSTNAMES)
    return { error: tooManyHostnamesError };
  return { addedOrigin: inserted.meta.changes > 0 };
}

export interface SitePage extends PageFields {
  publishedCount: number;
  pendingCount: number;
  rejectedCount: number;
}

export async function listSitePages(db: D1Database, siteId: string) {
  const { results } = await db
    .prepare(
      `SELECT ${pageFields},
              count(*) FILTER (WHERE comment.status = 'published') AS publishedCount,
              count(*) FILTER (WHERE comment.status = 'pending') AS pendingCount,
              count(*) FILTER (WHERE comment.status = 'rejected') AS rejectedCount
         FROM page
         LEFT JOIN comment ON comment.page_id = page.id
        WHERE page.site_id = ?
        GROUP BY page.id
        ORDER BY page.title COLLATE NOCASE, page.key`,
    )
    .bind(siteId)
    .all<SitePage>();
  return results;
}

export async function getPage(db: D1Database, id: string) {
  return db
    .prepare(
      `SELECT ${pageFields}, site.name AS siteName
         FROM page JOIN site ON page.site_id = site.id
        WHERE page.id = ?`,
    )
    .bind(id)
    .first<PageFields & { siteName: string }>();
}

export interface PageComment {
  id: string;
  name: string;
  excerpt: string;
  status: CommentStatus;
}

export async function listPageComments(db: D1Database, id: string) {
  const { results } = await db
    .prepare(
      `SELECT id, commenter_name AS name, substr(body_md, 1, 200) AS excerpt, status
         FROM comment WHERE page_id = ?
        ORDER BY created_at DESC, id DESC`,
    )
    .bind(id)
    .all<PageComment>();
  return results;
}
