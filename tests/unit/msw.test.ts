import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';

const server = setupServer(
  http.post('https://challenges.cloudflare.com/turnstile/v0/siteverify', () =>
    HttpResponse.json({ success: true }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('the external bot verification service can be simulated without the network', async () => {
  const response = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    { method: 'POST' },
  );
  expect(await response.json()).toEqual({ success: true });
});
