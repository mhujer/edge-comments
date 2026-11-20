import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Usage: node scripts/run-cli.mjs <command> [args...], for src/cli/<command>-command.ts.
const [command, ...args] = process.argv.slice(2);
if (!command || !/^[a-z-]+$/.test(command)) {
  console.error('Usage: node scripts/run-cli.mjs <command> [args...]');
  process.exit(1);
}
process.argv = [process.argv[0], process.argv[1], ...args];

await mkdir('tmp', { recursive: true, mode: 0o700 });
const directory = await mkdtemp(`tmp/${command}-cli-`);
try {
  const outfile = resolve(directory, `${command}-command.mjs`);
  await build({
    entryPoints: [`src/cli/${command}-command.ts`],
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'node24',
    outfile,
  });
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(directory, { recursive: true, force: true });
}
