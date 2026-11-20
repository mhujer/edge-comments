import { Hono } from 'hono';
import { admin } from './admin';
import { writeWeeklyBackup } from './backups';
import type { WorkerBindings, WorkerEnv } from './bindings';
import { publicApi } from './public-api';

const app = new Hono<WorkerEnv>();
app.use('*', async (context, next) => {
  await next();
  context.header('Strict-Transport-Security', 'max-age=31536000');
});
app.route('/api', publicApi);
app.route('/admin', admin);
app.notFound((context) => context.json({ error: { code: 'not_found' } }, 404));
export default {
  fetch: app.fetch,
  scheduled: (controller, env, context) => {
    context.waitUntil(writeWeeklyBackup(controller.scheduledTime, env));
  },
} satisfies ExportedHandler<WorkerBindings>;
