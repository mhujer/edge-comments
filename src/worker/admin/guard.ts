import type { Context } from 'hono';
import { csrf } from 'hono/csrf';
import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { WorkerBindings, WorkerEnv } from '../bindings';

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

async function verifyAccessAssertion(token: string, env: WorkerBindings) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.ADMIN_EMAIL)
    return false;

  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  try {
    let keys = keySets.get(issuer);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(issuer + '/cdn-cgi/access/certs'));
      keySets.set(issuer, keys);
    }
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ['RS256'],
      issuer,
      audience: env.ACCESS_AUD,
      requiredClaims: ['exp'],
      clockTolerance: 60,
    });
    return (
      typeof payload.email === 'string' &&
      payload.email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase()
    );
  } catch {
    return false;
  }
}

function localAdminBypass(env: WorkerBindings, url: URL) {
  return (
    env.ADMIN_AUTH_BYPASS === '1' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  );
}

export const requireAdmin = createMiddleware<WorkerEnv>(
  async (context, next) => {
    if (!localAdminBypass(context.env, new URL(context.req.url))) {
      const assertion = context.req.header('Cf-Access-Jwt-Assertion');
      if (
        !assertion ||
        !(await verifyAccessAssertion(assertion, context.env))
      ) {
        return forbidden(context);
      }
    }
    await next();
  },
);

function allowedAdminOrigin(env: WorkerBindings, url: URL) {
  return localAdminBypass(env, url)
    ? url.origin
    : `https://${env.CUSTOM_DOMAIN}`;
}

const honoCsrf = csrf({
  origin: (origin, context) =>
    origin ===
    allowedAdminOrigin(context.env as WorkerBindings, new URL(context.req.url)),
  secFetchSite: 'same-origin',
});

export const adminCsrf = createMiddleware<WorkerEnv>(async (context, next) => {
  // Hono accepts either matching signal on form submissions. State changes
  // require both signals for every unsafe method, regardless of content type.
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(context.req.method) &&
    (context.req.header('Origin') !==
      allowedAdminOrigin(context.env, new URL(context.req.url)) ||
      context.req.header('Sec-Fetch-Site') !== 'same-origin')
  ) {
    return forbidden(context);
  }
  return honoCsrf(context, next);
});

function setAdminHeaders(context: Context<WorkerEnv>) {
  context.header(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  context.header('Referrer-Policy', 'same-origin');
  context.header('X-Content-Type-Options', 'nosniff');
  context.header('Cache-Control', 'no-store');
}

function forbidden(context: Context<WorkerEnv>) {
  setAdminHeaders(context);
  return context.text('Forbidden', 403);
}

export const adminHeaders = createMiddleware<WorkerEnv>(
  async (context, next) => {
    await next();
    setAdminHeaders(context);
  },
);
