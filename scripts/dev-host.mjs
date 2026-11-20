import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const e2e = process.argv.includes('--e2e');
const port = e2e ? 8791 : 8788;
const workerOrigin = `http://localhost:${e2e ? 8790 : 8787}`;
const turnstileOrigin = 'https://challenges.cloudflare.com';
const csp = [
  "default-src 'self'",
  `script-src 'self' ${workerOrigin} ${turnstileOrigin}`,
  `connect-src 'self' ${workerOrigin}`,
  `frame-src ${turnstileOrigin}`,
].join('; ');

const [home, strict] = await Promise.all(
  ['index.html', 'strict.html'].map(async (name) => {
    const html = await readFile(
      new URL(`../dev/${name}`, import.meta.url),
      'utf8',
    );
    return html.replaceAll('{{workerOrigin}}', workerOrigin);
  }),
);

createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (path === '/strict.html') {
    response.setHeader('Content-Security-Policy', csp);
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    return response.end(strict);
  }
  if (path === '/' || (e2e && path.startsWith('/moderation/'))) {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    return response.end(home);
  }
  response.writeHead(404).end();
}).listen(port, e2e ? '127.0.0.1' : '0.0.0.0', () => {
  console.log(`Development Site listening at http://localhost:${port}`);
});
