import type { comment, page, site, siteOrigin } from '../worker/db/schema';

export interface ExportRows {
  sites: readonly Pick<
    typeof site.$inferSelect,
    'id' | 'name' | 'moderationMode' | 'defaultLanguage'
  >[];
  origins: readonly Pick<typeof siteOrigin.$inferSelect, 'siteId' | 'origin'>[];
  pages: readonly Pick<
    typeof page.$inferSelect,
    'id' | 'siteId' | 'key' | 'url' | 'title' | 'createdAt'
  >[];
  comments: readonly Omit<
    typeof comment.$inferSelect,
    'bodyHtml' | 'htmlVersion'
  >[];
}

interface ExportComment {
  id: string;
  parent_id: string | null;
  status: (typeof comment.$inferSelect)['status'];
  commenter_name: string;
  commenter_email: string | null;
  body_md: string;
  external_id: string | null;
  created_at: string;
  status_changed_at: string;
}

interface ExportPage {
  id: string;
  key: string;
  url: string;
  title: string;
  created_at: string;
  comments: ExportComment[];
}

interface ExportSite {
  id: string;
  name: string;
  moderation_mode: (typeof site.$inferSelect)['moderationMode'];
  default_language: (typeof site.$inferSelect)['defaultLanguage'];
  origins: string[];
  pages: ExportPage[];
}

export interface DeploymentExport {
  format: 'edge-comments-export';
  version: 1;
  exported_at: string;
  sites: ExportSite[];
}

export function buildExport(
  rows: ExportRows,
  exportedAt: Date,
): DeploymentExport {
  const sites = new Map<string, ExportSite>();
  const pages = new Map<string, ExportPage>();

  for (const row of rows.sites) {
    sites.set(row.id, {
      id: row.id,
      name: row.name,
      moderation_mode: row.moderationMode,
      default_language: row.defaultLanguage,
      origins: [],
      pages: [],
    });
  }
  for (const row of rows.origins) {
    sites.get(row.siteId)?.origins.push(row.origin);
  }
  for (const row of rows.pages) {
    const page: ExportPage = {
      id: row.id,
      key: row.key,
      url: row.url,
      title: row.title,
      created_at: row.createdAt,
      comments: [],
    };
    pages.set(row.id, page);
    sites.get(row.siteId)?.pages.push(page);
  }
  for (const row of rows.comments) {
    pages.get(row.pageId)?.comments.push({
      id: row.id,
      parent_id: row.parentId,
      status: row.status,
      commenter_name: row.commenterName,
      commenter_email: row.commenterEmail,
      body_md: row.bodyMd,
      external_id: row.externalId,
      created_at: row.createdAt,
      status_changed_at: row.statusChangedAt,
    });
  }

  return {
    format: 'edge-comments-export',
    version: 1,
    exported_at: exportedAt.toISOString(),
    sites: [...sites.values()],
  };
}
