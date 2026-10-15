// `npm run submit [-- <studentId> "<Student Name>"]`: freeze the code at the end of the exam.
//   1. runs the tests (a failing test is reported but does NOT stop the submission:
//      handing in on time matters more, and graders see the result in SUBMISSION.txt)
//   2. builds dist/ (must succeed) and dist-single/index.html (reported if too big)
//   3. writes submission/<studentId>_<Student_Name>.zip  (source + dist/ + dist-single/ + SUBMISSION.txt)
//      and submission/<studentId>_<Student_Name>.txt     (the same info, build ID + the zip's sha256)
// Student ID and name: the CLI arguments, else `studentId` / `studentName` in src/config.js.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeBuildId, listFiles } from './build-id.mjs';
import { createZip } from './zip.mjs';
import { usedPublicFiles } from './scan-assets.mjs';
import { isLibraryFile } from './asset-tools/library.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Everything graders need to rebuild the game. Never node_modules, dist builds of old runs, .git. */
export const SOURCE = [
  'src', 'tests', 'scripts', 'docs', 'index.html', 'package.json', 'package-lock.json',
  'vite.config.js', 'CLAUDE.md', 'README.md', '.gitignore',
];

/**
 * public/ files to zip: the assets the build uses, plus anything the student added or changed (credits,
 * their own models…). Untouched kit files the game doesn't use stay out, so the zip stays small.
 */
export function publicFilesToZip(root) {
  const used = usedPublicFiles(root);
  const all = listFiles(root, ['public']);
  if (!used) return all;
  return [...new Set([...used, ...all.filter((f) => !isLibraryFile(root, f))])].sort();
}

export const PLACEHOLDER_ID = '6xxxxxxxxxx';
const configField = (root, key) =>
  new RegExp(`\\b${key}\\s*:\\s*['"]([^'"]*)['"]`).exec(fs.readFileSync(path.join(root, 'src/config.js'), 'utf8'))?.[1];

/**
 * { id, name, base, problems }: base is the file name stem, e.g. '66070501234_Somchai_Jaidee'.
 * problems lists what still looks wrong (placeholder ID, not 11 digits, no name) so submit can warn.
 */
export function student(root, argId, argName) {
  const id = (argId || configField(root, 'studentId') || PLACEHOLDER_ID).trim();
  const rawName = (argName || configField(root, 'studentName') || '').trim();
  // Letters (any script, with their accent/vowel marks), digits; everything else becomes "_" so the name is safe in a file name.
  const name = rawName.normalize('NFC').replace(/[^\p{L}\p{M}\p{N}]+/gu, '_').replace(/^_|_$/g, '');
  const problems = [];
  if (id === PLACEHOLDER_ID) problems.push('studentId is still the placeholder 6xxxxxxxxxx');
  else if (!/^\d{11}$/.test(id)) problems.push(`studentId "${id}" is not 11 digits`);
  if (!name || name === 'Student_Name') problems.push('studentName is not set');
  const safeId = id.replace(/[^0-9a-zA-Z]+/g, '') || 'unknown';
  return { id, name: name || 'Unknown', base: `${safeId}_${name || 'Unknown'}`, problems };
}

// One command string + shell: finds npm.cmd on Windows too.
const run = (script) => spawnSync(`npm run ${script}`, { cwd: ROOT, stdio: 'inherit', shell: true }).status === 0;
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function main() {
  const me = student(ROOT, process.argv[2], process.argv[3]);
  if (me.problems.length)
    console.warn(`\n⚠ ${me.problems.join('; ')}.\n  Set studentId and studentName in src/config.js, or run: npm run submit -- 66070501234 "Somchai Jaidee"\n`);

  if (!usedPublicFiles(ROOT))
    console.warn('\n⚠ No startGame in src/config.js: the build and zip include EVERY game and everything in public/.\n  Set startGame to your game so the link opens it and only its assets are shipped.\n');

  const idAtStart = computeBuildId(ROOT);

  console.log('\n=== 1/3 tests ===');
  const testsPassed = run('test');
  if (!testsPassed) console.warn('\n⚠ Some tests failed. Submitting anyway; this is recorded in SUBMISSION.txt.\n');

  console.log('\n=== 2/3 builds ===');
  if (!run('build')) {
    console.error('\n✖ `npm run build` failed, so there is nothing to deploy. Fix the error above and run `npm run submit` again.');
    process.exit(1);
  }
  const singleOk = run('build:single');
  if (!singleOk) console.warn('\n⚠ Single-file build failed (see above). The zip still has dist/ for Netlify/Vercel/Render.\n');

  console.log('\n=== 3/3 zip ===');
  const buildId = computeBuildId(ROOT);
  if (buildId !== idAtStart) {
    // Something (an editor, an agent) changed files mid-way: the builds may not match the zipped source.
    console.error('\n✖ Source files changed while submitting. Stop editing and run `npm run submit` again.');
    process.exit(1);
  }
  const now = new Date();
  const files = [...listFiles(ROOT, SOURCE), ...publicFilesToZip(ROOT), ...listFiles(ROOT, ['dist']), ...(singleOk ? ['dist-single/index.html'] : [])];
  const entries = files.map((name) => ({ name, data: fs.readFileSync(path.join(ROOT, name)) }));

  const info = [
    `Student ID:    ${me.id}`,
    `Name:          ${me.name.replaceAll('_', ' ')}`,
    `Build ID:      ${buildId}`,
    `Created (UTC): ${now.toISOString()}`,
    `Tests:         ${testsPassed ? 'passed' : 'FAILED (see npm test)'}`,
    `Single file:   ${singleOk ? 'dist-single/index.html' : 'FAILED (not included)'}`,
    `Node:          ${process.version}`,
    '',
    'Files (sha256  path):',
    ...entries.map((e) => `${sha256(e.data)}  ${e.name}`),
  ].join('\n');
  const zip = createZip([...entries, { name: 'SUBMISSION.txt', data: info + '\n' }], { date: now });

  const outDir = path.join(ROOT, 'submission');
  fs.mkdirSync(outDir, { recursive: true });
  const base = me.base;
  fs.writeFileSync(path.join(outDir, `${base}.zip`), zip);
  const zipHash = sha256(zip);
  fs.writeFileSync(path.join(outDir, `${base}.txt`), `Zip:           ${base}.zip\nZip sha256:    ${zipHash}\n${info}\n`);

  console.log(`\n✔ submission/${base}.zip  (${(zip.length / 1024 / 1024).toFixed(1)} MB, ${entries.length} files)`);
  console.log(`  sha256 ${zipHash}`);
  console.log(`  Build ID ${buildId}: the deployed game must show "build ${buildId}" in its bottom-left corner.`);
  console.log('  Next: deploy (docs/DEPLOY.md) and hand in the zip + the link.\n');
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
