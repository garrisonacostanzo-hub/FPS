// Bundles the client (three.js + peerjs + game code) into ONE self-contained file: dist/VANGUARD.html.
// The file works by simply opening it (file://): offline play, and online play hosted by a player's browser.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });

const result = await build({
  entryPoints: [join(root, 'src/client/main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['es2020', 'chrome90', 'firefox90', 'safari15'],
  write: false,
  legalComments: 'none',
  logLevel: 'warning',
});

const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(join(root, 'src/client/styles.css'), 'utf8');
const template = readFileSync(join(root, 'src/client/index.html'), 'utf8');
const html = template.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);
const out = join(dist, 'VANGUARD.html');
writeFileSync(out, html);
console.log(`built ${out} (${(statSync(out).size / 1024).toFixed(0)} KB)`);
