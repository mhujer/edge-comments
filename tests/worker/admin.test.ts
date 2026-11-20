import { createExecutionContext, SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { importJWK, SignJWT, type JWTPayload } from 'jose';
import { getResponse, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { COMMENT_RENDERER_VERSION } from '../../src/shared/comment-renderer';
import worker from '../../src/worker';
import accessKeys from '../fixtures/access-test-keys.json';
import { seedSyntheticDeployment } from '../fixtures/synthetic-deployment';

const origin = 'https://comments.example.com';
const issuer = 'https://test-team.cloudflareaccess.com';
const audience = 'test-audience';
const adminEmail = 'admin@example.com';
const routes = [
  '/admin',
  '/admin/',
  '/admin/published',
  '/admin/rejected',
  '/admin/sites',
  '/admin/tools',
  '/admin/tools/export',
  '/admin/comment/missing',
  '/admin/comment/missing/delete',
  '/admin/admin.css',
  '/admin/unknown',
];

beforeEach(() => {
  vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
    const response = await getResponse(
      [
        http.get(issuer + '/cdn-cgi/access/certs', () =>
          HttpResponse.json({ keys: [accessKeys.publicKey] }),
        ),
      ],
      new Request(input, init),
    );
    if (!response) throw new Error('Unexpected outbound request');
    return response;
  });
});

afterEach(() => vi.unstubAllGlobals());

async function sign(claims: JWTPayload = {}) {
  const key = await importJWK(accessKeys.privateKey, 'RS256');
  return new SignJWT({
    exp: Math.floor(Date.now() / 1000) + 600,
    aud: audience,
    iss: issuer,
    email: adminEmail,
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: accessKeys.privateKey.kid })
    .sign(key);
}

function request(
  path: string,
  {
    token,
    base = origin,
    bypass,
    init,
    db = env.DB,
    backups = env.BACKUPS,
  }: {
    token?: string;
    base?: string;
    bypass?: string;
    init?: RequestInit;
    db?: D1Database;
    backups?: R2Bucket;
  } = {},
) {
  const headers = new Headers(init?.headers);
  if (token) headers.set('Cf-Access-Jwt-Assertion', token);
  return worker.fetch(
    new Request(base + path, { ...init, headers }),
    {
      DB: db,
      BACKUPS: backups,
      ADMIN_EMAIL: adminEmail,
      EMAIL_FROM: 'comments@example.com',
      CUSTOM_DOMAIN: 'comments.example.com',
      ACCESS_TEAM_DOMAIN: 'test-team.cloudflareaccess.com',
      ACCESS_AUD: audience,
      ...(bypass ? { ADMIN_AUTH_BYPASS: bypass } : {}),
      EMAIL: { send: vi.fn() },
      RL_API: { limit: vi.fn() },
      RL_SUBMIT: { limit: vi.fn() },
      TURNSTILE_SECRET: 'test',
      TURNSTILE_SITE_KEY: 'test',
    },
    createExecutionContext(),
  );
}

test('guards the admin routes and deployed stylesheet without an Access assertion', async () => {
  for (const route of routes) {
    expect((await request(route)).status, route).toBe(403);
  }
  const stylesheet = await SELF.fetch(origin + '/admin/admin.css');
  expect(stylesheet.status).toBe(403);
  expectAdminHeaders(stylesheet);
  const encodedPath = await SELF.fetch(origin + '/%61dmin/admin.css');
  expect([403, 404]).toContain(encodedPath.status);
});

test('rejects malformed, expired, incomplete and mismatched Access assertions', async () => {
  const now = Math.floor(Date.now() / 1000);
  const tokens = [
    'not-a-jwt',
    await sign({ exp: now - 61 }),
    await sign({ exp: undefined }),
    await sign({ aud: 'other-application' }),
    await sign({ iss: 'https://other-team.cloudflareaccess.com' }),
    await sign({ email: 'someone-else@example.com' }),
  ];
  for (const token of tokens) {
    for (const route of routes) {
      expect((await request(route, { token })).status, route).toBe(403);
    }
  }
});

test('matches the Access assertion email to the Admin case-insensitively', async () => {
  const token = await sign({ email: adminEmail.toUpperCase() });
  expect((await request('/admin', { token })).status).toBe(200);
});

test('accepts an Access assertion within the 60 second clock tolerance', async () => {
  const token = await sign({ exp: Math.floor(Date.now() / 1000) - 30 });
  expect((await request('/admin', { token })).status).toBe(200);
});

test('honours the enabled local bypass only on the two loopback hostnames', async () => {
  for (const base of ['http://localhost:8787', 'http://127.0.0.1:8787']) {
    expect((await request('/admin', { base, bypass: '1' })).status).toBe(200);
    expect((await request('/admin', { base, bypass: '0' })).status).toBe(403);
  }
  expect((await request('/admin', { bypass: '1' })).status).toBe(403);
  expect(
    (
      await request('/admin', {
        base: 'http://localhost.example.com',
        bypass: '1',
      })
    ).status,
  ).toBe(403);
});

test('requires the exact Origin and same-origin Fetch Metadata on admin POSTs', async () => {
  const token = await sign();
  for (const [requestOrigin, fetchSite, contentType] of [
    [
      'https://another.example',
      'same-origin',
      'application/x-www-form-urlencoded',
    ],
    [origin, 'same-site', 'application/x-www-form-urlencoded'],
    [origin, 'cross-site', 'application/json'],
    [origin, '', 'application/x-www-form-urlencoded'],
    ['', 'same-origin', 'application/x-www-form-urlencoded'],
  ]) {
    const response = await request('/admin/comment/missing/approve', {
      token,
      init: {
        method: 'POST',
        headers: {
          ...(requestOrigin ? { Origin: requestOrigin } : {}),
          ...(fetchSite ? { 'Sec-Fetch-Site': fetchSite } : {}),
          'Content-Type': contentType,
        },
      },
    });
    expect(response.status).toBe(403);
    expectAdminHeaders(response);
  }
});

test('returns the admin security headers on authenticated responses', async () => {
  expectAdminHeaders(await request('/admin', { token: await sign() }));
});

function expectAdminHeaders(response: Response) {
  expect(response.headers.get('Content-Security-Policy')).toBe(
    "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  expect(response.headers.get('Referrer-Policy')).toBe('same-origin');
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('Strict-Transport-Security')).toBe(
    'max-age=31536000',
  );
}

const siteId = '019a0000-0000-7000-8000-000000000001';
const pageId = '019a0000-0000-7000-8000-000000000002';
const parentId = '019a0000-0000-7000-8000-000000000003';
const replyId = '019a0000-0000-7000-8000-000000000004';
const createdAt = '2026-10-18T09:00:00.000Z';
const hostile = '<img src=x onerror="alert(1)">';

async function seedComments() {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO site (id, name, default_language, created_at, updated_at) VALUES (?, ?, 'en', ?, ?)",
    ).bind(siteId, 'Example Site', createdAt, createdAt),
    env.DB.prepare(
      "INSERT INTO site_origin (id, site_id, origin) VALUES ('019a0000-0000-7000-8000-0000000000a1', ?, ?)",
    ).bind(siteId, 'https://blog.example.com'),
    env.DB.prepare(
      'INSERT INTO page (id, site_id, key, title, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      pageId,
      siteId,
      '/article',
      hostile,
      'javascript:alert(1)',
      createdAt,
      createdAt,
    ),
    env.DB.prepare(
      `INSERT INTO comment (id, page_id, parent_id, status, commenter_name, commenter_email,
                            body_md, body_html, html_version, external_id, created_at, status_changed_at)
        VALUES (?, ?, NULL, 'pending', ?, ?, ?, ?, 0, 'disqus:123', ?, ?),
               (?, ?, ?, 'pending', 'Reply Name', NULL, 'Reply body', '<p>Reply body</p>', 1, NULL, ?, ?)`,
    ).bind(
      parentId,
      pageId,
      hostile,
      'name"><script>@example.test',
      hostile,
      '<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>',
      createdAt,
      createdAt,
      replyId,
      pageId,
      parentId,
      '2026-10-18T10:00:00.000Z',
      createdAt,
    ),
  ]);
}

test('Tools shows the current renderer version and disables re-rendering with no stale Comments', async () => {
  const response = await request('/admin/tools', { token: await sign() });
  expect(response.status).toBe(200);
  const tools = await response.text();
  expect(tools).toContain(
    `Current renderer version ${COMMENT_RENDERER_VERSION}`,
  );
  expect(tools).toContain('0 stale Comments');
  expect(tools).toMatch(
    /<button[^>]*\bdisabled[^>]*>Re-render all Comments<\/button>/,
  );
});

test('Tools offers an authenticated JSON download of the whole deployment', async () => {
  await seedComments();
  await env.DB.batch([
    env.DB.prepare("UPDATE comment SET status = 'rejected' WHERE id = ?").bind(
      parentId,
    ),
    env.DB.prepare("UPDATE comment SET status = 'published' WHERE id = ?").bind(
      replyId,
    ),
  ]);
  const token = await sign();
  const tools = await request('/admin/tools', { token });
  expect(await tools.text()).toContain(
    'href="/admin/tools/export">Export all Sites</a>',
  );
  const response = await request('/admin/tools/export', { token });
  expect(response.status).toBe(200);
  expectAdminHeaders(response);
  expect(response.headers.get('Content-Type')).toMatch(/^application\/json\b/);
  expect(response.headers.get('Content-Disposition')).toMatch(
    /^attachment; filename="edge-comments-\d{4}-\d{2}-\d{2}\.json"$/,
  );
  expect(await response.json()).toMatchObject({
    format: 'edge-comments-export',
    version: 1,
    sites: [
      {
        id: siteId,
        origins: ['https://blog.example.com'],
        pages: [
          {
            id: pageId,
            comments: [
              {
                id: parentId,
                status: 'rejected',
                commenter_email: 'name"><script>@example.test',
              },
              { id: replyId, parent_id: parentId, status: 'published' },
            ],
          },
        ],
      },
    ],
  });
  expect(await env.BACKUPS.list()).toMatchObject({ objects: [] });
  const stored = await env.DB.prepare('SELECT status FROM comment WHERE id = ?')
    .bind(parentId)
    .first();
  expect(stored).toEqual({ status: 'rejected' });
});

test('Tools reports never for an empty backup bucket and shows the latest backup upload time', async () => {
  const token = await sign();
  const tools = await request('/admin/tools', { token });
  expect(await tools.text()).toContain('Last R2 backup: never');

  await env.BACKUPS.put('backups/edge-comments-2026-01-04.json', '{}');
  const latest = await env.BACKUPS.put(
    'backups/edge-comments-2026-01-11.json',
    '{}',
  );
  if (!latest) throw new Error('Could not seed latest backup');
  await env.BACKUPS.put('backups/edge-comments-not-a-backup.txt', 'text');
  const updated = await request('/admin/tools', { token });
  const timestamp = latest.uploaded.toISOString();
  expect(await updated.text()).toContain(
    `Last R2 backup: <time datetime="${timestamp}">${timestamp}</time>`,
  );
});

test('Tools keeps export and re-render available when R2 listing fails', async () => {
  await seedComments();
  const token = await sign();
  const backups = new Proxy(env.BACKUPS, {
    get(target, key): unknown {
      if (key === 'list')
        return vi.fn().mockRejectedValue(new Error('R2 unavailable'));
      return Reflect.get(target, key);
    },
  });
  const response = await request('/admin/tools', { token, backups });
  expect(response.status).toBe(200);
  const tools = await response.text();
  expect(tools).toContain('Last R2 backup: unavailable');
  expect(tools).toContain('href="/admin/tools/export">Export all Sites</a>');
  expect(tools).toMatch(
    /<button class="approve" type="submit">Re-render all Comments<\/button>/,
  );
});

test('Tools re-renders stale Comments across multiple form submissions', async () => {
  await seedComments();
  const token = await sign();
  const batchPath = '/admin/tools/re-render';
  const extraStaleCount = 40;
  const insert = env.DB.prepare(
    `INSERT INTO comment (id, page_id, status, commenter_name, body_md, body_html,
                          html_version, created_at, status_changed_at)
      VALUES (?, ?, ?, 'Commenter', '**Markdown**', ?, ?, ?, ?)`,
  );
  const ids = Array.from(
    { length: extraStaleCount + 2 },
    (_, index) =>
      '019a0000-0000-7000-8000-' + String(10 + index).padStart(12, '0'),
  );
  const [currentId, futureId] = ids;
  const statuses = ['published', 'rejected', 'pending'];
  await env.DB.batch(
    ids.map((id, index) =>
      insert.bind(
        id,
        pageId,
        statuses[index % statuses.length],
        '<p>Stored HTML</p>',
        index < 2
          ? COMMENT_RENDERER_VERSION + index
          : COMMENT_RENDERER_VERSION - 1,
        createdAt,
        createdAt,
      ),
    ),
  );

  const get = async (path: string) => (await request(path, { token })).text();
  expect(await get('/admin/tools')).toContain(
    `${extraStaleCount + 2} stale Comments`,
  );
  expect(await get(parentPath)).toContain('rendered v0 (stale)');
  expect((await request(batchPath, { token })).status).toBe(404);

  let tools = await get(
    redirectLocation(await postAction(batchPath, token, {})),
  );
  const remaining = (html: string) =>
    Number(html.match(/(\d+) stale Comments?/)?.[1]);
  expect(remaining(tools)).toBeGreaterThan(0);
  expect(remaining(tools)).toBeLessThan(extraStaleCount + 2);
  while (remaining(tools) > 0) {
    expect(tools).toMatch(/<button[^>]*>Continue<\/button>/);
    const next = await get(
      redirectLocation(await postAction(batchPath, token, {})),
    );
    expect(remaining(next)).toBeLessThan(remaining(tools));
    tools = next;
  }

  expect(tools).toContain('0 stale Comments');
  expect(tools).toMatch(
    /<button[^>]*\bdisabled[^>]*>Re-render all Comments<\/button>/,
  );
  expect(await get(parentPath)).toContain(
    `rendered v${COMMENT_RENDERER_VERSION}</summary>`,
  );
  for (const id of ids.slice(2, 5)) {
    const detail = await get('/admin/comment/' + id);
    expect(detail).toContain('<p><strong>Markdown</strong></p>');
    expect(detail).not.toContain('(stale)');
  }
  for (const id of [currentId, futureId]) {
    const detail = await get('/admin/comment/' + id);
    expect(detail).toContain('<p>Stored HTML</p>');
    expect(detail).not.toContain('(stale)');
  }
});

test('a failed Tools batch rolls back earlier updates and can be retried', async () => {
  await seedComments();
  await env.DB.prepare(
    `CREATE TRIGGER fail_reply_render BEFORE UPDATE OF html_version ON comment
      WHEN old.id = '${replyId}'
      BEGIN
        SELECT RAISE(ABORT, 'test batch failure');
      END`,
  ).run();
  const token = await sign();
  const batchPath = '/admin/tools/re-render';
  const failure = await postAction(batchPath, token, {});
  expect(failure.status).toBe(500);
  const tools = await (await request('/admin/tools', { token })).text();
  expect(tools).toContain('2 stale Comments');
  expect(await (await request(parentPath, { token })).text()).toContain(
    'rendered v0 (stale)',
  );

  await env.DB.prepare('DROP TRIGGER fail_reply_render').run();
  const redirect = redirectLocation(await postAction(batchPath, token, {}));
  expect(await (await request(redirect, { token })).text()).toContain(
    '0 stale Comments',
  );
});

test('renders inert untrusted fields and shows parent and reply context', async () => {
  await seedComments();
  const token = await sign();
  const pending = await (await request('/admin', { token })).text();
  const detail = await (
    await request('/admin/comment/' + parentId, { token })
  ).text();
  for (const html of [pending, detail]) {
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(html).toContain(
      '<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>',
    );
    expect(html).toContain('name&quot;&gt;&lt;script&gt;@example.test');
    expect(html).not.toMatch(/<img\b|<script\b|href="javascript:/i);
  }
  expect(pending).toContain('Example Site');
  expect(pending).toContain('https://blog.example.com');
  expect(pending).toContain('↪ in reply to');
  expect(pending).toContain('imported');
  expect(pending.indexOf('Reply body')).toBeLessThan(
    pending.indexOf('>imported<'),
  );
  expect(detail).toContain('Markdown source');
  expect(detail).toContain('stale');
  expect(detail).toContain('Reply Name');
  expect(detail).toContain('/admin/comment/' + replyId);
  expect(detail).toContain('disqus:123');
  const missing = await request('/admin/comment/missing', { token });
  expect(missing.status).toBe(404);
  expect(await missing.text()).toContain('This Comment no longer exists.');
});

test('publishes and rejects Comments only through POST, with confirmation and a new status time', async () => {
  await seedComments();
  const token = await sign();
  const pending = await request('/admin/comment/' + parentId + '/approve', {
    token,
  });
  expect(pending.status).toBe(404);

  const log = vi.spyOn(console, 'log');
  try {
    for (const [id, action, status, from] of [
      [parentId, 'approve', 'approved', 'pending'],
      [replyId, 'reject', 'rejected', 'detail'],
    ]) {
      const commentUrl = '/admin/comment/' + id;
      const moderation = await request(commentUrl + '/' + action, {
        token,
        init: {
          method: 'POST',
          headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin' },
          body: new URLSearchParams({ from }),
        },
      });
      expect(moderation.status).toBe(303);
      const location = moderation.headers.get('Location');
      expect(location?.split('?')[0]).toBe(
        from === 'pending' ? '/admin' : commentUrl,
      );
      if (!location) throw new Error('Expected a redirect');
      const flash = await (await request(location, { token })).text();
      expect(flash).toContain(`<a href="${commentUrl}">Comment</a> ${status}.`);
      const detail = await (await request(commentUrl, { token })).text();
      const expected = status === 'approved' ? 'published' : 'rejected';
      expect(detail).toContain(`class="badge badge-${expected}"`);
      const changed = detail.match(
        /Status changed<\/dt><dd><time datetime="([^"]+)"/,
      );
      expect(changed?.[1]).toBeDefined();
      expect(Date.parse(changed?.[1] ?? '')).toBeGreaterThan(
        Date.parse(createdAt),
      );
      expect(log).toHaveBeenCalledWith(
        JSON.stringify({
          event: 'comment_moderated',
          commentId: id,
          action,
          status: expected,
        }),
      );
    }
    const pending = await (await request('/admin', { token })).text();
    expect(pending).toContain('No Pending Comments.');
  } finally {
    log.mockRestore();
  }
});

function commentIds(html: string) {
  return Array.from(
    html.matchAll(/href="\/admin\/comment\/([^"]+)">Details →/g),
    ([, id]) => id,
  );
}

function pageLink(html: string, label: '← Newer' | 'Older →') {
  const link = Array.from(html.matchAll(/href="([^"]+)">([^<]+)<\/a>/g)).find(
    ([, , text]) => text === label,
  )?.[1];
  if (!link) throw new Error('Expected a pagination link labelled ' + label);
  return link;
}

test.each([
  ['/admin', 'pending'],
  ['/admin/published', 'published'],
  ['/admin/rejected', 'rejected'],
])(
  'paginates %s in stable order when Comments share a timestamp',
  async (path, status) => {
    await seedComments();
    const ids = Array.from(
      { length: 107 },
      (_, index) =>
        '019a0000-0000-7000-9000-' + String(index).padStart(12, '0'),
    );
    await env.DB.batch([
      env.DB.prepare('DELETE FROM comment WHERE id = ?').bind(replyId),
      env.DB.prepare('DELETE FROM comment WHERE id = ?').bind(parentId),
      ...ids.map((id) =>
        env.DB.prepare(
          `INSERT INTO comment (id, page_id, status, commenter_name, body_md,
                              body_html, html_version, created_at, status_changed_at)
             VALUES (?, ?, ?, 'Name', 'Body', '<p>Body</p>', 1, ?, ?)`,
        ).bind(id, pageId, status, createdAt, createdAt),
      ),
    ]);

    const token = await sign();
    const first = await (await request(path, { token })).text();
    expect(first).not.toContain('← Newer');
    const older = pageLink(first, 'Older →');
    const olderUrl = new URL(older, origin);
    expect(olderUrl.pathname).toBe(path);
    expect(olderUrl.searchParams.get('before')).toBe(createdAt + ',' + ids[57]);
    const second = await (await request(older, { token })).text();
    const third = await (
      await request(pageLink(second, 'Older →'), { token })
    ).text();
    expect(commentIds(first).length).toBe(50);
    expect(commentIds(second).length).toBe(50);
    expect(commentIds(third).length).toBe(7);
    expect([
      ...commentIds(first),
      ...commentIds(second),
      ...commentIds(third),
    ]).toEqual(ids.toReversed());
    expect(pageLink(second, '← Newer')).toBe(path);
    expect(pageLink(third, '← Newer')).toBe(older);
    expect(third).not.toContain('Older →');
  },
);

function postAction(
  path: string,
  token: string,
  fields: Record<string, string>,
) {
  return Promise.resolve(
    request(path, {
      token,
      init: {
        method: 'POST',
        headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin' },
        body: new URLSearchParams(fields),
      },
    }),
  );
}

const before = createdAt.replace('09:00', '11:00') + ',' + parentId;
const replyPath = '/admin/comment/' + replyId;
const parentPath = '/admin/comment/' + parentId;

function redirectLocation(response: Response) {
  expect(response.status).toBe(303);
  const location = response.headers.get('Location');
  if (!location) throw new Error('Expected a redirect');
  return location;
}

test('preserves the tab and cursor when approving, rejecting or restoring from a list', async () => {
  await seedComments();
  const token = await sign();
  for (const [tab, from, id, action, flash, status] of [
    ['/admin', 'pending', parentId, 'approve', 'approved', 'published'],
    ['/admin', 'pending', replyId, 'reject', 'rejected', 'rejected'],
    [
      '/admin/published',
      'published',
      parentId,
      'reject',
      'rejected',
      'rejected',
    ],
    [
      '/admin/rejected',
      'rejected',
      parentId,
      'restore',
      'restored',
      'published',
    ],
  ]) {
    const url = tab + '?' + new URLSearchParams({ before }).toString();
    const html = await (await request(url, { token })).text();
    expect(html).toContain('name="from" value="' + from + '"');
    expect(html).toContain('name="before" value="' + before + '"');

    const path = '/admin/comment/' + id;
    expect(html).toContain('formaction="' + path + '/' + action + '"');
    const redirect = redirectLocation(
      await postAction(path + '/' + action, token, { from, before }),
    );
    const target = new URL(redirect, origin);
    expect(target.pathname).toBe(tab);
    expect(target.searchParams.get('before')).toBe(before);
    const updated = await (await request(redirect, { token })).text();
    expect(updated).toContain(
      '<a href="' + path + '">Comment</a> ' + flash + '.',
    );
    const detail = await (await request(path, { token })).text();
    expect(detail).toContain('class="badge badge-' + status + '"');
  }
});

test('requires a confirmation screen for rejected Comments and refuses deletion when there are replies', async () => {
  await seedComments();
  const token = await sign();

  const pendingDelete = await request(replyPath + '/delete', { token });
  expect(pendingDelete.status).toBe(409);
  const blockedDelete = await postAction(replyPath + '/delete', token, {
    from: 'detail',
  });
  expect(blockedDelete.status).toBe(409);

  for (const path of [parentPath, replyPath]) {
    redirectLocation(
      await postAction(path + '/reject', token, { from: 'detail' }),
    );
  }

  const rejectedList = await (
    await request(
      '/admin/rejected?' + new URLSearchParams({ before }).toString(),
      {
        token,
      },
    )
  ).text();
  expect(rejectedList).toMatch(
    /<button[^>]*disabled[^>]*>Delete permanently<\/button>/,
  );
  expect(rejectedList).toContain('Has 1 reply');
  expect(rejectedList).toContain('formaction="' + replyPath + '/delete"');
  expect(rejectedList).toContain('formmethod="get"');
  const parent = await (await request(parentPath, { token })).text();
  expect(parent).toContain('Has 1 reply');
  const refused = await postAction(parentPath + '/delete', token, {
    from: 'detail',
  });
  expect(refused.status).toBe(409);
  expect(await refused.text()).toContain('Has 1 reply');
  expect((await request(parentPath, { token })).status).toBe(200);

  const source = { from: 'rejected', before };
  const confirm = await request(
    replyPath + '/delete?' + new URLSearchParams(source).toString(),
    { token },
  );
  expect(confirm.status).toBe(200);
  const prompt = await confirm.text();
  expect(prompt).toContain('Delete Comment permanently?');
  expect(prompt).toContain('Reply Name');
  expect(prompt).toContain('method="post"');
  expect(prompt).toContain('name="before" value="' + before + '"');
  expect(prompt).toContain(
    '<a href="/admin/rejected?' +
      new URLSearchParams({ before }).toString() +
      '">Cancel</a>',
  );
  expect((await request(replyPath, { token })).status).toBe(200);

  const lateReplyId = '019a0000-0000-7000-8000-000000000005';
  await env.DB.prepare(
    `INSERT INTO comment (id, page_id, parent_id, status, commenter_name, body_md,
                          body_html, html_version, created_at, status_changed_at)
         VALUES (?, ?, ?, 'pending', 'New Reply', 'Body', '<p>Body</p>', 1, ?, ?)`,
  )
    .bind(lateReplyId, pageId, replyId, createdAt, createdAt)
    .run();
  const staleConfirmation = await postAction(
    replyPath + '/delete',
    token,
    source,
  );
  expect(staleConfirmation.status).toBe(409);
  expect(await staleConfirmation.text()).toContain('Has 1 reply');
  expect((await request(replyPath, { token })).status).toBe(200);
  await env.DB.prepare('DELETE FROM comment WHERE id = ?')
    .bind(lateReplyId)
    .run();

  const redirect = redirectLocation(
    await postAction(replyPath + '/delete', token, source),
  );
  const target = new URL(redirect, origin);
  expect(target.pathname).toBe('/admin/rejected');
  expect(target.searchParams.get('before')).toBe(before);
  const updated = await (await request(redirect, { token })).text();
  expect(updated).toContain('<a href="' + replyPath + '">Comment</a> deleted.');
  expect((await request(replyPath, { token })).status).toBe(404);
  const fromDetail = redirectLocation(
    await postAction(parentPath + '/delete', token, { from: 'detail' }),
  );
  expect(new URL(fromDetail, origin).pathname).toBe('/admin/rejected');
  expect((await request(parentPath, { token })).status).toBe(404);
});

test('reads at most 200 D1 rows per moderation page in a 5,000-Comment deployment', async () => {
  await seedSyntheticDeployment(env.DB);
  const token = await sign();
  let rowsRead = 0;

  function observe(statement: D1PreparedStatement): D1PreparedStatement {
    return new Proxy(statement, {
      get(target, method) {
        switch (method) {
          case 'bind':
            return (...values: unknown[]) => observe(target.bind(...values));
          case 'all':
            return async <T>() => {
              const result = await target.all<T>();
              rowsRead += result.meta.rows_read;
              return result;
            };
          default:
            throw new Error(
              'Could not measure D1 statement method ' + String(method),
            );
        }
      },
    });
  }
  const db = new Proxy(env.DB, {
    get(database, method) {
      if (method === 'prepare')
        return (sql: string) => observe(database.prepare(sql));
      throw new Error('Could not measure D1 database method ' + String(method));
    },
  });

  async function measure(path: string, expectedCards: number) {
    rowsRead = 0;
    const response = await request(path, { token, db });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(commentIds(html)).toHaveLength(expectedCards);
    expect(rowsRead, path).toBeGreaterThanOrEqual(expectedCards);
    expect(rowsRead, path).toBeLessThanOrEqual(200);
    console.info('D1 moderation list rows read', { path, rowsRead });
    return html;
  }

  await measure('/admin', 18);
  for (const path of ['/admin/published', '/admin/rejected']) {
    const first = await measure(path, 50);
    await measure(pageLink(first, 'Older →'), 50);
  }
});

test('creates and edits a Site with normalized Allowed origins and a Turnstile reminder', async () => {
  const token = await sign();
  const list = await (await request('/admin/sites', { token })).text();
  expect(list).toContain('<a href="/admin/sites/new">+ Add Site</a>');
  const form = await (await request('/admin/sites/new', { token })).text();
  expect(form).toContain('method="post"');
  expect(form).toContain('value="approve_first" checked');

  const fields = {
    name: ' My Site ',
    origins: ' https://BLOG.example.com/\nhttp://www.example.com:8080\n',
    moderationMode: 'approve_first',
    defaultLanguage: 'cs',
  };
  const location = redirectLocation(
    await postAction('/admin/sites/new', token, fields),
  );
  const sitePath = new URL(location, origin).pathname;
  const site = await (await request(location, { token })).text();
  expect(site).toContain('My Site');
  expect(site).toContain('https://blog.example.com');
  expect(site).toContain('http://www.example.com:8080');
  expect(site).toContain('re-run <code>./deploy.sh</code> to update Turnstile');
  expect(site).toContain(
    '&lt;div id=&quot;edge-comments&quot;&gt;&lt;/div&gt;',
  );
  expect(site).toContain('https://comments.example.com/widget.js');
  expect(site).toContain('<code>data-page-key=&quot;/path&quot;</code>');
  expect(site).toContain('Site’s default language (cs) on that page');

  const edited = redirectLocation(
    await postAction(sitePath, token, {
      name: 'Renamed Site',
      origins: 'https://blog.example.com',
      moderationMode: 'publish_immediately',
      defaultLanguage: 'en',
    }),
  );
  const saved = await (await request(edited, { token })).text();
  expect(saved).toContain('Renamed Site');
  expect(saved).not.toContain('http://www.example.com:8080');
  expect(saved).not.toContain('to update Turnstile');
  expect(saved).toContain('Site’s default language (en) on that page');
  const updatedList = await (await request('/admin/sites', { token })).text();
  expect(updatedList).toContain(`<a href="${sitePath}">Renamed Site</a>`);
  expect(updatedList).toContain(
    '<td>Publish immediately</td><td>en</td><td>0</td><td>0</td>',
  );
});

test('rejects malformed Allowed origins and rolls back a Site save with an origin conflict', async () => {
  await seedComments();
  const token = await sign();
  const fields = {
    name: 'Other Site',
    origins: 'https://other.example.com',
    moderationMode: 'approve_first',
    defaultLanguage: 'en',
  };
  for (const invalid of [
    'blog.example.com',
    'ftp://blog.example.com',
    'https://blog.example.com:',
    'https://blog.example.com/path',
    'https://blog.example.com//',
    'https://blog.example.com?',
    'https://blog.example.com#',
    'https://name@blog.example.com',
    'https://blog.example.com:65536',
  ]) {
    const response = await postAction('/admin/sites/new', token, {
      ...fields,
      origins: invalid,
    });
    expect(response.status, invalid).toBe(400);
    expect(await response.text()).toContain('invalid Allowed origin');
  }
  const location = redirectLocation(
    await postAction('/admin/sites/new', token, fields),
  );
  const sitePath = new URL(location, origin).pathname;
  const response = await postAction(sitePath, token, {
    ...fields,
    name: 'Name that should not be saved',
    origins: 'https://new.example.com\nhttps://BLOG.example.com:443/',
  });
  expect(response.status).toBe(409);
  expect(await response.text()).toContain(
    'https://blog.example.com already belongs to Example Site.',
  );
  const unchanged = await (await request(sitePath, { token })).text();
  expect(unchanged).toContain('Other Site');
  expect(unchanged).toContain('https://other.example.com');
  expect(unchanged).not.toContain('https://new.example.com');
  expect(unchanged).not.toContain('Name that should not be saved');
});

test('allows only one concurrent Site save to claim an Allowed origin', async () => {
  const token = await sign();
  const results = await Promise.all(
    ['First Site', 'Second Site'].map((name) =>
      postAction('/admin/sites/new', token, {
        name,
        origins: 'https://shared.example.test/',
        moderationMode: 'approve_first',
        defaultLanguage: 'en',
      }),
    ),
  );
  expect(results.map(({ status }) => status).sort()).toEqual([303, 409]);
  const accepted = results.find(({ status }) => status === 303)!;
  const refused = results.find(({ status }) => status === 409)!;
  const winner = accepted === results[0] ? 'First Site' : 'Second Site';
  const loser = winner === 'First Site' ? 'Second Site' : 'First Site';
  expect(await refused.text()).toContain('already belongs to ' + winner);
  const list = await (await request('/admin/sites', { token })).text();
  expect(list).toContain(winner);
  expect(list).not.toContain(loser);
});

function site(name: string, origins: string) {
  return {
    name,
    origins,
    moderationMode: 'approve_first',
    defaultLanguage: 'en',
  };
}

/** Allowed origins `https://h<n>.example.test`, one per line. */
function hosts(...numbers: number[]) {
  return numbers.map((number) => `https://h${number}.example.test`).join('\n');
}

test('caps the distinct Turnstile hostnames of all Allowed origins at 10', async () => {
  const token = await sign();
  const tooMany =
    'Turnstile allows at most 10 distinct hostnames across all Sites.';

  // Scheme and port variants of h1 share one hostname.
  const firstOrigins = `${hosts(1, 2, 3, 4, 5, 6, 7, 8)}\nhttp://h1.example.test:8080\nhttp://h1.example.test`;
  const first = new URL(
    redirectLocation(
      await postAction('/admin/sites/new', token, site('First', firstOrigins)),
    ),
    origin,
  ).pathname;
  const second = new URL(
    redirectLocation(
      await postAction(
        '/admin/sites/new',
        token,
        site('Second', `${hosts(9)}\nhttp://[::1]:8080`),
      ),
    ),
    origin,
  ).pathname;

  const refusedNew = await postAction(
    '/admin/sites/new',
    token,
    // A naive cut at the first ":" would read both IPv6 hostnames as "[".
    site('Third', 'http://[::2]'),
  );
  expect(refusedNew.status).toBe(409);
  expect(await refusedNew.text()).toContain(tooMany);
  const list = await (await request('/admin/sites', { token })).text();
  expect(list).not.toContain('Third');

  const refusedEdit = await postAction(
    second,
    token,
    site('Not saved', `${hosts(9, 11)}\nhttp://[::1]:8080`),
  );
  expect(refusedEdit.status).toBe(409);
  expect(await refusedEdit.text()).toContain(tooMany);
  const unchanged = await (await request(second, { token })).text();
  expect(unchanged).toContain('Second');
  expect(unchanged).not.toContain('Not saved');
  expect(unchanged).not.toContain('https://h11.example.test');

  // At 10 already: editing without new hostnames, or swapping one of the Site's own, still saves.
  redirectLocation(
    await postAction(
      second,
      token,
      site('Renamed', `${hosts(9)}\nhttp://[::1]:8080\nhttp://[::1]`),
    ),
  );
  redirectLocation(
    await postAction(
      first,
      token,
      site('First', hosts(1, 2, 3, 4, 5, 6, 7, 11)),
    ),
  );
  const saved = await (await request('/admin/sites', { token })).text();
  expect(saved).toContain('Renamed');
  expect(saved).toContain('https://h11.example.test');
  expect(saved).not.toContain('https://h8.example.test');
});

test('allows only one concurrent Site save to take the last Turnstile hostname', async () => {
  const token = await sign();
  const nine = hosts(1, 2, 3, 4, 5, 6, 7, 8, 9);
  redirectLocation(
    await postAction('/admin/sites/new', token, site('Existing', nine)),
  );
  const results = await Promise.all(
    ['First', 'Second'].map((name) =>
      postAction(
        '/admin/sites/new',
        token,
        site(`${name} Site`, `https://${name.toLowerCase()}.example.test`),
      ),
    ),
  );
  expect(results.map(({ status }) => status).sort()).toEqual([303, 409]);
  const list = await (await request('/admin/sites', { token })).text();
  expect(
    ['First Site', 'Second Site'].filter((name) => list.includes(name)),
  ).toHaveLength(1);
});

test('browses a Site’s Pages and shows each Page key read-only', async () => {
  await seedComments();
  const token = await sign();
  await env.DB.prepare('UPDATE page SET title = ?, url = ? WHERE id = ?')
    .bind('Article', 'https://blog.example.com/article', pageId)
    .run();
  redirectLocation(
    await postAction(parentPath + '/approve', token, { from: 'detail' }),
  );
  const site = await (
    await request('/admin/sites/' + siteId, { token })
  ).text();
  const pagePath = '/admin/page/' + pageId;
  expect(site).toContain(`<a href="${pagePath}">Article</a>`);
  expect(site).toContain('<td>1</td><td>1</td><td>0</td>');

  const page = await (await request(pagePath, { token })).text();
  expect(page).toContain('<h1>Article</h1>');
  expect(page).toContain('href="https://blog.example.com/article"');
  expect(page).toContain('<code>/article</code>');
  expect(page).not.toContain('method="post"');
  expect(page).toContain('badge-pending');
  expect(page).toContain('badge-published');
  expect(page).toContain('href="' + parentPath + '"');
  expect(page).toContain('href="' + replyPath + '"');

  const edit = await postAction(pagePath, token, { key: '/moved' });
  expect(edit.status).toBe(404);
  const unchanged = await (await request(pagePath, { token })).text();
  expect(unchanged).toContain('<code>/article</code>');
});

test('guards Site forms and uses POST for their changes', async () => {
  await seedComments();
  const token = await sign();
  for (const [path, fields] of [
    [
      '/admin/sites/new',
      {
        name: 'New Site',
        origins: '',
        moderationMode: 'approve_first',
        defaultLanguage: 'en',
      },
    ],
    [
      '/admin/sites/' + siteId,
      {
        name: 'Renamed Site',
        origins: '',
        moderationMode: 'approve_first',
        defaultLanguage: 'en',
      },
    ],
  ] as const) {
    expect((await request(path)).status, path).toBe(403);
    const body = new URLSearchParams(fields);
    const headers = { Origin: origin, 'Sec-Fetch-Site': 'same-origin' };
    expect(
      (await request(path, { init: { method: 'POST', headers, body } })).status,
    ).toBe(403);

    for (const mismatched of [
      { ...headers, Origin: 'https://other.example.test' },
      { ...headers, 'Sec-Fetch-Site': 'cross-site' },
    ]) {
      const res = await request(path, {
        token,
        init: { method: 'POST', headers: mismatched, body },
      });
      expect(res.status, path).toBe(403);
    }
    const get = await request(path + '?' + body.toString(), { token });
    expect(get.status).toBe(200);
    expect(await get.text()).toContain('action="' + path + '" method="post"');
  }

  const list = await (await request('/admin/sites', { token })).text();
  expect(list).toContain('Example Site');
  expect(list).not.toContain('New Site');
  expect(list).not.toContain('Renamed Site');
});
