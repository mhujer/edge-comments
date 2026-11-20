import { build, context } from 'esbuild';
const options = {
  entryPoints: ['src/widget/index.ts'],
  bundle: true,
  loader: { '.css': 'text' },
  minify: true,
  target: 'es2022',
  outfile: 'public/widget.js',
};
if (process.argv.includes('--watch')) {
  await (await context(options)).watch();
} else {
  await build(options);
}
