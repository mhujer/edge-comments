import { isoTimestamp } from '../../shared/identity';
import type { comment } from '../db/schema';

export type CommentStatus = (typeof comment.$inferSelect)['status'];

export interface CommentCursor {
  createdAt: string;
  id: string;
}

interface CommentFields {
  id: string;
  status: CommentStatus;
  commenterName: string;
  commenterEmail: string | null;
  bodyHtml: string;
  externalId: string | null;
  createdAt: string;
  parentId: string | null;
  parentName: string | null;
  parentStatus: CommentStatus | null;
  parentExcerpt: string | null;
}

export interface PageFields {
  pageId: string;
  pageKey: string;
  pageTitle: string;
  pageUrl: string;
  siteId: string;
}

export type AdminComment = CommentFields & PageFields;

export interface AdminSite {
  id: string;
  name: string;
  origins: string[];
  colorClass: string;
}

const commentFields = `
  comment.id, comment.status, comment.commenter_name AS commenterName,
  comment.commenter_email AS commenterEmail, comment.body_html AS bodyHtml,
  comment.external_id AS externalId, comment.created_at AS createdAt`;

export const pageFields = `
  page.id AS pageId, page.key AS pageKey, page.title AS pageTitle,
  page.url AS pageUrl, page.site_id AS siteId`;

const parentFields = `
  parent.id AS parentId, parent.commenter_name AS parentName,
  parent.status AS parentStatus, substr(parent.body_md, 1, 200) AS parentExcerpt`;

const joinParent =
  'LEFT JOIN comment AS parent ON parent.id = comment.parent_id';

const batchSize = 50;

interface ListRow extends CommentFields {
  pageId: string;
  replyCount: number;
}

export async function listComments(
  db: D1Database,
  status: CommentStatus,
  before?: CommentCursor,
) {
  const replyCount =
    status === 'rejected'
      ? '(SELECT count(*) FROM comment AS reply WHERE reply.parent_id = comment.id)'
      : '0';
  const condition = before
    ? 'AND (comment.created_at, comment.id) < (?, ?)'
    : '';
  const params = before ? [status, before.createdAt, before.id] : [status];
  const { results } = await db
    .prepare(
      `SELECT ${commentFields}, comment.page_id AS pageId, ${parentFields},
              ${replyCount} AS replyCount
         FROM comment
         ${joinParent}
        WHERE comment.status = ? ${condition}
        ORDER BY comment.created_at DESC, comment.id DESC
        LIMIT ?`,
    )
    .bind(...params, batchSize + 1)
    .all<ListRow>();
  const rows = results.slice(0, batchSize);
  if (!rows.length) return { comments: [], older: undefined };

  // Cards often share a Page. Read each distinct Page once.
  const pageIds = Array.from(new Set(rows.map(({ pageId }) => pageId)));
  const placeholders = pageIds.map(() => '?').join(', ');
  const { results: pages } = await db
    .prepare(`SELECT ${pageFields} FROM page WHERE id IN (${placeholders})`)
    .bind(...pageIds)
    .all<PageFields>();
  const pageById = new Map(pages.map((page) => [page.pageId, page]));
  const comments = rows.flatMap((row) => {
    const page = pageById.get(row.pageId);
    return page ? [{ ...row, ...page }] : [];
  });
  return {
    comments,
    older: results.length > batchSize ? rows.at(-1) : undefined,
  };
}

export async function newerCursor(
  db: D1Database,
  status: CommentStatus,
  before: CommentCursor,
) {
  // Include the current boundary so the preceding page ends at that boundary.
  const { results } = await db
    .prepare(
      `SELECT created_at AS createdAt, id
       FROM comment
      WHERE status = ? AND (created_at, id) >= (?, ?)
      ORDER BY created_at, id
      LIMIT 1 OFFSET ?`,
    )
    .bind(status, before.createdAt, before.id, batchSize)
    .all<CommentCursor>();
  return results[0];
}

interface CommentDetail extends AdminComment {
  bodyMd: string;
  htmlVersion: number;
  statusChangedAt: string;
}

export function getCommentDetail(db: D1Database, id: string) {
  return db
    .prepare(
      `
    SELECT ${commentFields}, ${pageFields}, ${parentFields},
           comment.body_md AS bodyMd, comment.html_version AS htmlVersion,
           comment.status_changed_at AS statusChangedAt
      FROM comment
      JOIN page ON page.id = comment.page_id
      ${joinParent}
     WHERE comment.id = ?`,
    )
    .bind(id)
    .first<CommentDetail>();
}

export async function listReplies(db: D1Database, id: string) {
  const { results } = await db
    .prepare(
      `
    SELECT id, status, commenter_name AS commenterName, substr(body_md, 1, 200) AS excerpt
      FROM comment
     WHERE parent_id = ?
     ORDER BY created_at, id`,
    )
    .bind(id)
    .all<{
      id: string;
      status: CommentStatus;
      commenterName: string;
      excerpt: string;
    }>();
  return results;
}

export async function countPending(db: D1Database) {
  const { results } = await db
    .prepare("SELECT count(*) AS total FROM comment WHERE status = 'pending'")
    .all<{ total: number }>();
  return results[0]?.total ?? 0;
}

export async function moderateComment(
  db: D1Database,
  id: string,
  status: 'published' | 'rejected',
  previousStatuses: readonly [CommentStatus, ...CommentStatus[]],
) {
  const placeholders = previousStatuses.map(() => '?').join(', ');
  const { meta } = await db
    .prepare(
      `
    UPDATE comment
       SET status = ?, status_changed_at = ?
     WHERE id = ?
       AND status IN (${placeholders})`,
    )
    .bind(status, isoTimestamp(), id, ...previousStatuses)
    .run();
  return meta.changes > 0;
}

export async function countReplies(db: D1Database, id: string) {
  return (
    (await db
      .prepare('SELECT count(*) AS total FROM comment WHERE parent_id = ?')
      .bind(id)
      .first<number>('total')) ?? 0
  );
}

/** Only a rejected Comment without replies can be deleted; `deleteComment` repeats this in SQL. */
export function canDeleteComment(status: CommentStatus, replyCount: number) {
  return status === 'rejected' && replyCount === 0;
}

export async function deleteComment(db: D1Database, id: string) {
  const { meta } = await db
    .prepare(
      `DELETE FROM comment
        WHERE id = ? AND status = 'rejected'
          AND NOT EXISTS (SELECT 1 FROM comment AS reply WHERE reply.parent_id = comment.id)`,
    )
    .bind(id)
    .run();
  return meta.changes > 0;
}
