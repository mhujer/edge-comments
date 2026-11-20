import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { validateCommentBody } from '../shared/comment-input';
import { renderComment } from '../shared/comment-renderer';
import { normalizePageKey } from '../shared/page-key';
import type {
  CommentContent,
  CommentsResponse,
  Language,
} from '../shared/public-comments';
import type { ModerationMode } from '../shared/site-settings';
import type { WorkerBindings } from './bindings';
import { submitComment } from './comment-submission';

type ResolvedSite = {
  id: string;
  name: string;
  language: Language;
  moderationMode: ModerationMode;
};

type PublicApiEnv = {
  Bindings: WorkerBindings;
  Variables: { site: ResolvedSite };
};

const resolveSite = createMiddleware<PublicApiEnv>(async (context, next) => {
  context.header('Vary', 'Origin', { append: true });
  const origin = context.req.header('Origin');
  if (!origin || origin === 'null') {
    return context.json({ error: { code: 'origin_not_allowed' } }, 403);
  }
  const site = await context.env.DB.prepare(
    `SELECT site.id, site.name, site.default_language AS language, site.moderation_mode AS moderationMode
       FROM site_origin JOIN site ON site.id = site_origin.site_id
      WHERE site_origin.origin = ?`,
  )
    .bind(origin)
    .first<ResolvedSite>();
  if (!site) {
    return context.json({ error: { code: 'origin_not_allowed' } }, 403);
  }
  context.set('site', site);
  context.header('Access-Control-Allow-Origin', origin);
  await next();
});

function rateLimit(binding: 'RL_API' | 'RL_SUBMIT') {
  return createMiddleware<PublicApiEnv>(async (context, next) => {
    const key = context.req.header('CF-Connecting-IP') ?? '';
    const { success } = await context.env[binding].limit({ key });
    if (!success) return context.json({ error: { code: 'rate_limited' } }, 429);
    await next();
  });
}

const rateLimitApi = rateLimit('RL_API');

const requireJson = createMiddleware<PublicApiEnv>(async (context, next) => {
  if (
    context.req
      .header('Content-Type')
      ?.split(';', 1)[0]
      .trim()
      .toLowerCase() !== 'application/json'
  ) {
    return context.json({ error: { code: 'unsupported_media_type' } }, 415);
  }
  await next();
});

type VisibleCommentRow =
  | (CommentContent & { status: 'published' })
  | (Pick<CommentContent, 'id' | 'parentId' | 'createdAt'> & {
      status: 'pending' | 'rejected';
      name: null;
      html: null;
    });

const listVisibleComments = `
  WITH RECURSIVE target_page(id) AS (
    SELECT id FROM page WHERE site_id = ?1 AND key = ?2
  ), visible(id) AS (
    SELECT comment.id FROM comment JOIN target_page ON target_page.id = comment.page_id
    WHERE comment.status = 'published'
    UNION
    SELECT parent.id FROM visible
      JOIN comment AS child ON child.id = visible.id
      JOIN comment AS parent ON parent.id = child.parent_id
      JOIN target_page ON target_page.id = parent.page_id
  )
  SELECT comment.id, parent_id AS parentId, created_at AS createdAt, status,
         CASE WHEN status = 'published' THEN commenter_name END AS name,
         CASE WHEN status = 'published' THEN body_html END AS html
    FROM comment JOIN visible ON visible.id = comment.id
`;

export const publicApi = new Hono<PublicApiEnv>();

publicApi.use('*', async (context, next) => {
  if (context.req.method === 'GET') context.header('Cache-Control', 'no-store');
  context.header('X-Content-Type-Options', 'nosniff');
  context.header(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'",
  );
  await next();
});

function preflight(methods: string) {
  return (context: Context<PublicApiEnv>) => {
    context.header('Access-Control-Allow-Methods', methods);
    context.header('Access-Control-Allow-Headers', 'Content-Type');
    context.header('Access-Control-Max-Age', '86400');
    return context.body(null, 204);
  };
}

publicApi.options('/comments', resolveSite, preflight('GET, POST'));

function requestedPageKey(context: Context<PublicApiEnv>) {
  const raw = context.req.query('page');
  if (raw === undefined) return undefined;
  const keyType =
    context.req.query('pageType') === 'explicit' ? 'explicit' : undefined;
  return normalizePageKey(raw, keyType);
}

publicApi.get('/comments', resolveSite, rateLimitApi, async (context) => {
  const key = requestedPageKey(context);
  if (!key) return context.json({ error: { code: 'not_found' } }, 404);

  const { results } = await context.env.DB.prepare(listVisibleComments)
    .bind(context.var.site.id, key)
    .all<VisibleCommentRow>();
  const response: CommentsResponse = {
    site: {
      language: context.var.site.language,
      turnstileSiteKey: context.env.TURNSTILE_SITE_KEY,
    },
    comments: results.map(({ id, parentId, createdAt, status, name, html }) =>
      status === 'published'
        ? { id, parentId, createdAt, name, html }
        : { id, parentId, createdAt, removed: true },
    ),
  };
  return context.json(response);
});

publicApi.options('/preview', resolveSite, preflight('POST'));

publicApi.post(
  '/comments',
  async (context, next) => {
    await next();
    console.log(
      JSON.stringify({
        event: 'comment_submission',
        siteId: context.var.site?.id,
        status: context.res.status,
      }),
    );
  },
  resolveSite,
  rateLimit('RL_SUBMIT'),
  requireJson,
  async (context) => {
    context.header('Cache-Control', 'no-store');
    const result = await submitComment(
      context.env,
      context.executionCtx,
      context.var.site,
      context.req.header('Origin') ?? '',
      context.req.header('CF-Connecting-IP'),
      await context.req.json<unknown>().catch(() => null),
    );
    return context.json(result.body, result.status);
  },
);

publicApi.post(
  '/preview',
  resolveSite,
  rateLimitApi,
  requireJson,
  async (context) => {
    context.header('Cache-Control', 'no-store');
    const input = await context.req
      .json<{ body?: unknown } | null>()
      .catch(() => null);
    const body = validateCommentBody(
      typeof input?.body === 'string' ? input.body : '',
    );
    if (!body.ok) return context.json({ error: { code: body.code } }, 400);
    return context.json({ html: renderComment(body.body) });
  },
);

publicApi.post('*', requireJson, (context) =>
  context.json({ error: { code: 'not_found' } }, 404),
);
