import {
  emailErrorCode,
  stripControlCharacters,
  sendAdminEmail,
} from './admin-email';
import type { WorkerBindings } from './bindings';
import { loadDeploymentExport } from './export';

const backupPrefix = 'backups/edge-comments-';
const datedBackupSuffixPattern = /^\d{4}-\d{2}-\d{2}\.json$/;
const backupsToKeep = 50;
const maxDeleteSize = 1_000;

export async function* listBackups(bucket: R2Bucket) {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: backupPrefix, cursor });
    for (const object of page.objects) {
      if (datedBackupSuffixPattern.test(object.key.slice(backupPrefix.length)))
        yield object;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

async function pruneBackups(bucket: R2Bucket) {
  const keys: string[] = [];
  for await (const { key } of listBackups(bucket)) keys.push(key);
  // ISO dates in the keys sort chronologically, even after a delayed run.
  keys.sort();
  const deleteCount = keys.length - backupsToKeep;
  for (let offset = 0; offset < deleteCount; offset += maxDeleteSize) {
    await bucket.delete(
      keys.slice(offset, Math.min(offset + maxDeleteSize, deleteCount)),
    );
  }
}

export async function writeWeeklyBackup(
  scheduledTime: number,
  env: WorkerBindings,
): Promise<void> {
  let stage = 'export';
  try {
    const date = new Date(scheduledTime).toISOString().slice(0, 10);
    const key = `${backupPrefix}${date}.json`;
    const exported = await loadDeploymentExport(env.DB);
    const json = JSON.stringify(exported);
    stage = 'write';
    await env.BACKUPS.put(key, json, {
      httpMetadata: { contentType: 'application/json' },
    });
    stage = 'prune';
    await pruneBackups(env.BACKUPS);
    console.log(
      JSON.stringify({ event: 'weekly_backup', result: 'success', key }),
    );
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const text = `Backup failed: ${message}`;
    let emailError: string | undefined;
    try {
      const subject = stripControlCharacters(text);
      await sendAdminEmail(env, { subject, text });
    } catch (error) {
      emailError = emailErrorCode(error);
    }
    console.error(
      JSON.stringify({
        event: 'weekly_backup',
        result: 'failure',
        stage,
        emailError,
      }),
    );
  }
  // Mark the cron invocation as failed without logging the binding's error text.
  throw new Error('Scheduled backup failed');
}
