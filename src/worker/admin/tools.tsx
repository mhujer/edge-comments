import type { Hono } from 'hono';
import {
  COMMENT_RENDERER_VERSION,
  renderComment,
} from '../../shared/comment-renderer';
import { listBackups } from '../backups';
import type { WorkerEnv } from '../bindings';
import { loadDeploymentExport } from '../export';
import { countPending } from './data';
import { AdminLayout } from './views';

const rerenderPath = '/tools/re-render';
const exportPath = '/tools/export';

async function latestBackupTime(bucket: R2Bucket) {
  let latest: Date | undefined;
  for await (const { uploaded } of listBackups(bucket)) {
    if (!latest || latest < uploaded) latest = uploaded;
  }
  return latest?.toISOString();
}

// With the synthetic export lengths and a URL in every fourth Comment, these
// limits kept representative batches below 3 ms at p99 in Node render-only tests.
const batchSize = 20;
const batchBodyLength = 4_000;

async function countStaleComments(db: D1Database) {
  return (
    (await db
      .prepare('SELECT count(*) AS total FROM comment WHERE html_version < ?')
      .bind(COMMENT_RENDERER_VERSION)
      .first<number>('total')) ?? 0
  );
}

async function rerenderBatch(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT id, body_md AS bodyMd
         FROM comment
        WHERE html_version < ?
        ORDER BY id
        LIMIT ?`,
    )
    .bind(COMMENT_RENDERER_VERSION, batchSize)
    .all<{ id: string; bodyMd: string }>();
  if (results.length === 0) return;

  const update = db.prepare(
    `UPDATE comment
        SET body_html = ?, html_version = ?
      WHERE id = ? AND html_version < ?`,
  );
  const statements: D1PreparedStatement[] = [];
  let bodyLength = 0;
  for (const { id, bodyMd } of results) {
    bodyLength += bodyMd.length;
    // Give a large Comment its own batch so it can still be processed.
    if (statements.length > 0 && bodyLength > batchBodyLength) break;
    statements.push(
      update.bind(
        renderComment(bodyMd),
        COMMENT_RENDERER_VERSION,
        id,
        COMMENT_RENDERER_VERSION,
      ),
    );
  }
  await db.batch(statements);
}

export function registerToolsRoutes(admin: Hono<WorkerEnv>) {
  admin.get('/tools', async (context) => {
    const db = context.env.DB;
    const [pendingCount, staleCount, backupTime] = await Promise.all([
      countPending(db),
      countStaleComments(db),
      latestBackupTime(context.env.BACKUPS).catch(() => null),
    ]);
    const continuing = staleCount > 0 && context.req.query('rerender') === '1';
    return context.html(
      <AdminLayout active="Tools" title="Tools" pendingCount={pendingCount}>
        <section class="panel">
          <h2>Export</h2>
          <p>
            <a href={'/admin' + exportPath}>Export all Sites</a>
          </p>
          <p>
            Last R2 backup:{' '}
            {backupTime ? (
              <time datetime={backupTime}>{backupTime}</time>
            ) : backupTime === null ? (
              'unavailable'
            ) : (
              'never'
            )}
          </p>
        </section>
        <section class="panel">
          <h2>Comment renderer</h2>
          <p>Current renderer version {COMMENT_RENDERER_VERSION}</p>
          <p>
            {staleCount} stale {staleCount === 1 ? 'Comment' : 'Comments'}
          </p>
          <form action={'/admin' + rerenderPath} method="post">
            <button class="approve" type="submit" disabled={staleCount === 0}>
              {continuing ? 'Continue' : 'Re-render all Comments'}
            </button>
          </form>
        </section>
      </AdminLayout>,
    );
  });
  admin.get(exportPath, async (context) => {
    const exported = await loadDeploymentExport(context.env.DB);
    const date = exported.exported_at.slice(0, 10);
    context.header(
      'Content-Disposition',
      `attachment; filename="edge-comments-${date}.json"`,
    );
    return context.json(exported);
  });
  admin.post(rerenderPath, async (context) => {
    await rerenderBatch(context.env.DB);
    return context.redirect('/admin/tools?rerender=1', 303);
  });
}
