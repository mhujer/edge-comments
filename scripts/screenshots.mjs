// Regenerates the README screenshots in docs/screenshots/ from
// dev/screenshot-seed.sql. Uses the E2E ports and a fresh local D1 database.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const workerOrigin = 'http://localhost:8790';
const hostOrigin = 'http://localhost:8791';
const outDir = 'docs/screenshots';

const turnstileStub = `
(() => {
  window.turnstile = {
    render(container, options) {
      queueMicrotask(() => options.callback('XXXX.DUMMY.TOKEN.XXXX'));
      return '0';
    },
    reset() {},
    remove() {},
  };
})();
`;

function start(...args) {
  return spawn(process.execPath, args, {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} did not start`);
}

const servers = [
  start('scripts/dev.mjs', '--e2e', '--seed', 'dev/screenshot-seed.sql'),
  start('scripts/dev-host.mjs', '--e2e'),
];
const browser = await chromium.launch();
try {
  await Promise.all([
    waitFor(`${workerOrigin}/widget.js`),
    waitFor(`${hostOrigin}/`),
  ]);
  await mkdir(outDir, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 760, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.route(
    'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: turnstileStub,
      }),
  );

  await page.goto(`${hostOrigin}/`);
  const widget = page.locator('#edge-comments');
  await widget.getByText('Nice, that covers my case.').waitFor();
  await widget.screenshot({ path: `${outDir}/widget-thread.png` });

  const form = widget.locator('form').first();
  await form.getByLabel('Name', { exact: true }).fill('Hana Novak');
  await form
    .getByLabel('Comment', { exact: true })
    .fill(
      'Comments now load in **under 20 KB**.\n\n> No more trackers\n\nSee `widget.js` for the embed.',
    );
  await form.getByRole('button', { name: 'Preview' }).click();
  await form.locator('.edge-comments-preview blockquote').waitFor();
  await form.screenshot({ path: `${outDir}/comment-form-preview.png` });

  await page.setViewportSize({ width: 1200, height: 600 });
  await page.goto(`${workerOrigin}/admin`);
  await page.getByRole('heading', { name: 'Pending' }).waitFor();
  // The widget needs the local host origin; show a public-looking one instead.
  await page.evaluate((origin) => {
    for (const label of document.querySelectorAll('small')) {
      label.textContent = label.textContent.replace(
        origin,
        'https://blog.example.com',
      );
    }
  }, hostOrigin);
  await page.screenshot({
    path: `${outDir}/admin-moderation.png`,
    fullPage: true,
  });
  console.log(`Screenshots written to ${outDir}/`);
} finally {
  await browser.close();
  const running = servers.filter((server) => server.exitCode === null);
  for (const server of running) server.kill('SIGTERM');
  await Promise.all(running.map((server) => once(server, 'exit')));
}
