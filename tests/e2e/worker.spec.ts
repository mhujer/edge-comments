import { expect, test, type Page } from '@playwright/test';
test('Chromium receives the Worker JSON error', async ({ page }) => {
  const response = await page.goto('/unknown');
  expect(response?.status()).toBe(404);
  await expect(page.locator('body')).toContainText('"not_found"');
  expect(response?.headers()['strict-transport-security']).toBe(
    'max-age=31536000',
  );
});
test('widget is served with the asset headers', async ({ request }) => {
  const response = await request.get('/widget.js');
  expect(response.ok()).toBe(true);
  expect(response.headers()['strict-transport-security']).toBe(
    'max-age=31536000',
  );
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['cache-control']).toBe('max-age=300');
  expect(response.headers()['cross-origin-resource-policy']).toBe(
    'cross-origin',
  );
});

test('renders the seeded Threads and navigates to the original parent of a deep reply', async ({
  page,
}) => {
  await page.goto('http://localhost:8791/');
  const widget = page.locator('#edge-comments');
  await expect(
    widget.getByRole('heading', { name: '6 comments' }),
  ).toBeVisible();
  await expect(widget.locator('.edge-comments-thread')).toHaveCount(2);
  await expect(widget.locator('.edge-comments-thread').first()).toContainText(
    'Recent Thread',
  );
  await expect(widget.getByText('Comment removed')).toBeVisible();
  const target = widget
    .locator('.edge-comments-comment')
    .filter({ hasText: 'Third-level reply' });
  await widget.getByRole('button', { name: '↪ in reply to Robin' }).click();
  await expect(target).toHaveClass(/edge-comments-highlighted/);
  await expect(target).toBeInViewport();
});

test('renders the widget and applies its stylesheet under a strict host CSP', async ({
  page,
}) => {
  const response = await page.goto('http://localhost:8791/strict.html');
  const csp = response?.headers()['content-security-policy'];
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("connect-src 'self' http://localhost:8790");
  expect(csp).not.toContain('style-src');

  const widget = page.locator('#edge-comments');
  await expect(
    widget.getByRole('heading', { name: '6 komentářů' }),
  ).toBeVisible();
  await expect(widget.getByText('Komentář odstraněn')).toBeVisible();
  await expect(widget.locator('pre')).toHaveCSS('overflow-x', 'auto');
  await expect(widget.locator('.edge-comments-body a')).toHaveCSS(
    'overflow-wrap',
    'anywhere',
  );
  await expect(page.locator('style')).toHaveCount(0);
});

test('shows a neutral loading state until the Site language and Comments arrive', async ({
  page,
}) => {
  const gate = Promise.withResolvers<void>();
  await page.route('**/api/comments?*', async (route) => {
    await gate.promise;
    await route.continue();
  });
  await page.goto('http://localhost:8791/', { waitUntil: 'domcontentloaded' });
  const widget = page.locator('#edge-comments');
  try {
    await expect(widget).toHaveAttribute('aria-busy', 'true');
    await expect(widget).toBeEmpty();
  } finally {
    gate.resolve();
  }
  await expect(
    widget.getByRole('heading', { name: '6 comments' }),
  ).toBeVisible();
  await expect(widget).not.toHaveAttribute('aria-busy');
});

for (const { path, labels } of [
  {
    path: '/',
    labels: {
      comment: 'Comment',
      name: 'Name',
      email: /Email/,
      reply: '↩ Reply',
      replying: '↩ Replying to Robin',
      post: 'Post',
      pending: 'Awaiting approval',
      cancel: '✕ Cancel',
      write: 'Write',
      preview: 'Preview',
      hint: /fenced block/,
      emptyComment: 'Write a comment.',
    },
  },
  {
    path: '/strict.html',
    labels: {
      comment: 'Komentář',
      name: 'Jméno',
      email: /E-mail/,
      reply: '↩ Odpovědět',
      replying: '↩ Odpověď pro Robin',
      post: 'Odeslat',
      pending: 'Čeká na schválení',
      cancel: '✕ Zrušit',
      write: 'Napsat',
      preview: 'Náhled',
      hint: /blok kódu/,
      emptyComment: 'Napište komentář.',
    },
  },
]) {
  test(`previews Markdown in both forms on ${path}`, async ({ page }) => {
    await page.route(
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
      (route) =>
        route.fulfill({
          contentType: 'application/javascript',
          body: 'window.turnstile = { render: () => "preview-test" };',
        }),
    );
    let previewRequests = 0;
    page.on('request', (request) => {
      if (
        request.url().endsWith('/api/preview') &&
        request.method() === 'POST'
      ) {
        previewRequests++;
      }
    });
    await page.goto('http://localhost:8791' + path);
    const widget = page.locator('#edge-comments');
    const top = widget.locator('form').first();
    const parent = widget
      .locator('.edge-comments-depth-3')
      .filter({ hasText: 'Third-level reply' });
    const markdown = '`rendered code`\n\nhttps://example.test/preview';
    for (const [index, form] of [top, parent.locator('form')].entries()) {
      if (index === 1) {
        await parent
          .getByRole('button', { name: labels.reply, exact: true })
          .click();
      }
      const editor = form.getByRole('textbox', {
        name: labels.comment,
        exact: true,
      });
      const write = form.getByRole('button', { name: labels.write });
      const preview = form.getByRole('button', { name: labels.preview });
      await expect(form.getByText(labels.hint)).toBeVisible();
      await expect(write).toHaveAttribute('aria-pressed', 'true');
      await preview.click();
      await expect(form.getByRole('alert')).toHaveText(labels.emptyComment);
      expect(previewRequests).toBe(index);
      await editor.fill(markdown);
      await expect(form.locator('code')).toHaveCount(0);
      expect(previewRequests).toBe(index);
      await preview.click();
      await expect(form.locator('code')).toHaveText('rendered code');
      await expect(
        form.getByRole('link', { name: 'https://example.test/preview' }),
      ).toHaveAttribute('href', 'https://example.test/preview');
      await expect(preview).toHaveAttribute('aria-pressed', 'true');
      await expect(editor).toBeHidden();
      await expect(
        form.getByRole('button', { name: labels.post }),
      ).toBeDisabled();
      await write.click();
      await expect(editor).toHaveValue(markdown);
      await expect(form.getByRole('link')).toHaveCount(0);
    }
    expect(previewRequests).toBe(2);
  });

  test(`posts Pending Comments and replies on ${path}`, async ({ page }) => {
    const scripts: string[] = [];
    await stubTurnstile(page);
    page.on('request', (request) => {
      if (request.url().includes('/turnstile/v0/api.js')) {
        scripts.push(request.url());
      }
    });
    await page.goto('http://localhost:8791' + path);
    const widget = page.locator('#edge-comments');
    const top = widget.locator('form').first();
    const post = top.getByRole('button', { name: labels.post });
    await expect(post).toBeDisabled();
    expect(scripts).toEqual([]);

    const firstBody = `Pending root on ${path}`;
    await top.getByLabel(labels.name, { exact: true }).fill('Browser Ada');
    await top.getByLabel(labels.email).fill('browser@example.test');
    await top.getByLabel(labels.comment, { exact: true }).fill(firstBody);
    await expect(post).toBeEnabled({ timeout: 20_000 });
    await post.click();
    const pendingRoot = widget.locator('.edge-comments-comment').filter({
      hasText: firstBody,
    });
    await expect(pendingRoot.getByText(labels.pending)).toBeVisible();
    await expect(
      pendingRoot.getByRole('button', { name: labels.reply }),
    ).toHaveCount(0);

    const parent = widget
      .locator('.edge-comments-depth-3')
      .filter({ hasText: 'Third-level reply' });
    const reply = parent.getByRole('button', {
      name: labels.reply,
      exact: true,
    });
    await reply.click();
    const inline = parent.locator('form');
    await expect(inline.getByText(labels.replying)).toBeVisible();
    await expect(
      inline.getByRole('button', { name: labels.cancel }),
    ).toBeVisible();
    await expect(inline.getByLabel(labels.name, { exact: true })).toHaveValue(
      'Browser Ada',
    );
    await expect(inline.getByLabel(labels.email)).toHaveValue(
      'browser@example.test',
    );
    const replyBody = `Pending reply on ${path}`;
    await inline.getByLabel(labels.comment, { exact: true }).fill(replyBody);
    const replyPost = inline.getByRole('button', { name: labels.post });
    await expect(replyPost).toBeEnabled({ timeout: 20_000 });
    await replyPost.click();
    const pendingReply = widget
      .locator('.edge-comments-depth-3 > .edge-comments-comment')
      .filter({
        hasText: replyBody,
      });
    await expect(pendingReply.getByText(labels.pending)).toBeVisible();
    expect(scripts).toEqual([
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    ]);

    await page.reload();
    await expect(
      widget.locator('form').first().getByLabel(labels.name, { exact: true }),
    ).toHaveValue('Browser Ada');
  });
}

async function stubTurnstile(page: Page) {
  await page.route(
    'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    async (route) => {
      await route.fulfill({
        contentType: 'application/javascript',
        body: `
        (() => {
          const callbacks = new Map();
          let nextId = 0;
          const complete = (id) => queueMicrotask(() => callbacks.get(id)?.('XXXX.DUMMY.TOKEN.XXXX'));
          window.turnstile = {
            render(container, options) {
              if (!container.isConnected || options.sitekey !== '1x00000000000000000000AA') throw new Error('Invalid Turnstile configuration');
              const id = String(nextId++);
              callbacks.set(id, options.callback);
              complete(id);
              return id;
            },
            reset: complete,
            remove(id) { callbacks.delete(id); },
          };
        })();
      `,
      });
    },
  );
}

test('approves a Pending Comment from the Admin inbox and shows it published on the host', async ({
  page,
}, testInfo) => {
  await stubTurnstile(page);
  await page.goto(`http://localhost:8791/moderation/${testInfo.retry}`);
  const widget = page.locator('#edge-comments');
  const form = widget.locator('form').first();
  const firstBody = 'Browser Comment for Admin approval';
  await form.getByLabel('Name', { exact: true }).fill('Browser Ada');
  await form.getByLabel('Comment', { exact: true }).fill(firstBody);
  await form.getByRole('button', { name: 'Post' }).click();
  const pendingRoot = widget
    .locator('.edge-comments-comment')
    .filter({ hasText: firstBody });
  await expect(pendingRoot.getByText('Awaiting approval')).toBeVisible();
  const admin = await page.context().newPage();
  await admin.goto('http://localhost:8790/admin');
  await expect(admin.getByRole('heading', { name: 'Pending' })).toBeVisible();
  const card = admin.getByRole('article').filter({ hasText: firstBody });
  await expect(card).toHaveCSS('border-left-width', '4px');
  await expect(admin.locator('script, style')).toHaveCount(0);
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(admin.getByRole('status')).toHaveText('Comment approved.');
  await expect(
    admin.getByRole('status').getByRole('link', { name: 'Comment' }),
  ).toHaveAttribute('href', /^\/admin\/comment\//);
  await expect(card).toHaveCount(0);
  await admin.close();

  await page.reload();
  await expect(pendingRoot.getByText(firstBody)).toBeVisible();
  await expect(pendingRoot.getByText('Awaiting approval')).toHaveCount(0);
  await expect(
    pendingRoot.getByRole('button', { name: '↩ Reply' }),
  ).toBeVisible();
});
