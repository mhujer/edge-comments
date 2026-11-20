import { Hono, type Context } from 'hono';
import type { WorkerEnv } from '../bindings';
import {
  canDeleteComment,
  countPending,
  countReplies,
  deleteComment,
  getCommentDetail,
  listComments,
  listReplies,
  moderateComment,
  newerCursor,
  type CommentCursor,
  type CommentStatus,
} from './data';
import { adminCsrf, adminHeaders, requireAdmin } from './guard';
import { listAdminSites } from './site-data';
import { registerSiteRoutes } from './sites';
import { registerToolsRoutes } from './tools';
import {
  AdminLayout,
  CommentDetail,
  commentPath,
  CommentList,
  cursorValue,
  DeleteConfirmation,
  moderationTabs,
  type ActionOrigin,
  flashStatus,
  type Flash,
} from './views';

export const admin = new Hono<WorkerEnv>();
admin.use('*', requireAdmin, adminCsrf, adminHeaders);
admin.get(
  '/admin.css',
  (context) => context.env.ASSETS?.fetch(context.req.raw) ?? context.notFound(),
);

function moderationFlash(context: Context): Flash | undefined {
  const status = flashStatus(context.req.query('moderated'));
  const id = context.req.query('comment');
  if (!id || !status) return;
  return { status, id };
}

const moderationStatuses = Object.keys(moderationTabs) as CommentStatus[];

function parseCursor(value: unknown): CommentCursor | undefined {
  if (typeof value !== 'string') return;
  const [createdAt, id, extra] = value.split(',');
  if (
    extra === undefined &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt) &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)
  ) {
    return { createdAt, id };
  }
}

function pathWithModerationQuery(
  path: string,
  before?: CommentCursor,
  flash?: Flash,
) {
  const query = new URLSearchParams();
  if (before) query.set('before', cursorValue(before));
  if (flash) {
    query.set('moderated', flash.status);
    query.set('comment', flash.id);
  }
  return query.size ? path + '?' + query.toString() : path;
}

function actionOrigin(from: unknown, before: unknown): ActionOrigin {
  const status = moderationStatuses.find((status) => status === from);
  return status
    ? { from: status, before: parseCursor(before) }
    : { from: 'detail' };
}

function actionDestination(source: ActionOrigin, id: string, flash?: Flash) {
  const path =
    source.from === 'detail'
      ? flash?.status === 'deleted'
        ? moderationTabs.rejected.path
        : commentPath(id)
      : moderationTabs[source.from].path;
  return pathWithModerationQuery(path, source.before, flash);
}

function logModeration(id: string, action: string, status: string) {
  console.log(
    JSON.stringify({
      event: 'comment_moderated',
      commentId: id,
      action,
      status,
    }),
  );
}

for (const status of moderationStatuses) {
  const { label, path } = moderationTabs[status];
  admin.get(path.slice('/admin'.length) || '/', async (context) => {
    const db = context.env.DB;
    const before = parseCursor(context.req.query('before'));
    const [{ comments, older }, newer, sites, pendingCount] = await Promise.all(
      [
        listComments(db, status, before),
        before && newerCursor(db, status, before),
        listAdminSites(db),
        countPending(db),
      ],
    );
    return context.html(
      <AdminLayout
        active={label}
        title={label}
        pendingCount={pendingCount}
        flash={moderationFlash(context)}
      >
        <CommentList
          label={label}
          comments={comments}
          sites={sites}
          before={before}
          newer={before ? pathWithModerationQuery(path, newer) : undefined}
          older={older ? pathWithModerationQuery(path, older) : undefined}
        />
      </AdminLayout>,
    );
  });
}
admin.get('/comment/:id', async (context) => {
  const db = context.env.DB;
  const id = context.req.param('id');
  const [comment, pendingCount] = await Promise.all([
    getCommentDetail(db, id),
    countPending(db),
  ]);
  if (!comment) {
    return context.html(
      <AdminLayout
        active={moderationTabs.pending.label}
        title="Comment"
        pendingCount={pendingCount}
      >
        <p>This Comment no longer exists.</p>
      </AdminLayout>,
      404,
    );
  }

  const [sites, replies] = await Promise.all([
    listAdminSites(db),
    listReplies(db, id),
  ]);
  const site = sites.get(comment.siteId);
  if (!site) return context.notFound();
  return context.html(
    <AdminLayout
      active={moderationTabs[comment.status].label}
      title="Comment"
      pendingCount={pendingCount}
      flash={moderationFlash(context)}
    >
      <CommentDetail comment={comment} site={site} replies={replies} />
    </AdminLayout>,
  );
});

registerSiteRoutes(admin);
registerToolsRoutes(admin);

for (const [action, status, message, previousStatuses] of [
  ['approve', 'published', 'approved', ['pending']],
  ['reject', 'rejected', 'rejected', ['pending', 'published']],
  ['restore', 'published', 'restored', ['rejected']],
] as const) {
  admin.post(`/comment/:id/${action}`, async (context) => {
    const id = context.req.param('id');
    const { from, before } = await context.req.parseBody();
    const source = actionOrigin(from, before);
    const changed = await moderateComment(
      context.env.DB,
      id,
      status,
      previousStatuses,
    );
    if (changed) logModeration(id, action, status);
    return context.redirect(
      actionDestination(
        source,
        id,
        changed ? { status: message, id } : undefined,
      ),
      303,
    );
  });
}

async function confirmDelete(
  context: Context<WorkerEnv>,
  id: string,
  source: ActionOrigin,
  submitted = false,
) {
  const db = context.env.DB;
  const [comment, replyCount, pendingCount] = await Promise.all([
    getCommentDetail(db, id),
    countReplies(db, id),
    countPending(db),
  ]);
  const available =
    comment !== null && canDeleteComment(comment.status, replyCount);
  return context.html(
    <AdminLayout
      active={moderationTabs.rejected.label}
      title={available ? 'Delete Comment permanently?' : 'Delete Comment'}
      pendingCount={pendingCount}
    >
      {comment ? (
        <DeleteConfirmation
          comment={comment}
          replyCount={replyCount}
          source={source}
          cancel={actionDestination(source, id)}
          available={available}
        />
      ) : (
        <p>This Comment no longer exists.</p>
      )}
    </AdminLayout>,
    comment ? (available && !submitted ? 200 : 409) : 404,
  );
}

admin.get('/comment/:id/delete', (context) =>
  confirmDelete(
    context,
    context.req.param('id'),
    actionOrigin(context.req.query('from'), context.req.query('before')),
  ),
);

admin.post('/comment/:id/delete', async (context) => {
  const id = context.req.param('id');
  const { from, before } = await context.req.parseBody();
  const source = actionOrigin(from, before);
  if (!(await deleteComment(context.env.DB, id))) {
    return confirmDelete(context, id, source, true);
  }

  logModeration(id, 'delete', 'deleted');
  return context.redirect(
    actionDestination(source, id, { status: 'deleted', id }),
    303,
  );
});
