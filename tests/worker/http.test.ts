import { SELF } from 'cloudflare:test';
import { expect, test } from 'vitest';

test('unknown routes return the JSON error and deployment HSTS policy', async () => {
  const response = await SELF.fetch('https://comments.example/unknown');
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: { code: 'not_found' } });
  expect(response.headers.get('strict-transport-security')).toBe(
    'max-age=31536000',
  );
});
