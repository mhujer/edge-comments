import {
  ANONYMOUS_NAME,
  MAX_BODY_CHARACTERS,
  MAX_NAME_CHARACTERS,
  validCommentEmail,
  validCommentName,
  validateCommentBody,
} from '../shared/comment-input';
import {
  COMMENT_RENDERER_VERSION,
  renderComment,
} from '../shared/comment-renderer';
import { createId, isoTimestamp } from '../shared/identity';
import {
  storedPageMetadata,
  truncateCharacters,
} from '../shared/page-metadata';
import { normalizePageKey } from '../shared/page-key';
import type {
  SubmissionResponse,
  SubmittedComment,
} from '../shared/public-comments';
import { emailErrorCode, sendAdminEmail } from './admin-email';
import type { WorkerBindings } from './bindings';
import { recordField, stringField } from './untrusted-input';
import { buildCommentEmail, type CommentEmailParent } from './comment-email';

export const siteverifyUrl =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const publishedParentOnPage = `
  SELECT comment.commenter_name AS name, comment.body_md AS markdown
    FROM comment JOIN page ON page.id = comment.page_id
    WHERE comment.id = ?1 AND page.site_id = ?2 AND page.key = ?3
      AND comment.status = 'published'
`;

async function verifyTurnstile(
  secret: string,
  token: string,
  hostname: string,
  remoteip: string | undefined,
): Promise<boolean> {
  if (token.length === 0 || token.length > 2048) return false;
  try {
    const response = await fetch(siteverifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    const result = recordField(await response.json<unknown>());
    return result.success === true && result.hostname === hostname;
  } catch {
    return false;
  }
}

type SubmissionResult =
  | { status: 201; body: SubmissionResponse }
  | {
      status: 400 | 403 | 404;
      body: { error: { code: string } };
    };

function failure(
  code: string,
  status: 400 | 403 | 404 = 400,
): SubmissionResult {
  return { status, body: { error: { code } } };
}

export async function submitComment(
  env: WorkerBindings,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  site: { id: string; name: string },
  origin: string,
  remoteip: string | undefined,
  input: unknown,
): Promise<SubmissionResult> {
  const siteId = site.id;
  const payload = recordField(input);
  if (stringField(payload.website) !== '') {
    return {
      status: 201,
      body: {
        comment: {
          id: createId(),
          parentId: stringField(payload.parentId) || null,
          createdAt: isoTimestamp(),
          name:
            truncateCharacters(
              stringField(payload.name).trim(),
              MAX_NAME_CHARACTERS,
            ) || ANONYMOUS_NAME,
          html: renderComment(
            truncateCharacters(
              stringField(payload.body).trim(),
              MAX_BODY_CHARACTERS,
            ),
          ),
          status: 'pending',
        },
      },
    };
  }

  const name = stringField(payload.name).trim();
  if (!validCommentName(name)) return failure('invalid_name');

  const email = stringField(payload.email).trim();
  if (
    (payload.email != null && typeof payload.email !== 'string') ||
    (email && !validCommentEmail(email))
  ) {
    return failure('invalid_email');
  }

  const body = validateCommentBody(stringField(payload.body));
  if (!body.ok) return failure(body.code);

  const key =
    typeof payload.page === 'string'
      ? normalizePageKey(
          payload.page,
          payload.pageType === 'explicit' ? 'explicit' : undefined,
        )
      : null;
  if (key === null) return failure('not_found', 404);

  const parentId = payload.parentId ?? null;
  let parent: CommentEmailParent | undefined;
  if (parentId !== null) {
    if (typeof parentId !== 'string') return failure('parent_invalid');
    const found = await env.DB.prepare(publishedParentOnPage)
      .bind(parentId, siteId, key)
      .first<CommentEmailParent>();
    if (!found) return failure('parent_invalid');
    parent = found;
  }

  const rawUrl = stringField(payload.url);
  if (!URL.canParse(rawUrl)) return failure('origin_not_allowed', 403);
  const url = new URL(rawUrl);
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    !(await env.DB.prepare(
      'SELECT 1 FROM site_origin WHERE site_id = ? AND origin = ?',
    )
      .bind(siteId, url.origin)
      .first())
  ) {
    return failure('origin_not_allowed', 403);
  }
  url.search = '';
  url.hash = '';

  if (
    !(await verifyTurnstile(
      env.TURNSTILE_SECRET,
      stringField(payload.turnstileToken),
      new URL(origin).hostname,
      remoteip,
    ))
  ) {
    return failure('turnstile_failed');
  }

  const id = createId();
  const createdAt = isoTimestamp();
  const html = renderComment(body.body);
  const page = {
    key,
    ...storedPageMetadata(url.href, stringField(payload.title)),
  };

  // Recheck the parent in the write transaction. Moderation can happen while
  // Siteverify is in flight.
  const [, inserted] = await env.DB.batch<Pick<SubmittedComment, 'status'>>([
    env.DB.prepare(
      `INSERT INTO page (id, site_id, key, url, title, created_at, updated_at)
        SELECT ?4, ?2, ?3, ?5, ?6, ?7, ?7
          WHERE ?1 IS NULL OR EXISTS (${publishedParentOnPage})
        ON CONFLICT (site_id, key) DO UPDATE SET
          url = excluded.url, title = excluded.title, updated_at = excluded.updated_at`,
    ).bind(parentId, siteId, key, createId(), page.url, page.title, createdAt),
    env.DB.prepare(
      `INSERT INTO comment (
         id, page_id, parent_id, status, commenter_name, commenter_email, body_md,
         body_html, html_version, created_at, status_changed_at
       )
       SELECT ?4, page.id, ?1,
         CASE WHEN site.moderation_mode = 'publish_immediately' THEN 'published' ELSE 'pending' END,
         ?5, ?6, ?7, ?8, ?9, ?10, ?10
       FROM page JOIN site ON site.id = page.site_id
       WHERE page.site_id = ?2 AND page.key = ?3
         AND (?1 IS NULL OR EXISTS (${publishedParentOnPage}))
       RETURNING status`,
    ).bind(
      parentId,
      siteId,
      key,
      id,
      name,
      email || null,
      body.body,
      html,
      COMMENT_RENDERER_VERSION,
      createdAt,
    ),
  ]);
  const written = inserted.results[0];
  if (!written) return failure('parent_invalid');

  const notification = buildCommentEmail(
    {
      name,
      email: email || null,
      markdown: body.body,
      status: written.status,
      moderationUrl: `https://${env.CUSTOM_DOMAIN}/admin/comment/${id}`,
    },
    page,
    site,
    parent,
  );
  ctx.waitUntil(
    sendAdminEmail(env, notification).catch((error: unknown) => {
      console.log(
        JSON.stringify({
          event: 'comment_email_failed',
          commentId: id,
          error: emailErrorCode(error),
        }),
      );
    }),
  );

  return {
    status: 201,
    body: {
      comment: { id, parentId, createdAt, name, html, status: written.status },
    },
  };
}
