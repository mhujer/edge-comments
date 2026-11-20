export interface WorkerBindings {
  DB: D1Database;
  BACKUPS: R2Bucket;
  EMAIL: SendEmail;
  ADMIN_EMAIL: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ADMIN_AUTH_BYPASS?: string;
  ASSETS?: Fetcher;
  EMAIL_FROM: string;
  CUSTOM_DOMAIN: string;
  RL_SUBMIT: RateLimit;
  RL_API: RateLimit;
  TURNSTILE_SECRET: string;
  TURNSTILE_SITE_KEY: string;
}

export type WorkerEnv = { Bindings: WorkerBindings };
