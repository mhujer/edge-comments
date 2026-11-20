import type { D1Migration } from '@cloudflare/vitest-plugin';
declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      BACKUPS: R2Bucket;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
