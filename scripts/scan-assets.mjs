// Finds the asset files a game uses, so the single-file build embeds only those.
// Looks for '/assets/…' string literals in src/ (paths built at runtime like `/assets/${x}.glb` can't
// be found: list them as plain strings somewhere, e.g. `export const ASSETS = ['/assets/…']`).
// A .gltf file's own .bin/.png files are added too.
import fs from 'node:fs';
import path from 'node:path';
import { listFiles } from './build-id.mjs';

// A quote, then /assets/…, then the same quote, with no ${ inside.
const LITERAL = /(['"`])(\/assets\/(?:(?!\1)[^\n$\\])+?)\1/g;

// Comment lines are skipped: they're full of example paths that don't exist.
const COMMENT_LINE = /^\s*(\/\/|\/?\*).*$/gm;

/** '/assets/…' strings in a piece of source code. */
export const findAssetPaths = (code) =>
  [...code.replace(COMMENT_LINE, '').matchAll(LITERAL)].map((m) => m[2].split(/[?#]/)[0]);

/** CONFIG.startGame from src/config.js, or null (read as text so this runs without Vite). */
export function readStartGame(root) {
  const file = path.join(root, 'src', 'config.js');
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8').match(/^\s*startGame:\s*['"]([\w-]+)['"]/m)?.[1] ?? null;
}

/**
 * With `game`, other games' folders are skipped: a student's deploy shouldn't carry the other games' assets.
 * @returns {{ found: string[], missing: string[] }} found: existing files ('/assets/…'), sorted;
 *   missing: referenced but not in public/ (often just examples in comments).
 */
export function scanAssets(root, { game = null } = {}) {
  const refs = new Set();
  for (const file of listFiles(root, ['src'])) {
    const inGame = file.replaceAll('\\', '/').match(/^src\/games\/([^/]+)\//)?.[1];
    if (game && inGame && inGame !== game) continue;
    if (/\.(js|mjs|ts|css|html|json)$/.test(file)) for (const p of findAssetPaths(fs.readFileSync(path.join(root, file), 'utf8'))) refs.add(p);
  }
  const found = new Set();
  const missing = new Set();
  const visit = (p) => {
    p = path.posix.normalize(p);
    if (found.has(p) || missing.has(p)) return;
    const abs = path.join(root, 'public', p);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return missing.add(p);
    found.add(p);
    if (p.endsWith('.gltf')) {
      // External buffers/images sit next to the .gltf and are referenced relative to it.
      const json = JSON.parse(fs.readFileSync(abs, 'utf8'));
      for (const item of [...(json.buffers ?? []), ...(json.images ?? [])])
        if (item.uri && !/^[a-z]+:/i.test(item.uri)) visit(path.posix.join(path.posix.dirname(p), decodeURI(item.uri)));
    }
  };
  for (const p of refs) visit(p);
  return { found: [...found].sort(), missing: [...missing].sort() };
}

/**
 * The public/ files a build needs, as 'public/…' paths: assets the start game (plus shared code and
 * index.html) mentions. null = no startGame set, so every game is in the build and all of public/ is needed.
 */
export function usedPublicFiles(root) {
  const game = readStartGame(root);
  if (!game) return null;
  const html = fs.existsSync(path.join(root, 'index.html')) ? fs.readFileSync(path.join(root, 'index.html'), 'utf8') : '';
  const fromHtml = findAssetPaths(html).filter((p) => fs.existsSync(path.join(root, 'public', p)));
  return [...new Set([...scanAssets(root, { game }).found, ...fromHtml])].sort().map((p) => `public${p}`);
}
