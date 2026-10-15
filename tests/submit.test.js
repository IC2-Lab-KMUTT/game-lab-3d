// Submission tooling (scripts/): zip writer, build ID hash, asset scanning for the single-file build.
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createZip, readZip } from '../scripts/zip.mjs';
import { computeBuildId } from '../scripts/build-id.mjs';
import { findAssetPaths, scanAssets, readStartGame } from '../scripts/scan-assets.mjs';
import { student, publicFilesToZip } from '../scripts/submit.mjs';
import { buildIndex } from '../scripts/asset-tools/library.mjs';

// Scratch folders stay inside the project (node_modules/.cache is ignored by git).
const SCRATCH = path.resolve(import.meta.dirname, '../node_modules/.cache/gamelab-tests');
let n = 0;
const fixture = (files) => {
  const dir = path.join(SCRATCH, `${process.pid}-${n++}`);
  for (const [name, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), data);
  }
  return dir;
};
afterAll(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

describe('zip writer', () => {
  const entries = [
    { name: 'src/main.js', data: 'console.log("hi");\n'.repeat(50) }, // compressible → deflated
    { name: 'public/assets/x.bin', data: Buffer.from([0, 1, 2, 255]) }, // tiny → stored
    { name: 'docs/ünïcode.md', data: '' },
  ];
  const zip = createZip(entries, { date: new Date(2026, 9, 14, 12, 0, 0) });

  it('round-trips every file', () => {
    const files = readZip(zip);
    expect([...files.keys()]).toEqual(entries.map((e) => e.name));
    for (const e of entries) expect(files.get(e.name).equals(Buffer.from(e.data))).toBe(true);
  });

  it('is deterministic for the same input and date', () => {
    expect(createZip(entries, { date: new Date(2026, 9, 14, 12, 0, 0) }).equals(zip)).toBe(true);
  });

  const hasUnzip = spawnSync('unzip', ['-v']).status === 0;
  it.skipIf(!hasUnzip)('is accepted by the system `unzip -t`', () => {
    const file = path.join(fixture({ 'keep.txt': '' }), 't.zip');
    fs.writeFileSync(file, zip);
    const res = spawnSync('unzip', ['-t', file], { encoding: 'utf8' });
    expect(res.stdout).toMatch(/No errors detected/);
  });
});

describe('build ID', () => {
  const files = { 'src/a.js': 'let a = 1;\n', 'public/assets/m.glb': Buffer.from([1, 2, 3]), 'index.html': '<p>\n', 'package.json': '{}' };

  it('is the same for the same source, and 8 hex chars', () => {
    const id = computeBuildId(fixture(files));
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(computeBuildId(fixture(files))).toBe(id);
  });

  it('ignores Windows line endings but not real changes', () => {
    const id = computeBuildId(fixture(files));
    expect(computeBuildId(fixture({ ...files, 'src/a.js': 'let a = 1;\r\n' }))).toBe(id);
    expect(computeBuildId(fixture({ ...files, 'src/a.js': 'let a = 2;\n' }))).not.toBe(id);
    expect(computeBuildId(fixture({ ...files, 'src/b.js': '' }))).not.toBe(id);
    expect(computeBuildId(fixture({ ...files, 'tests/x.test.js': 'x' }))).toBe(id); // only src, assets, index.html, package.json
  });
});

describe('asset scanning', () => {
  it('finds string literals, not comments or runtime-built paths', () => {
    const code = [
      "const a = '/assets/models/a.glb';",
      'const b = "/assets/s/b.ogg?v=1";',
      '// load("/assets/in/comment.png")',
      'const c = `/assets/models/${name}.glb`;',
      'export const ASSETS = [`/assets/t/c.png`];',
    ].join('\n');
    expect(findAssetPaths(code)).toEqual(['/assets/models/a.glb', '/assets/s/b.ogg', '/assets/t/c.png']);
  });

  it('adds the files a .gltf refers to, and reports missing ones', () => {
    const gltf = JSON.stringify({ buffers: [{ uri: 'tree.bin' }], images: [{ uri: 'tex/bark%20a.png' }, { uri: 'data:image/png;base64,AA' }] });
    const root = fixture({
      'src/game.js': "model('/assets/m/tree.gltf'); sound('/assets/nope.ogg');",
      'public/assets/m/tree.gltf': gltf,
      'public/assets/m/tree.bin': 'b',
      'public/assets/m/tex/bark a.png': 'p',
      'public/assets/unused.png': 'u',
    });
    expect(scanAssets(root)).toEqual({
      found: ['/assets/m/tex/bark a.png', '/assets/m/tree.bin', '/assets/m/tree.gltf'],
      missing: ['/assets/nope.ogg'],
    });
  });

  it('with a start game, skips the other games but keeps shared code', () => {
    const root = fixture({
      'src/config.js': "export const CONFIG = {\n  startGame: 'mine',\n};",
      'src/engine/ui.js': "img('/assets/ui.png');",
      'src/games/mine/index.js': "model('/assets/hero.glb');",
      'src/games/other/index.js': "model('/assets/big.glb');",
      'public/assets/ui.png': 'u',
      'public/assets/hero.glb': 'h',
      'public/assets/big.glb': 'b',
    });
    expect(readStartGame(root)).toBe('mine');
    expect(scanAssets(root, { game: 'mine' }).found).toEqual(['/assets/hero.glb', '/assets/ui.png']);
    expect(scanAssets(root).found).toEqual(['/assets/big.glb', '/assets/hero.glb', '/assets/ui.png']);
  });
});

it('zip name is <studentId>_<Student_Name>, from src/config.js or the CLI, file-name safe', () => {
  const root = fixture({ 'src/config.js': "export const CONFIG = {\n  studentId: '66070501234',\n  studentName: 'Somchai  Jaidee!',\n};" });
  expect(student(root)).toMatchObject({ id: '66070501234', base: '66070501234_Somchai_Jaidee', problems: [] });
  expect(student(root, '66070509999', 'Ann-Marie O\'Neil').base).toBe('66070509999_Ann_Marie_O_Neil');
  expect(student(root, '66070509999', 'สมชาย ใจดี').base).toBe('66070509999_สมชาย_ใจดี');
  const blank = fixture({ 'src/config.js': "export const CONFIG = { studentId: '6xxxxxxxxxx', studentName: 'Student Name' };" });
  expect(student(blank).problems).toHaveLength(2);
  expect(student(blank, '123').problems[0]).toMatch(/not 11 digits/);
});

describe('a game build carries only what it needs', () => {
  const kit = {
    'src/config.js': "export const CONFIG = {\n  startGame: 'mine',\n};",
    'src/games/mine/index.js': "model('/assets/lib/hero.glb');",
    'src/games/demo/index.js': "model('/assets/lib/big.glb');",
    'index.html': '<link rel="icon" href="/assets/icon.svg" />',
    'package.json': '{}',
    'public/assets/icon.svg': '<svg/>',
    'public/assets/lib/hero.glb': 'h',
    'public/assets/lib/big.glb': 'b',
    'public/assets/lib/unused.glb': 'u',
    'public/assets/CREDITS.md': '# credits',
  };

  it('zips used assets + student-added/edited files, not the untouched library', () => {
    const root = fixture(kit);
    buildIndex(root);
    fs.writeFileSync(path.join(root, 'public/assets/mine.ogg'), 'new'); // the student's own file
    fs.writeFileSync(path.join(root, 'public/assets/lib/unused.glb'), 'edited'); // the student edited a library file
    expect(publicFilesToZip(root)).toEqual([
      'public/assets/CREDITS.md', 'public/assets/icon.svg', 'public/assets/lib/hero.glb',
      'public/assets/lib/unused.glb', 'public/assets/mine.ogg',
    ]);
  });

  it('build ID ignores assets the start game does not use, so a rebuild from the zip matches', () => {
    const root = fixture(kit);
    const id = computeBuildId(root);
    fs.writeFileSync(path.join(root, 'public/assets/lib/big.glb'), 'changed');
    expect(computeBuildId(root)).toBe(id);
    fs.writeFileSync(path.join(root, 'public/assets/lib/hero.glb'), 'changed');
    expect(computeBuildId(root)).not.toBe(id);
  });
});

describe('single-file build: CSS url()s', async () => {
  const { inlineCssUrls } = await import('../scripts/build-single.mjs');
  const embedded = { '/assets/fonts/cinzel/Cinzel[wght].ttf': 'AAEC', '/assets/img/bg.png': 'iVBO' };

  it('turns url()s to embedded files into data: URIs, however Vite rewrote the path', () => {
    const css = [
      "@font-face { font-family: C; src: url(../assets/fonts/cinzel/Cinzel%5Bwght%5D.ttf) format('truetype'); }",
      "a { background: url('/assets/img/bg.png'); }",
      'b { background: url("./assets/img/bg.png?v=2"); }',
    ].join('\n');
    const out = inlineCssUrls(css, embedded);
    expect(out).toContain('url("data:font/ttf;base64,AAEC") format');
    expect(out.match(/data:image\/png;base64,iVBO/g)).toHaveLength(2);
    expect(out).not.toContain('/assets/');
  });

  it('leaves other URLs alone', () => {
    const css = "a { b: url(data:image/png;base64,xx); c: url('/assets/missing.png'); d: url(https://x.y/z.woff2); }";
    expect(inlineCssUrls(css, embedded)).toBe(css);
  });
});
