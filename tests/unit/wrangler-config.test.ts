import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, test } from 'vitest';

// Cloudflare numbers weekdays 1 = Sunday to 7 = Saturday and rejects 0 at deploy time.
const weekday = /^(?:\*|[1-7]|sun|mon|tue|wed|thu|fri|sat)$/i;

function exampleCrons(): string[] {
  const path = 'wrangler.example.jsonc';
  const result = ts.parseConfigFileTextToJson(path, readFileSync(path, 'utf8'));
  if (result.error) throw new Error(`${path} is not valid JSONC.`);
  const config: unknown = result.config;
  return (config as { triggers?: { crons?: string[] } }).triggers?.crons ?? [];
}

test('every cron in the example config uses a weekday Cloudflare accepts', () => {
  const crons = exampleCrons();
  expect(crons).not.toHaveLength(0);
  for (const cron of crons) {
    const fields = cron.trim().split(/\s+/);
    expect(fields, cron).toHaveLength(5);
    for (const part of (fields[4] ?? '').split(/[,-]/))
      expect(part, cron).toMatch(weekday);
  }
});
