import { readdir, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
const files = (await readdir('public')).filter((name) =>
  /\.(js|css)$/.test(name),
);
let bytes = 0;
for (const file of files)
  bytes += gzipSync(await readFile(`public/${file}`)).byteLength;
console.log(`Widget JS + CSS: ${bytes} gzip bytes (limit 20480)`);
if (bytes > 20 * 1024) process.exitCode = 1;
