import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { getResponse, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import worker from '../../src/worker';
import type {
  CommentsResponse,
  SubmissionResponse,
} from '../../src/shared/public-comments';

const origin = 'https://blog.example:8443';
const otherOrigin = 'https://other.example';
const workerUrl = 'https://comments.example';
const verifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const siteId = '019a0000-0000-7000-8000-000000000001';
const otherSiteId = '019a0000-0000-7000-8000-000000000002';
const createdAt = '2026-10-18T09:00:00.000Z';
const submission = {
  page: '/first/index.html?q=old',
  url: origin + '/first/?q=new#fragment',
  title: 'First Page',
  name: ' Ada ',
  email: 'ada@example.test',
  body: ' **Hello** ',
  turnstileToken: 'browser-token',
  website: '',
};

const verify = vi.fn<(request: Pick<Request, 'json'>) => Promise<Response>>();
const submitLimit = vi.fn();
const apiLimit = vi.fn();
const sendEmail = vi.fn<SendEmail['send']>();

beforeEach(async () => {
  verify
    .mockReset()
    .mockImplementation(() =>
      Promise.resolve(
        HttpResponse.json({ success: true, hostname: 'blog.example' }),
      ),
    );
  submitLimit.mockReset().mockResolvedValue({ success: true });
  apiLimit.mockReset().mockResolvedValue({ success: true });
  sendEmail.mockReset().mockResolvedValue({ messageId: 'test-message' });
  vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
    const response = await getResponse(
      [http.post(verifyUrl, ({ request }) => verify(request))],
      new Request(input, init),
    );
    if (!response) throw new Error('Unexpected outbound request');
    return response;
  });
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO site (id, name, default_language, moderation_mode, created_at, updated_at) VALUES (?, 'Blog', 'en', 'approve_first', ?, ?), (?, 'Other', 'cs', 'publish_immediately', ?, ?)",
    ).bind(siteId, createdAt, createdAt, otherSiteId, createdAt, createdAt),
    env.DB.prepare(
      "INSERT INTO site_origin (id, site_id, origin) VALUES ('019a0000-0000-7000-8000-0000000000a1', ?, ?), ('019a0000-0000-7000-8000-0000000000a2', ?, ?)",
    ).bind(siteId, origin, otherSiteId, otherOrigin),
  ]);
});

afterEach(() => vi.unstubAllGlobals());

async function request(path: string, init: RequestInit) {
  const ctx = createExecutionContext();
  const bindings = {
    DB: env.DB,
    BACKUPS: env.BACKUPS,
    TURNSTILE_SITE_KEY: 'test',
    TURNSTILE_SECRET: 'test-secret',
    RL_SUBMIT: { limit: submitLimit },
    RL_API: { limit: apiLimit },
    EMAIL: { send: sendEmail },
    ADMIN_EMAIL: 'admin@example.test',
    EMAIL_FROM: 'notifications@example.test',
    CUSTOM_DOMAIN: 'comments.example.test',
  };
  const response = await worker.fetch(
    new Request(workerUrl + '/api/' + path, init),
    bindings,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

function post(path: string, body: unknown, siteOrigin = origin) {
  return request(path, {
    method: 'POST',
    headers: {
      Origin: siteOrigin,
      'CF-Connecting-IP': '203.0.113.12',
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
}

test('previews rendered Markdown without Turnstile', async () => {
  const response = await post('preview', {
    body: '  `code` and https://example.test/  ',
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    html: '<p><code>code</code> and <a href="https://example.test/" rel="nofollow ugc noopener">https://example.test/</a></p>\n',
  });
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  expect(response.headers.get('Vary')).toBe('Origin');
  expect(verify).not.toHaveBeenCalled();
  expect(submitLimit).not.toHaveBeenCalled();
  expect(apiLimit).toHaveBeenCalledExactlyOnceWith({ key: '203.0.113.12' });
});

test('allows a cross-origin JSON preview preflight only from an Allowed origin', async () => {
  const preflight = (siteOrigin: string) =>
    request('preview', {
      method: 'OPTIONS',
      headers: {
        Origin: siteOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    });
  const accepted = await preflight(origin);
  expect(accepted.status).toBe(204);
  expect(accepted.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  expect(accepted.headers.get('Access-Control-Allow-Methods')).toBe('POST');
  expect(accepted.headers.get('Access-Control-Allow-Headers')).toBe(
    'Content-Type',
  );
  expect(accepted.headers.get('Access-Control-Max-Age')).toBe('86400');
  const denied = await preflight('https://elsewhere.example');
  expect(denied.status).toBe(403);
  expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
});

test.each([undefined, 'null', 'https://elsewhere.example'])(
  'rejects a Markdown preview from Origin %s before using the API limiter',
  async (siteOrigin) => {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (siteOrigin !== undefined) headers.set('Origin', siteOrigin);
    const response = await request('preview', {
      method: 'POST',
      headers,
      body: JSON.stringify({ body: 'Hello' }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: 'origin_not_allowed' },
    });
    expect(apiLimit).not.toHaveBeenCalled();
  },
);

test.each([
  { label: 'blank Markdown', body: ' \n ', code: 'body_empty' },
  { label: 'a non-string body', body: 123, code: 'body_empty' },
  {
    label: 'more than 20,000 characters',
    body: '😀'.repeat(20_001),
    code: 'body_too_long',
  },
])('rejects a Markdown preview with $label', async ({ body, code }) => {
  const response = await post('preview', { body });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: { code } });
});

test('previews up to 20,000 characters of Markdown after trimming', async () => {
  const markdown = '😀'.repeat(20_000);
  const response = await post('preview', { body: ` \n ${markdown} \n ` });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ html: `<p>${markdown}</p>\n` });
});

test('rejects preview requests when the API rate limit is exceeded', async () => {
  apiLimit.mockResolvedValue({ success: false });
  const response = await post('preview', { body: 'Hello' });
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({ error: { code: 'rate_limited' } });
});

test('a new Pending Comment is not listed publicly', async () => {
  const response = await post('comments', submission);
  expect(response.status).toBe(201);
  const result = await response.json<SubmissionResponse>();
  expect(result.comment).toMatchObject({
    parentId: null,
    name: 'Ada',
    html: '<p><strong>Hello</strong></p>\n',
    status: 'pending',
  });
  expect(await verify.mock.calls[0][0].json()).toEqual({
    secret: 'test-secret',
    response: 'browser-token',
    remoteip: '203.0.113.12',
  });
  const publicList = await request('comments?page=/first', {
    headers: { Origin: origin },
  });
  expect(await publicList.json()).toMatchObject({ comments: [] });
});

test('emails the Admin once for a stored Pending Comment', async () => {
  const response = await post('comments', submission);
  expect(response.status).toBe(201);
  const { comment } = await response.json<SubmissionResponse>();
  expect(sendEmail).toHaveBeenCalledExactlyOnceWith({
    from: { name: 'edge-comments', email: 'notifications@example.test' },
    to: 'admin@example.test',
    subject: '[Blog] Pending: Ada on "First Page"',
    text: [
      'Site:      Blog',
      'Page:      First Page',
      '           https://blog.example:8443/first/',
      'Commenter: Ada <ada@example.test>',
      'Status:    pending',
      '',
      '**Hello**',
      '',
      `Moderate: https://comments.example.test/admin/comment/${comment.id}`,
    ].join('\n'),
  });
});

test('accepts the Comment and logs only the id and a safe error code when sending fails', async () => {
  sendEmail.mockImplementationOnce(() => {
    throw Object.assign(
      new Error(`Delivery error for ${submission.email}: ${submission.body}`),
      {
        code: 'E_DELIVERY_FAILED',
      },
    );
  });
  const log = vi.spyOn(console, 'log');
  try {
    const response = await post('comments', submission);
    expect(response.status).toBe(201);
    const { comment } = await response.json<SubmissionResponse>();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const failures = log.mock.calls
      .flat()
      .filter(
        (entry: unknown) =>
          typeof entry === 'string' && entry.includes('comment_email_failed'),
      );
    expect(failures).toEqual([
      JSON.stringify({
        event: 'comment_email_failed',
        commentId: comment.id,
        error: 'E_DELIVERY_FAILED',
      }),
    ]);
  } finally {
    log.mockRestore();
  }
});

test('checks the Origin before using the submission limiter', async () => {
  submitLimit.mockResolvedValue({ success: false });
  const response = await post(
    'comments',
    { website: 'filled' },
    'https://elsewhere.example',
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: { code: 'origin_not_allowed' },
  });
  expect(submitLimit).not.toHaveBeenCalled();
  expect(verify).not.toHaveBeenCalled();
});

test('returns 429 before checking the honeypot', async () => {
  submitLimit.mockResolvedValue({ success: false });
  const response = await post('comments', { website: 'filled' });
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({ error: { code: 'rate_limited' } });
  expect(submitLimit).toHaveBeenCalledExactlyOnceWith({ key: '203.0.113.12' });
  expect(apiLimit).not.toHaveBeenCalled();
  expect(verify).not.toHaveBeenCalled();
});

test('returns a plausible Pending Comment from the honeypot without verifying or persisting it', async () => {
  const response = await post('comments', {
    ...submission,
    email: 'invalid',
    website: 'bot.example',
  });
  expect(response.status).toBe(201);
  const result = await response.json<SubmissionResponse>();
  expect(result.comment.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(result.comment).toMatchObject({
    status: 'pending',
    name: 'Ada',
    html: '<p><strong>Hello</strong></p>\n',
  });
  expect(verify).not.toHaveBeenCalled();
  expect(sendEmail).not.toHaveBeenCalled();
});

test.each([
  [{ name: '  ', email: 'invalid', body: '' }, 'invalid_name', 400],
  [{ name: 'a'.repeat(101) }, 'invalid_name', 400],
  [{ email: 'invalid', body: '', parentId: 'missing' }, 'invalid_email', 400],
  [{ email: 'a'.repeat(250) + '@example.test' }, 'invalid_email', 400],
  [{ body: ' \n ', parentId: 'missing' }, 'body_empty', 400],
  [{ body: '😀'.repeat(20_001) }, 'body_too_long', 400],
  [{ page: 'a'.repeat(501) }, 'not_found', 404],
  [{ parentId: 'missing', url: otherOrigin }, 'parent_invalid', 400],
  [{ url: otherOrigin }, 'origin_not_allowed', 403],
])('rejects invalid submissions with %s', async (overrides, code, status) => {
  const response = await post('comments', { ...submission, ...overrides });
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: { code } });
  expect(verify).not.toHaveBeenCalled();
});

test.each([
  { success: true, hostname: 'other.example' },
  { success: false, hostname: 'blog.example' },
  { success: true },
])('requires Siteverify to succeed on the current hostname', async (result) => {
  verify.mockResolvedValueOnce(HttpResponse.json(result));
  const response = await post('comments', submission);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: { code: 'turnstile_failed' },
  });
  expect(verify).toHaveBeenCalledTimes(1);
});

test.each(['comments', 'preview', 'unknown'])(
  'requires JSON for POST /api/%s',
  async (path) => {
    const response = await request(path, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'text/plain' },
      body: JSON.stringify(submission),
    });
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({
      error: { code: 'unsupported_media_type' },
    });
    expect(verify).not.toHaveBeenCalled();
  },
);

async function publishParent() {
  verify.mockResolvedValueOnce(
    HttpResponse.json({ success: true, hostname: 'other.example' }),
  );
  const response = await post(
    'comments',
    {
      ...submission,
      page: '/Explicit//?q=1',
      pageType: 'explicit',
      url: otherOrigin + '/parent',
    },
    otherOrigin,
  );
  expect(response.status).toBe(201);
  const result = await response.json<SubmissionResponse>();
  expect(result.comment.status).toBe('published');
  return result.comment.id;
}

test('publishes immediately and refreshes the same explicit Page when a valid reply is posted', async () => {
  const id = await publishParent();
  expect(sendEmail).toHaveBeenCalledTimes(1);
  verify.mockResolvedValueOnce(
    HttpResponse.json({ success: true, hostname: 'other.example' }),
  );
  const response = await post(
    'comments',
    {
      ...submission,
      page: ' /Explicit//?q=1 ',
      pageType: 'explicit',
      url: otherOrigin + '/' + 'x'.repeat(2_100) + '?removed=yes',
      title: 'y'.repeat(320),
      parentId: id,
      body: 'Reply',
    },
    otherOrigin,
  );
  expect(response.status).toBe(201);
  const result = await response.json<SubmissionResponse>();
  expect(result.comment).toMatchObject({ parentId: id, status: 'published' });
  expect(sendEmail).toHaveBeenCalledTimes(2);
  const replyEmail = sendEmail.mock.calls[1][0];
  expect(replyEmail).toMatchObject({
    to: 'admin@example.test',
    subject: `[Other] New: Ada on "${'y'.repeat(79)}…"`,
  });
  expect(replyEmail.text).toContain('In reply to Ada: "**Hello**"\n\nReply\n');
  const query = new URLSearchParams({
    page: '/Explicit//?q=1',
    pageType: 'explicit',
  });
  const publicList = await request('comments?' + query.toString(), {
    headers: { Origin: otherOrigin },
  });
  const listed = await publicList.json<CommentsResponse>();
  expect(listed.comments.map(({ id, parentId }) => ({ id, parentId }))).toEqual(
    [
      { id, parentId: null },
      { id: result.comment.id, parentId: id },
    ],
  );
  const records = await env.DB.prepare(
    'SELECT key, url, title FROM page WHERE site_id = ?',
  )
    .bind(otherSiteId)
    .all();
  expect(records.results).toEqual([
    {
      key: '/Explicit//?q=1',
      url: (otherOrigin + '/' + 'x'.repeat(2_100)).slice(0, 2_000),
      title: 'y'.repeat(300),
    },
  ]);
});

test('refuses a parent on another Page or Site, or a parent that is pending or rejected', async () => {
  const id = await publishParent();
  verify.mockClear();
  const reply = { ...submission, parentId: id };
  const page = { page: '/Explicit//?q=1', pageType: 'explicit' };
  for (const attempt of [
    () => post('comments', reply, otherOrigin),
    () => post('comments', { ...reply, ...page }),
  ]) {
    const response = await attempt();
    expect(await response.json()).toEqual({
      error: { code: 'parent_invalid' },
    });
  }
  for (const status of ['pending', 'rejected']) {
    await env.DB.prepare('UPDATE comment SET status = ? WHERE id = ?')
      .bind(status, id)
      .run();
    const response = await post('comments', { ...reply, ...page }, otherOrigin);
    expect(await response.json()).toEqual({
      error: { code: 'parent_invalid' },
    });
  }
  expect(verify).not.toHaveBeenCalled();
});

test.each([
  "UPDATE comment SET status = 'rejected' WHERE id = ?",
  "UPDATE page SET key = '/Rekeyed' WHERE id = (SELECT page_id FROM comment WHERE id = ?)",
])(
  'rechecks a published parent in the write transaction after a concurrent Admin change',
  async (update) => {
    const id = await publishParent();
    verify.mockImplementationOnce(async () => {
      await env.DB.prepare(update).bind(id).run();
      return HttpResponse.json({ success: true, hostname: 'other.example' });
    });
    const response = await post(
      'comments',
      {
        ...submission,
        page: '/Explicit//?q=1',
        pageType: 'explicit',
        url: otherOrigin + '/stale',
        parentId: id,
      },
      otherOrigin,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: 'parent_invalid' },
    });
    const pages = await env.DB.prepare('SELECT url FROM page').all();
    expect(pages.results).toEqual([{ url: otherOrigin + '/parent' }]);
  },
);
