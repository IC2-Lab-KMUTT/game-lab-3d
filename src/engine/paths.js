// Where asset files really live. Games always write '/assets/…'; this file turns that into
// something that works in every way the game can be deployed:
//   • `npm run dev` and a site at a domain root     → '/assets/…'
//   • a site under a sub-path (GitHub Pages, …)      → '<base>/assets/…' (Vite `base: './'`)
//   • the single-file build (`npm run build:single`) → bytes embedded in the page itself, because
//     Claude artifacts can't fetch anything. scripts/build-single.mjs puts them in
//     globalThis.__GAMELAB_ASSETS__ = { '/assets/…': '<base64>' }.
//
//   assetUrl('/assets/img/wood.png')          a URL you can give to an <img>/TextureLoader (data: URI when embedded)
//   await loadAssetBuffer('/assets/x.hdr')    the file's bytes as an ArrayBuffer (fresh copy every call),
//                                             e.g. new HDRLoader().parse(buffer) or audioContext.decodeAudioData(buffer)
//   isEmbedded(path)                          true in the single-file build when the file was embedded
//   embeddedGltfPlugin                        GLTFLoader.register() plugin so .gltf/.glb files load their
//                                             textures and .bin files from the embedded bytes (no fetch/blob URLs)
//
// The single-file build embeds every '/assets/…' string it finds in src/. Build a path at runtime
// (`/assets/${name}.glb`)? Then also write the full paths somewhere in src/ as plain strings, e.g.
// `export const ASSETS = ['/assets/models/a.glb', '/assets/models/b.glb'];`.

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  ktx2: 'image/ktx2', glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', hdr: 'image/vnd.radiance', json: 'application/json',
};
export const mimeType = (path) => MIME[/\.([a-z0-9]+)(?:[?#].*)?$/i.exec(path)?.[1].toLowerCase()] ?? 'application/octet-stream';

const embedded = () => globalThis.__GAMELAB_ASSETS__;
const decoded = new Map(); // path → Uint8Array, so big files are only base64-decoded once

/** '/assets/a/../b.png' → '/assets/b.png' (glTF files refer to their textures relatively). */
export function normalize(path) {
  const out = [];
  for (const part of path.split('/')) {
    if (part === '..') out.pop();
    else if (part !== '.' && part !== '') out.push(part);
  }
  return '/' + out.join('/');
}

const key = (path) => (path.startsWith('/') ? normalize(path.split(/[?#]/)[0]) : null);
export const isEmbedded = (path) => Boolean(embedded() && key(path) && key(path) in embedded());

function bytes(path) {
  const k = key(path);
  if (!decoded.has(k)) {
    const bin = atob(embedded()[k]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    decoded.set(k, arr);
  }
  return decoded.get(k);
}

/** Vite's base ('/' in dev, './' in builds). Read lazily so tests can run without Vite. */
const base = () => import.meta.env?.BASE_URL ?? '/';

/** Turns '/assets/…' into a URL that works where the game is deployed. Other URLs pass through. */
export function assetUrl(path) {
  if (isEmbedded(path)) return `data:${mimeType(path)};base64,${embedded()[key(path)]}`;
  if (!path.startsWith('/') || path.startsWith('//')) return path; // http:, data:, relative: leave alone
  return base().replace(/\/?$/, '/') + path.slice(1);
}

/** The file's bytes. Always a new ArrayBuffer: decodeAudioData and some loaders take ownership of it. */
export async function loadAssetBuffer(path) {
  if (isEmbedded(path)) return bytes(path).slice().buffer;
  if (embedded() && path.startsWith('/'))
    throw new Error(`"${path}" is not embedded in this single-file build. Write the full path as a string in src/ (see src/engine/paths.js).`);
  const res = await fetch(assetUrl(path));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

/** Directory of an asset path, for resolving a glTF's relative file references: '/assets/m/a.gltf' → '/assets/m/'. */
export const assetDir = (path) => path.slice(0, path.lastIndexOf('/') + 1);

const fromDataUri = (uri) => {
  const bin = atob(uri.slice(uri.indexOf(',') + 1));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
};
const toDataUri = (buffer, mime) => {
  const arr = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < arr.length; i += 0x8000) bin += String.fromCharCode(...arr.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
};

/**
 * GLTFLoader plugin factory: `gltfLoader.register(embeddedGltfPlugin(THREE.TextureLoader))`.
 * Only does something in the single-file build. There, the artifact's security policy blocks fetch()
 * and blob: URLs, so buffers come straight from the embedded bytes and images load as data: URIs
 * through a plain <img> (TextureLoader) instead of fetch-based ImageBitmapLoader.
 */
export const embeddedGltfPlugin = (TextureLoader) => (parser) => {
  if (!embedded()) return { name: 'gamelab_embedded' };
  const resolve = (uri) => (uri.startsWith('/') ? uri : parser.options.path + uri);
  parser.textureLoader = new TextureLoader(parser.options.manager);

  const loadBuffer = parser.loadBuffer.bind(parser);
  parser.loadBuffer = (index) => {
    const uri = parser.json.buffers[index].uri;
    if (uri?.startsWith('data:')) return Promise.resolve(fromDataUri(uri));
    if (uri && isEmbedded(resolve(uri))) return loadAssetBuffer(resolve(uri));
    return loadBuffer(index);
  };

  const loadImageSource = parser.loadImageSource.bind(parser);
  parser.loadImageSource = (index, loader) => {
    const def = parser.json.images[index];
    if (def.uri && !def.uri.startsWith('data:') && isEmbedded(resolve(def.uri))) def.uri = assetUrl(resolve(def.uri));
    if (def.bufferView === undefined || parser.sourceCache[index]) return loadImageSource(index, loader);
    // Image inside a .glb: turn its bytes into a data: URI instead of the blob: URL three.js would use.
    const view = def.bufferView;
    return (parser.sourceCache[index] = parser.getDependency('bufferView', view).then((buf) => {
      def.uri = toDataUri(buf, def.mimeType ?? 'image/png');
      delete def.bufferView;
      delete parser.sourceCache[index];
      return loadImageSource(index, loader);
    }));
  };
  return { name: 'gamelab_embedded' };
};
