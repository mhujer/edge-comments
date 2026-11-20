import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

const e2e = process.argv.includes('--e2e');
const seedIndex = process.argv.indexOf('--seed');
const seed = seedIndex === -1 ? 'dev/seed.sql' : process.argv[seedIndex + 1];
const config =
  !e2e && existsSync('wrangler.jsonc')
    ? 'wrangler.jsonc'
    : 'wrangler.example.jsonc';
const state = e2e
  ? await mkdtemp(join(tmpdir(), 'edge-comments-e2e-'))
  : undefined;
const configArgs = [
  '--config',
  config,
  ...(state ? ['--persist-to', state] : []),
];
// Wrangler filters the bypass out of .dev.vars because production does not
// declare it. Forward an explicit opt-in to the local dev entry point.
const localBypass =
  !e2e && existsSync('.dev.vars')
    ? parseEnv(await readFile('.dev.vars', 'utf8')).ADMIN_AUTH_BYPASS === '1'
    : false;

function start(...args) {
  return spawn(process.execPath, args, { stdio: 'inherit' });
}

async function run(...args) {
  const [code] = await once(start(...args), 'exit');
  if (code !== 0) throw new Error(`${args.join(' ')} failed (${code})`);
}

const wrangler = 'node_modules/wrangler/bin/wrangler.js';
try {
  await run(
    wrangler,
    'd1',
    'migrations',
    'apply',
    'DB',
    '--local',
    ...configArgs,
  );
  await run(
    wrangler,
    'd1',
    'execute',
    'DB',
    '--local',
    '--file',
    seed,
    ...configArgs,
  );
  await run('scripts/build-widget.mjs');
  const children = [
    start(
      wrangler,
      'dev',
      'src/worker/local-dev.ts',
      ...configArgs,
      '--infer-origin-from-routes=false',
      '--ip',
      e2e ? '127.0.0.1' : '0.0.0.0',
      '--port',
      e2e ? '8790' : '8787',
      ...(localBypass ? ['--var', 'ADMIN_AUTH_BYPASS:1'] : []),
      '--var',
      'TURNSTILE_SITE_KEY:1x00000000000000000000AA',
      '--var',
      'TURNSTILE_SECRET:1x0000000000000000000000000000000AA',
      ...(e2e ? ['--var', 'PLAYWRIGHT_RUN:1'] : []),
    ),
  ];
  if (!e2e) {
    children.push(
      start('scripts/build-widget.mjs', '--watch'),
      start('scripts/dev-host.mjs'),
    );
  }

  function stop() {
    for (const child of children) child.kill('SIGTERM');
  }

  const exits = children.map((child) => once(child, 'exit'));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const [code] = await Promise.race(exits);
  stop();
  await Promise.all(exits);
  process.exitCode = code ?? 0;
} finally {
  if (state) await rm(state, { recursive: true, force: true });
}
