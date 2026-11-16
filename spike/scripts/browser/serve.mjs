// Bundle the browser tlock check and serve it on 127.0.0.1 for a short, fixed time, then exit.
//   node scripts/browser/serve.mjs [seconds]
import { build } from 'esbuild';
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../../out/browser/', import.meta.url));
fs.mkdirSync(dir, { recursive: true });
const result = await build({ entryPoints: [fileURLToPath(new URL('./tlock-browser.mjs', import.meta.url))], bundle: true, format: 'iife', platform: 'browser', target: 'es2020', minify: true, outfile: `${dir}bundle.js`, metafile: true, logLevel: 'warning' });
fs.writeFileSync(`${dir}index.html`, '<!doctype html><meta charset="utf-8"><title>tlock check</title><pre id="result">running…</pre><script src="bundle.js"></script>\n');
const size = fs.statSync(`${dir}bundle.js`).size;
console.log(`bundle ${size} bytes, ${Object.keys(result.metafile.inputs).length} modules`);
fs.writeFileSync(fileURLToPath(new URL('../../out/tlock-bundle.json', import.meta.url)), JSON.stringify({ bundleBytes: size, modules: Object.keys(result.metafile.inputs).length }, null, 2) + '\n');
const seconds = Number(process.argv[2] || 120);
const server = http.createServer((req, res) => {
  const file = req.url === '/bundle.js' ? 'bundle.js' : 'index.html';
  res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(fs.readFileSync(dir + file));
});
server.listen(4173, '127.0.0.1', () => console.log(`http://127.0.0.1:4173 for ${seconds}s`));
setTimeout(() => { server.close(); process.exit(0); }, seconds * 1000);
