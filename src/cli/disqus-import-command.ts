import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { createId } from '../shared/identity';
import { d1ApplyFile, d1Args, d1Query } from './d1';
import {
  importSql,
  listImportSites,
  planDisqusImport,
  readImportState,
  verifyImport,
  type ImportQuery,
} from './disqus-import';

const usage =
  'Usage: npm run import:disqus -- <file> [--site <id>] [--target local|remote] [--apply]';

async function selectSite(query: ImportQuery): Promise<string> {
  if (!process.stdin.isTTY)
    throw new Error('--site is required when stdin is not a TTY.');
  const sites = await listImportSites(query);
  if (!sites.length)
    throw new Error('Create a Site before importing Comments.');
  for (const [index, site] of sites.entries()) {
    console.log(`${index + 1}. ${site.name} (${site.id})`);
  }
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = (await prompt.question('Select a Site by number: ')).trim();
    const site = /^\d+$/.test(answer) ? sites[Number(answer) - 1] : undefined;
    if (!site) throw new Error('Invalid Site selection.');
    return site.id;
  } finally {
    prompt.close();
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      site: { type: 'string' },
      target: { type: 'string', default: 'local' },
      apply: { type: 'boolean', default: false },
      help: { type: 'boolean' },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(usage);
    return;
  }

  const [file] = positionals;
  const { apply, site, target } = values;
  if (
    positionals.length !== 1 ||
    !file ||
    site === '' ||
    (target !== 'local' && target !== 'remote')
  ) {
    throw new Error(usage);
  }

  const args = d1Args(target);
  const query = d1Query(args);
  const siteId = site ?? (await selectSite(query));
  const xml = await readFile(file, 'utf8');
  const plan = await planDisqusImport(
    xml,
    await readImportState(query, siteId),
  );
  await mkdir('tmp', { recursive: true, mode: 0o700 });
  const sqlFile = `tmp/disqus-import-${createId()}.sql`;
  await writeFile(sqlFile, importSql(plan), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ ...plan.report, sqlFile }, null, 2));

  if (apply) {
    d1ApplyFile(args, sqlFile);
    const verification = await verifyImport(query, plan);
    console.log(
      `Verified ${verification.comments} Comments across ${verification.pages} Pages.`,
    );
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
