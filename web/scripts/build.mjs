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
// Embed the UI font (Barlow Condensed, SIL Open Font License) so the single file works offline.
const fontDir = join(root, 'node_modules/@fontsource/barlow-condensed/files');
const fontFaces = [500, 600, 700].map((weight) => {
  const data = readFileSync(join(fontDir, `barlow-condensed-latin-${weight}-normal.woff2`)).toString('base64');
  return `@font-face{font-family:'Barlow Condensed';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${data}) format('woff2');}`;
}).join('\n');
const css = fontFaces + '\n' + readFileSync(join(root, 'src/client/styles.css'), 'utf8');
const template = readFileSync(join(root, 'src/client/index.html'), 'utf8');
const html = template.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);
const out = join(dist, 'VANGUARD.html');
writeFileSync(out, html);
console.log(`built ${out} (${(statSync(out).size / 1024).toFixed(0)} KB)`);
