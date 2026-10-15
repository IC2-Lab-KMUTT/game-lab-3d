// `npm run build:single` → dist-single/index.html: the whole game in ONE file, for Claude Code
// artifacts (they publish a single .html page and block loading anything else).
// JS and CSS are inlined, and every asset the game uses (see scan-assets.mjs) is embedded as
// base64 in globalThis.__GAMELAB_ASSETS__, which src/engine/paths.js reads instead of fetching.
// url(…) references to embedded files in CSS (e.g. an @font-face with url('/assets/fonts/…')) become
// data: URIs, because artifacts only allow fonts and images as data: URIs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { scanAssets, readStartGame } from './scan-assets.mjs';
import { computeBuildId } from './build-id.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(ROOT, 'dist-single', '.tmp');
const OUT = path.join(ROOT, 'dist-single', 'index.html');
export const LIMIT_MB = 15; // artifacts allow 16 MiB; keep some room
const MB = 1024 * 1024;

// Inline <script>/<style> text must not close its own tag early.
const safeScript = (js) => js.replaceAll('</script', '<\\/script').replaceAll('<!--', '<\\!--');
const replaceOnce = (html, find, replacement) => {
  if (!find.test(html)) throw new Error(`build-single: could not find ${find} in Vite's index.html`);
  return html.replace(find, () => replacement); // function: '$' in the bundle must not be special
};

const CSS_MIME = {
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
};

/**
 * Replace url(…) in CSS that points at an embedded '/assets/…' file with a data: URI.
 * Vite rewrites public paths relative to the CSS file ('../assets/…', URL-encoded), so the match
 * is on the '/assets/…' tail of the decoded URL. Other URLs are left alone.
 * @param {string} css
 * @param {Record<string, string>} embedded  '/assets/…' → base64
 */
export function inlineCssUrls(css, embedded) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (all, quote, url) => {
    if (url.startsWith('data:')) return all;
    let decoded = url.split(/[?#]/)[0];
    try {
      decoded = decodeURI(decoded);
    } catch {}
    const at = decoded.indexOf('/assets/');
    const key = at < 0 ? null : path.posix.normalize(decoded.slice(at));
    if (!key || !(key in embedded)) return all;
    const mime = CSS_MIME[key.split('.').pop().toLowerCase()] ?? 'application/octet-stream';
    return `url("data:${mime};base64,${embedded[key]}")`;
  });
}

export async function buildSingle({ log = console.log } = {}) {
  fs.rmSync(path.join(ROOT, 'dist-single'), { recursive: true, force: true });
  await build({
    root: ROOT,
    logLevel: 'warn',
    build: {
      outDir: TMP,
      emptyOutDir: true,
      copyPublicDir: false, // assets are embedded instead
      assetsInlineLimit: Infinity, // anything imported from CSS/JS becomes a data: URI
      cssCodeSplit: false,
      chunkSizeWarningLimit: 100_000, // one big file is the whole point here
      modulePreload: false,
      rolldownOptions: { output: { codeSplitting: false } }, // games' dynamic import()s go into the one bundle
    },
  });

  let html = fs.readFileSync(path.join(TMP, 'index.html'), 'utf8');
  const tagFile = (tag) => path.join(TMP, tag.match(/(?:src|href)="\.?\/?([^"]+)"/)[1]);

  // Embedded assets, as a classic script that runs before the game module.
  // Only the start game's assets (plus engine/shared ones); without a start game, every game's.
  const game = readStartGame(ROOT);
  const { found, missing } = scanAssets(ROOT, { game });
  log(game ? `build-single: start game '${game}': embedding its assets only` : `build-single: no startGame in src/config.js: embedding assets of ALL games (set startGame to shrink the file)`);
  const sizes = found.map((p) => ({ p, bytes: fs.statSync(path.join(ROOT, 'public', p)).size }));
  const map = Object.fromEntries(found.map((p) => [p, fs.readFileSync(path.join(ROOT, 'public', p)).toString('base64')]));
  // CSS <link> → <style> (with url()s to embedded files as data: URIs), module <script src> → inline module.
  for (const tag of html.match(/<link rel="stylesheet"[^>]*>/g) ?? [])
    html = replaceOnce(html, new RegExp(escape(tag)), `<style>${inlineCssUrls(fs.readFileSync(tagFile(tag), 'utf8'), map)}</style>`);
  const scripts = html.match(/<script type="module"[^>]*src="[^"]*"[^>]*><\/script>/g) ?? [];
  if (scripts.length !== 1) throw new Error(`build-single: expected 1 module script, found ${scripts.length}`);
  const js = fs.readFileSync(tagFile(scripts[0]), 'utf8');

  const assetScript = `<script>globalThis.__GAMELAB_ASSETS__=${JSON.stringify(map)};</script>`;
  html = replaceOnce(html, new RegExp(escape(scripts[0])), `${assetScript}\n<script type="module">${safeScript(js)}</script>`);

  // Favicon: inline it if it's a small file in public/, else drop it (relative links don't resolve in artifacts).
  html = html.replace(/<link rel="icon"[^>]*href="\.?\/?([^"]+)"[^>]*>/, (tag, file) => {
    const abs = path.join(ROOT, 'public', file);
    if (!fs.existsSync(abs) || fs.statSync(abs).size > 50_000) return '';
    const type = file.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
    return `<link rel="icon" href="data:${type};base64,${fs.readFileSync(abs).toString('base64')}" />`;
  });

  fs.writeFileSync(OUT, html);
  fs.rmSync(TMP, { recursive: true, force: true });

  const size = Buffer.byteLength(html);
  log(`build-single: embedded ${found.length} asset(s): ${found.join(', ') || '(none)'}`);
  if (missing.length) log(`build-single: referenced in src/ but not in public/ (skipped): ${missing.join(', ')}`);
  log(`build-single: dist-single/index.html = ${(size / MB).toFixed(2)} MB, build ${computeBuildId(ROOT)}`);
  if (size > LIMIT_MB * MB) {
    fs.rmSync(OUT); // don't leave a file around that would fail to publish
    const biggest = sizes.sort((a, b) => b.bytes - a.bytes).slice(0, 8);
    throw new Error(
      `dist-single/index.html is ${(size / MB).toFixed(1)} MB; Claude artifacts allow at most 16 MB (we stop at ${LIMIT_MB}).\n` +
        `Biggest assets (embedded as base64, about 1.33x their size):\n` +
        biggest.map((a) => `  ${(a.bytes / MB).toFixed(2)} MB  ${a.p}`).join('\n') +
        `\nShrink or remove some of them, or deploy dist/ to Netlify/Vercel instead (docs/DEPLOY.md).`,
    );
  }
  return { size, found, missing };
}

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  buildSingle().catch((err) => {
    console.error(`\n✖ ${err.message}\n`);
    process.exit(1);
  });
}
