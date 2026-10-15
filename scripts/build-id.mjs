// Build ID: a short fingerprint of the game's source, shown in the corner of the running game.
// Graders rebuild the submitted zip and compare this ID with the deployed page: same ID = same code.
//
//   node scripts/build-id.mjs      prints the ID for the current folder
//
// Hashes sorted paths + contents of src/, index.html, package.json and the public/ assets the build
// uses (all of public/assets/ when no startGame is set; see usedPublicFiles in scan-assets.mjs), so a
// grader rebuilding from the submission zip (which carries only those assets) gets the same ID.
// Text files are hashed with \n line endings so Windows (CRLF) and Mac/Linux checkouts agree.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { usedPublicFiles } from './scan-assets.mjs'; // (circular import is fine: only functions, called later)

export const ID_INPUTS = ['src', 'public/assets', 'index.html', 'package.json'];
const SKIP = new Set(['node_modules', '.git', '.DS_Store', 'Thumbs.db', 'desktop.ini']);
const TEXT = /\.(js|mjs|cjs|json|html|css|md|txt|svg|gltf|csv|glsl|vert|frag)$/i;

/** All files under the given paths (relative to root), as sorted forward-slash paths. */
export function listFiles(root, inputs) {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    if (fs.statSync(abs).isDirectory()) {
      for (const name of fs.readdirSync(abs)) if (!SKIP.has(name)) walk(rel ? `${rel}/${name}` : name);
    } else out.push(rel);
  };
  for (const input of inputs) walk(input);
  return [...new Set(out)].sort();
}

/** The files the build ID covers. */
export function idFiles(root) {
  const used = usedPublicFiles(root);
  if (!used) return listFiles(root, ID_INPUTS);
  return [...listFiles(root, ID_INPUTS.filter((p) => p !== 'public/assets')), ...used].sort();
}

export function computeBuildId(root, files = idFiles(root)) {
  const hash = createHash('sha256');
  for (const file of files) {
    let data = fs.readFileSync(path.join(root, file));
    if (TEXT.test(file)) data = Buffer.from(data.toString('utf8').replaceAll('\r\n', '\n'));
    hash.update(`${file}\0${data.length}\0`).update(data);
  }
  return hash.digest('hex').slice(0, 8);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(computeBuildId(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')));
