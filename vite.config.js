import { defineConfig } from 'vite';
import fs from 'node:fs';
import { computeBuildId } from './scripts/build-id.mjs';
import { usedPublicFiles } from './scripts/scan-assets.mjs';

// With a startGame set, dist/ gets only the assets that game uses, not the whole 100+ MB library
// (drag-and-drop hosts and GitHub's web upload choke on thousands of files).
const used = usedPublicFiles(import.meta.dirname);
const copyUsedAssets = {
  name: 'copy-used-assets',
  apply: 'build',
  generateBundle() {
    for (const file of used ?? []) this.emitFile({ type: 'asset', fileName: file.slice('public/'.length), source: fs.readFileSync(`${import.meta.dirname}/${file}`) });
  },
};

export default defineConfig(({ command }) => ({
  // Relative base: the built game works at a domain root AND under a sub-path (GitHub Pages,
  // a zip opened on a static host, …). Asset paths go through src/engine/paths.js.
  base: './',
  // Shown in the corner of the game so graders can match a deployed page to the submitted code.
  define: { __BUILD_ID__: JSON.stringify(command === 'build' ? computeBuildId(import.meta.dirname) : 'dev') },
  // GitHub Pages runs Jekyll, which hides files starting with "_" (like the _template chunk). An empty
  // .nojekyll file in dist/ turns that off.
  plugins: [copyUsedAssets, { name: 'nojekyll', apply: 'build', generateBundle() { this.emitFile({ type: 'asset', fileName: '.nojekyll', source: '' }); } }],
  // Only reachable from this computer — not from the classroom network.
  server: { host: 'localhost', port: 5173 },
  preview: { host: 'localhost', port: 4173 },
  build: { chunkSizeWarningLimit: 1000, copyPublicDir: !used }, // three.js is big; that's fine
  test: { include: ['tests/**/*.test.js'] },
}));
