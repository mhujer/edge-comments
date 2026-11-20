import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export type D1Target = 'local' | 'remote';
export type D1Query = <Row>(sql: string) => Promise<Row[]>;

/** Arguments that run `wrangler d1 execute DB` against the target with Node. */
export function d1Args(target: D1Target) {
  const config =
    process.env.WRANGLER_CONFIG ??
    (existsSync('wrangler.jsonc')
      ? 'wrangler.jsonc'
      : 'wrangler.example.jsonc');
  const persistTo = process.env.WRANGLER_PERSIST_TO;
  return [
    'node_modules/wrangler/bin/wrangler.js',
    'd1',
    'execute',
    'DB',
    `--${target}`,
    '--config',
    config,
    ...(target === 'local' && persistTo ? ['--persist-to', persistTo] : []),
  ];
}

export function d1Query(args: string[]): D1Query {
  return <Row>(sql: string) => {
    const result = spawnSync(
      process.execPath,
      [...args, '--json', '--command', sql],
      {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(result.stderr.trim() || 'D1 query failed.');
    const [response] = JSON.parse(result.stdout) as {
      success: boolean;
      results: Row[];
    }[];
    if (!response?.success) throw new Error('D1 query failed.');
    return Promise.resolve(response.results);
  };
}

/** Applies a SQL file, streaming Wrangler's output to the terminal. */
export function d1ApplyFile(args: string[], file: string) {
  const result = spawnSync(
    process.execPath,
    [...args, '--file', file, '--yes'],
    {
      stdio: 'inherit',
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('D1 apply failed.');
}
