import {
  buildExport,
  type DeploymentExport,
  type ExportRows,
} from '../shared/export';

export async function loadDeploymentExport(
  db: D1Database,
): Promise<DeploymentExport> {
  // D1 executes the batch in a single transaction so all four tables share a snapshot.
  const [sites, origins, pages, comments] = await db.batch([
    db.prepare(
      `SELECT id, name, moderation_mode AS moderationMode,
              default_language AS defaultLanguage
         FROM site ORDER BY id`,
    ),
    db.prepare(
      'SELECT site_id AS siteId, origin FROM site_origin ORDER BY origin',
    ),
    db.prepare(
      `SELECT id, site_id AS siteId, key, url, title, created_at AS createdAt
         FROM page ORDER BY id`,
    ),
    db.prepare(
      `SELECT id, page_id AS pageId, parent_id AS parentId, status,
              commenter_name AS commenterName, commenter_email AS commenterEmail,
              body_md AS bodyMd, external_id AS externalId,
              created_at AS createdAt, status_changed_at AS statusChangedAt
         FROM comment ORDER BY id`,
    ),
  ]);

  const rows: ExportRows = {
    sites: sites.results as ExportRows['sites'],
    origins: origins.results as ExportRows['origins'],
    pages: pages.results as ExportRows['pages'],
    comments: comments.results as ExportRows['comments'],
  };
  return buildExport(rows, new Date());
}
