import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
        },
      },
      {
        plugins: [
          cloudflareTest({
            remoteBindings: false,
            wrangler: { configPath: './wrangler.example.jsonc' },
            miniflare: {
              bindings: {
                TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
                TEST_MIGRATIONS: await readD1Migrations('./migrations'),
              },
            },
          }),
        ],
        test: {
          name: 'worker',
          include: ['tests/worker/**/*.test.ts'],
          setupFiles: ['tests/worker/setup.ts'],
          deps: {
            optimizer: { ssr: { enabled: true, include: ['sanitize-html'] } },
          },
        },
      },
    ],
  },
});
