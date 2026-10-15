// `npm run preview:artifact [-- port]`: serves dist-single/index.html with a Content-Security-Policy
// like the one Claude artifacts use, so you can check the single-file build works before publishing.
// Open the printed URL, play, and look in the console (F12) for errors or "Refused to …" messages.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist-single', 'index.html');
const PORT = Number(process.argv[2]) || 4180;

// Approximation of the artifact policy (code.claude.com/docs/en/artifacts): inline code only,
// a few CDNs, images/fonts/media only as data: URIs, network only to the page's own origin.
export const ARTIFACT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://unpkg.com https://cdn.jsdelivr.net/npm/",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'img-src data:',
  'font-src data: https://fonts.gstatic.com',
  'media-src data:',
  "connect-src 'self'",
].join('; ');

if (!fs.existsSync(FILE)) {
  console.error('dist-single/index.html not found. Run `npm run build:single` first.');
  process.exit(1);
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/' && url.pathname !== '/index.html') {
      res.writeHead(404).end('Not found (an artifact has only one file)');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': ARTIFACT_CSP });
    res.end(fs.readFileSync(FILE));
  })
  .listen(PORT, 'localhost', () => console.log(`Artifact preview (strict CSP): http://localhost:${PORT}/`));
