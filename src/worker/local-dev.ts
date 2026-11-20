import type { WorkerBindings } from './bindings';
import { siteverifyUrl } from './comment-submission';
import worker from './index';

// Only the local runner selects this entry point. The hosted Worker calls
// Siteverify directly. The dummy widget sends this token on localhost.
const networkFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  if (request.url !== siteverifyUrl || request.method !== 'POST') {
    return networkFetch(request);
  }

  const inputBody = await request.json<{
    secret?: string;
    response?: string;
  }>();
  return Response.json({
    hostname: 'localhost',
    success:
      inputBody.secret === '1x0000000000000000000000000000000AA' &&
      inputBody.response === 'XXXX.DUMMY.TOKEN.XXXX',
  });
};

export default {
  fetch(request, env, context) {
    // The E2E browser uses a local bypass and shares one loopback IP.
    // Worker tests exercise the Access guard and rate limits.
    const bindings =
      env.PLAYWRIGHT_RUN === '1'
        ? {
            ...env,
            ADMIN_AUTH_BYPASS: '1',
            RL_SUBMIT: { limit: () => Promise.resolve({ success: true }) },
          }
        : env;
    return worker.fetch(request, bindings, context);
  },
  scheduled: worker.scheduled,
} satisfies ExportedHandler<WorkerBindings & { PLAYWRIGHT_RUN?: '1' }>;
