// The kit's own public/ files (as shipped in the repo), fingerprinted, so `npm run submit` can leave untouched library
// files out of the zip and keep anything a team added or edited (their models, CREDITS.md, …).
//
//   node scripts/asset-tools/library.mjs     regenerate library-index.json after changing the library
//
// library-index.json maps 'public/…' → sha1 of the file as shipped.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFiles } from '../build-id.mjs';

const INDEX = 'scripts/asset-tools/library-index.json';
// Teams edit these, so they always travel with the submission.
const ALWAYS_TEAM = new Set(['public/assets/CREDITS.md']);

const sha1 = (file) => createHash('sha1').update(fs.readFileSync(file)).digest('hex');

let cache = null;
const loadIndex = (root) => {
  if (cache?.root !== root) {
    const file = path.join(root, INDEX);
    cache = { root, index: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {} };
  }
  return cache.index;
};

/** True if `file` ('public/…') is a library file the team hasn't changed. */
export function isLibraryFile(root, file) {
  if (ALWAYS_TEAM.has(file)) return false;
  const expected = loadIndex(root)[file];
  return !!expected && expected === sha1(path.join(root, file));
}

/** public/ files that ship in the repo: git's view when available (skips the teacher-only library). */
function shippedPublicFiles(root) {
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' });
  if (top.status !== 0 || path.resolve(top.stdout.trim()) !== path.resolve(root)) return listFiles(root, ['public']);
  const git = spawnSync('git', ['ls-files', '-co', '--exclude-standard', 'public'], { cwd: root, encoding: 'utf8' });
  if (git.status !== 0) return listFiles(root, ['public']);
  return git.stdout.split('\n').filter(Boolean).sort();
}

export function buildIndex(root) {
  const index = {};
  for (const file of shippedPublicFiles(root)) if (!ALWAYS_TEAM.has(file)) index[file] = sha1(path.join(root, file));
  fs.mkdirSync(path.dirname(path.join(root, INDEX)), { recursive: true });
  fs.writeFileSync(path.join(root, INDEX), JSON.stringify(index, null, 0).replaceAll('","', '",\n"') + '\n');
  cache = null;
  return Object.keys(index).length;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  console.log(`library-index.json: ${buildIndex(root)} files`);
}
