import { html, raw } from 'hono/html';
import type { PropsWithChildren } from 'hono/jsx';
import { COMMENT_RENDERER_VERSION } from '../../shared/comment-renderer';
import { commentTime } from '../../shared/comment-time';
import {
  canDeleteComment,
  type AdminComment,
  type AdminSite,
  type CommentCursor,
  type CommentStatus,
  type getCommentDetail,
  type listComments,
  type listReplies,
} from './data';

export const moderationTabs = {
  pending: { label: 'Pending', path: '/admin' },
  published: { label: 'Published', path: '/admin/published' },
  rejected: { label: 'Rejected', path: '/admin/rejected' },
} as const satisfies Record<CommentStatus, { label: string; path: string }>;

const adminTabs = [
  ...Object.values(moderationTabs),
  { label: 'Sites', path: '/admin/sites' },
  { label: 'Tools', path: '/admin/tools' },
] as const;

type AdminTab = (typeof adminTabs)[number]['label'];
const flashStatuses = ['approved', 'rejected', 'restored', 'deleted'] as const;

export type Flash = {
  status: (typeof flashStatuses)[number];
  id: string;
};

export function flashStatus(value: unknown): Flash['status'] | undefined {
  return flashStatuses.find((status) => status === value);
}

export interface ActionOrigin {
  from: CommentStatus | 'detail';
  before?: CommentCursor;
}

export function cursorValue({ createdAt, id }: CommentCursor) {
  return createdAt + ',' + id;
}

export function commentPath(commentId: string) {
  return '/admin/comment/' + encodeURIComponent(commentId);
}

export function pagePath(pageId: string) {
  return '/admin/page/' + encodeURIComponent(pageId);
}

export function AdminLayout({
  active,
  title,
  pendingCount,
  flash,
  children,
}: PropsWithChildren<{
  active: AdminTab;
  title: string;
  pendingCount: number;
  flash?: Flash;
}>) {
  return html`<!doctype html>${(
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{title} · edge-comments</title>
          <link rel="stylesheet" href="/admin/admin.css" />
        </head>
        <body>
          <header class="top-bar">
            <strong>edge-comments</strong>
            <nav aria-label="Admin">
              {adminTabs.map(({ label, path }) => (
                <a
                  href={path}
                  aria-current={active === label ? 'page' : undefined}
                >
                  {label}
                  {label === moderationTabs.pending.label && (
                    <>
                      {' '}
                      <span class="count">{pendingCount}</span>
                    </>
                  )}
                </a>
              ))}
            </nav>
          </header>
          <main>
            {flash && (
              <p class="flash" role="status">
                <a href={commentPath(flash.id)}>Comment</a> {flash.status}.
              </p>
            )}
            <h1>{title}</h1>
            {children}
          </main>
        </body>
      </html>
    )}`;
}

export function StatusBadge({ status }: { status: CommentStatus }) {
  return <span class={`badge badge-${status}`}>{status}</span>;
}

export function PageLink({
  pageTitle,
  pageKey,
  pageUrl,
}: Pick<AdminComment, 'pageTitle' | 'pageKey' | 'pageUrl'>) {
  const url = URL.parse(pageUrl);
  const label = pageTitle || pageKey;
  if (url?.protocol === 'https:' || url?.protocol === 'http:') {
    return (
      <a href={url.href} target="_blank" rel="noopener">
        {label}
      </a>
    );
  }
  return <span>{label}</span>;
}

function Email({ email }: { email: string }) {
  return (
    <a href={`mailto:${encodeURIComponent(email).replace('%40', '@')}`}>
      {email}
    </a>
  );
}

function CommentBody({ html }: { html: string }) {
  // This field is populated by the shared, allowlisted Comment renderer.
  return <div class="comment-body">{raw(html)}</div>;
}

function ActionFields({ from, before }: ActionOrigin) {
  return (
    <>
      <input type="hidden" name="from" value={from} />
      {before && (
        <input type="hidden" name="before" value={cursorValue(before)} />
      )}
    </>
  );
}

function replyReason(count: number) {
  return count === 1 ? 'Has 1 reply' : `Has ${count} replies`;
}

function Actions({
  comment,
  replyCount,
  from,
  before,
}: {
  comment: AdminComment;
  replyCount: number;
} & ActionOrigin) {
  const path = commentPath(comment.id);
  if (comment.status === 'rejected') {
    return (
      <form class="actions" method="post">
        <ActionFields from={from} before={before} />
        <button type="submit" class="approve" formaction={path + '/restore'}>
          Restore
        </button>
        <button
          type="submit"
          class="reject"
          formaction={path + '/delete'}
          formmethod="get"
          disabled={!canDeleteComment(comment.status, replyCount)}
        >
          Delete permanently
        </button>
        {replyCount > 0 && <span>{replyReason(replyCount)}</span>}
      </form>
    );
  }
  return (
    <form class="actions" method="post">
      <ActionFields from={from} before={before} />
      {comment.status === 'pending' && (
        <button type="submit" class="approve" formaction={path + '/approve'}>
          Approve
        </button>
      )}
      <button type="submit" class="reject" formaction={path + '/reject'}>
        Reject
      </button>
    </form>
  );
}

export function DeleteConfirmation({
  comment,
  replyCount,
  source,
  cancel,
  available,
}: {
  comment: AdminComment;
  replyCount: number;
  source: ActionOrigin;
  cancel: string;
  available: boolean;
}) {
  return (
    <article class="panel">
      <h2>{comment.commenterName}</h2>
      <p>
        <PageLink {...comment} />
      </p>
      {available ? (
        <form
          action={commentPath(comment.id) + '/delete'}
          method="post"
          class="actions"
        >
          <ActionFields {...source} />
          <button type="submit" class="reject">
            Delete permanently
          </button>
          <a href={cancel}>Cancel</a>
        </form>
      ) : (
        <>
          <p>
            {comment.status === 'rejected'
              ? replyReason(replyCount)
              : 'Only rejected Comments can be deleted.'}
          </p>
          <a href={cancel}>Back</a>
        </>
      )}
    </article>
  );
}

function ParentQuote({
  comment,
  linked = false,
}: {
  comment: AdminComment;
  linked?: boolean;
}) {
  if (!comment.parentId) return null;

  const parentName = comment.parentName ?? '';
  return (
    <blockquote class="parent">
      ↪ in reply to{' '}
      {linked ? (
        <a href={commentPath(comment.parentId)}>{parentName}</a>
      ) : (
        <strong>{parentName}</strong>
      )}{' '}
      {comment.parentStatus && comment.parentStatus !== 'published' && (
        <StatusBadge status={comment.parentStatus} />
      )}
      <div class={linked ? 'parent-quote' : 'excerpt'}>
        {comment.parentExcerpt}
      </div>
    </blockquote>
  );
}

function CommentCard({
  comment,
  time,
  before,
}: {
  comment: Awaited<ReturnType<typeof listComments>>['comments'][number];
  time: ReturnType<typeof commentTime>;
  before?: CommentCursor;
}) {
  return (
    <article class="comment-card">
      <div class="page-title">
        <PageLink {...comment} />
      </div>
      <ParentQuote comment={comment} />
      <div class="byline">
        <strong>{comment.commenterName}</strong>
        {comment.commenterEmail && (
          <>
            {' '}
            · <Email email={comment.commenterEmail} />
          </>
        )}
        {' · '}
        <time
          datetime={comment.createdAt}
          title={time.fullDate(comment.createdAt)}
        >
          {time.relativeDate(comment.createdAt)}
        </time>
        {comment.externalId && (
          <>
            {' '}
            · <span>imported</span>
          </>
        )}
      </div>
      <CommentBody html={comment.bodyHtml} />
      <div class="card-footer">
        <Actions
          comment={comment}
          replyCount={comment.replyCount}
          from={comment.status}
          before={before}
        />
        <a href={commentPath(comment.id)}>Details →</a>
      </div>
    </article>
  );
}

export function CommentList({
  label,
  comments,
  sites,
  newer,
  older,
  before,
}: {
  label: string;
  comments: Awaited<ReturnType<typeof listComments>>['comments'];
  sites: Map<string, AdminSite>;
  newer?: string;
  older?: string;
  before?: CommentCursor;
}) {
  const bySite = Map.groupBy(comments, (comment) => comment.siteId);
  const time = commentTime('en');

  return (
    <>
      {!comments.length && <p class="empty">No {label} Comments.</p>}
      {Array.from(sites.values(), (site) => {
        const group = bySite.get(site.id);
        if (!group) return null;
        return (
          <section class={`site-group ${site.colorClass}`}>
            <h2>
              <span class="site-dot" aria-hidden="true" />
              {site.name}
              {site.origins.length > 0 && (
                <small>{site.origins.join(', ')}</small>
              )}
            </h2>
            {group.map((comment) => (
              <CommentCard comment={comment} time={time} before={before} />
            ))}
          </section>
        );
      })}
      {(newer || older) && (
        <nav class="pagination" aria-label="Comment pages">
          {newer && <a href={newer}>← Newer</a>}
          {older && (
            <a class="older" href={older}>
              Older →
            </a>
          )}
        </nav>
      )}
    </>
  );
}

export function CommentDetail({
  comment,
  site,
  replies,
}: {
  comment: NonNullable<Awaited<ReturnType<typeof getCommentDetail>>>;
  site: AdminSite;
  replies: Awaited<ReturnType<typeof listReplies>>;
}) {
  const time = commentTime('en');
  return (
    <div class={`detail ${site.colorClass}`}>
      <div>
        <article class="panel">
          <div class="detail-heading">
            <span class="site-chip">{site.name}</span>
            <PageLink {...comment} />
          </div>
          <h2>
            {comment.commenterName} <StatusBadge status={comment.status} />
          </h2>
          <Actions
            comment={comment}
            replyCount={replies.length}
            from="detail"
          />
          <ParentQuote comment={comment} linked />
          <CommentBody html={comment.bodyHtml} />
          <details>
            <summary>
              Markdown source · rendered v{comment.htmlVersion}
              {comment.htmlVersion < COMMENT_RENDERER_VERSION && ' (stale)'}
            </summary>
            <pre class="source">{comment.bodyMd}</pre>
          </details>
        </article>
        {replies.length > 0 && (
          <section class="panel replies">
            <h2>Replies</h2>
            <ul>
              {replies.map((reply) => (
                <li>
                  <a href={commentPath(reply.id)}>{reply.commenterName}</a>{' '}
                  <StatusBadge status={reply.status} />
                  <div class="excerpt">{reply.excerpt}</div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <aside class="panel metadata" aria-label="Comment metadata">
        <dl>
          <dt>Page</dt>
          <dd>
            <PageLink {...comment} />
          </dd>
          <dt>Page key</dt>
          <dd>
            <a href={pagePath(comment.pageId)}>{comment.pageKey}</a>
          </dd>
          <dt>Site</dt>
          <dd>{site.name}</dd>
          <dt>Email</dt>
          <dd>
            {comment.commenterEmail ? (
              <Email email={comment.commenterEmail} />
            ) : (
              '—'
            )}
          </dd>
          <dt>Written</dt>
          <dd>
            <time datetime={comment.createdAt}>
              {time.fullDate(comment.createdAt)}
            </time>
          </dd>
          <dt>Status changed</dt>
          <dd>
            <time datetime={comment.statusChangedAt}>
              {time.fullDate(comment.statusChangedAt)}
            </time>
          </dd>
          <dt>External ID</dt>
          <dd>{comment.externalId ?? '—'}</dd>
          <dt>Comment ID</dt>
          <dd>{comment.id}</dd>
        </dl>
      </aside>
    </div>
  );
}
