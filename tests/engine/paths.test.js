// Asset path resolution (src/engine/paths.js): normal, sub-path and single-file (embedded) builds.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetDir, assetUrl, isEmbedded, loadAssetBuffer, mimeType, normalize } from '../../src/engine/paths.js';

const b64 = (s) => Buffer.from(s).toString('base64');
const text = (buf) => Buffer.from(buf).toString();

afterEach(() => {
  delete globalThis.__GAMELAB_ASSETS__;
  vi.unstubAllGlobals();
});

describe('assetUrl (not embedded)', () => {
  it('prefixes /assets/… with the Vite base ("/" in tests and dev)', () => {
    expect(assetUrl('/assets/models/a.glb')).toBe('/assets/models/a.glb');
  });
  it('leaves full, data: and relative URLs alone', () => {
    for (const u of ['https://x.org/a.png', 'data:image/png;base64,AAAA', 'models/a.glb', '//cdn/x.js'])
      expect(assetUrl(u)).toBe(u);
  });
});

describe('embedded (single-file build)', () => {
  it('returns data: URIs with the right mime type', () => {
    globalThis.__GAMELAB_ASSETS__ = { '/assets/img/a.png': b64('png!') };
    expect(isEmbedded('/assets/img/a.png')).toBe(true);
    expect(isEmbedded('/assets/img/b.png')).toBe(false);
    expect(assetUrl('/assets/img/a.png')).toBe(`data:image/png;base64,${b64('png!')}`);
  });

  it('loadAssetBuffer decodes the bytes and gives a fresh copy every call', async () => {
    globalThis.__GAMELAB_ASSETS__ = { '/assets/s/boom.ogg': b64('hello') };
    const a = await loadAssetBuffer('/assets/s/boom.ogg');
    const b = await loadAssetBuffer('/assets/s/./x/../boom.ogg');
    expect(text(a)).toBe('hello');
    expect(a).not.toBe(b); // decodeAudioData detaches its buffer, so sharing one would break replays
    expect(text(b)).toBe('hello');
  });

  it('explains what to do when a file was not embedded', async () => {
    globalThis.__GAMELAB_ASSETS__ = {};
    await expect(loadAssetBuffer('/assets/models/dyn.glb')).rejects.toThrow(/not embedded/);
  });
});

it('loadAssetBuffer fetches when not embedded', async () => {
  const fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('net').buffer }));
  vi.stubGlobal('fetch', fetch);
  expect(text(await loadAssetBuffer('/assets/x.hdr'))).toBe('net');
  expect(fetch).toHaveBeenCalledWith('/assets/x.hdr');
  vi.stubGlobal('fetch', async () => ({ ok: false, status: 404 }));
  await expect(loadAssetBuffer('/assets/missing.hdr')).rejects.toThrow('404');
});

it('helpers', () => {
  expect(normalize('/assets/m/../t/./a.png')).toBe('/assets/t/a.png');
  expect(assetDir('/assets/m/a.gltf')).toBe('/assets/m/');
  expect(mimeType('/a/b.GLB')).toBe('model/gltf-binary');
  expect(mimeType('/a/b.mp3?v=2')).toBe('audio/mpeg');
  expect(mimeType('/a/b.weird')).toBe('application/octet-stream');
});
