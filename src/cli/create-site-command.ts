import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { createId } from '../shared/identity';
import type { SiteFields } from '../shared/site-input';
import { LANGUAGES, MODERATION_MODES } from '../shared/site-settings';
import { createSiteSql, parseFirstSite } from './create-site';
import { d1ApplyFile, d1Args, d1Query } from './d1';

async function askFields(defaults: SiteFields): Promise<SiteFields> {
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = async (question: string, current: string) => {
    const hint = current ? ` [${current}]` : '';
    const answer = (await prompt.question(`${question}${hint}: `)).trim();
    return answer || current;
  };
  try {
    console.log(
      'Site name: a label only you see, in the Admin and in notification email subjects. Rename it any time.',
    );
    const name = await ask('Site name', defaults.name);
    const defaultLanguage = await ask(
      `Default language (${LANGUAGES.join('/')})`,
      defaults.defaultLanguage,
    );
    const moderationMode = await ask(
      `Moderation mode (${MODERATION_MODES.join('/')})`,
      defaults.moderationMode,
    );
    console.log(
      'Allowed origins, one per line, such as https://www.example.com. Finish with an empty line.',
    );
    if (defaults.origins)
      console.log(
        `Press Enter at once to keep: ${defaults.origins.replaceAll('\n', ' ')}`,
      );
    const origins: string[] = [];
    for (;;) {
      const line = (await prompt.question('Allowed origin: ')).trim();
      if (!line) break;
      origins.push(line);
    }
    return {
      name,
      defaultLanguage,
      moderationMode,
      origins: origins.length ? origins.join('\n') : defaults.origins,
    };
  } finally {
    prompt.close();
  }
}

async function main() {
  if (!process.stdin.isTTY)
    throw new Error('Creating the first Site needs an interactive terminal.');
  const args = d1Args('remote');
  const query = d1Query(args);
  const [count] = await query<{ sites: number }>(
    'SELECT count(*) AS sites FROM site',
  );
  if ((count?.sites ?? 0) > 0) {
    console.log(
      'The database already has a Site. Add more Sites in the Admin.',
    );
    return;
  }

  let fields: SiteFields = {
    name: '',
    defaultLanguage: 'cs',
    moderationMode: 'approve_first',
    origins: '',
  };
  for (;;) {
    fields = await askFields(fields);
    const settings = parseFirstSite(fields);
    if (typeof settings !== 'string') {
      await mkdir('tmp', { recursive: true, mode: 0o700 });
      const sqlFile = `tmp/create-site-${createId()}.sql`;
      await writeFile(sqlFile, createSiteSql(settings), {
        mode: 0o600,
        flag: 'wx',
      });
      d1ApplyFile(args, sqlFile);
      const created = await query<{ name: string }>('SELECT name FROM site');
      if (!created.some(({ name }) => name === settings.name))
        throw new Error('The Site was not created.');
      console.log(`Created Site ${settings.name}.`);
      return;
    }
    console.error(settings);
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
