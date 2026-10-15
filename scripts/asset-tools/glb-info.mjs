#!/usr/bin/env node
// Inspect .glb / .gltf files without a browser: animation clip names, triangle count,
// size (world-space bounding box, metres), external files it needs, skinned or not.
// Reads only the JSON part of the file (no code is executed from the model).
//
//   node scripts/asset-tools/glb-info.mjs public/assets/models/kaykit-adventurers/Knight.glb
//   node scripts/asset-tools/glb-info.mjs --json public/assets/models > /tmp/models.json   (whole folder)
import fs from 'node:fs';
import path from 'node:path';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** Returns the glTF JSON of a .glb or .gltf file. */
export function readGltfJson(file) {
  const buf = fs.readFileSync(file);
  if (file.endsWith('.gltf')) return JSON.parse(buf.toString('utf8'));
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB file');
  const len = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error('first GLB chunk is not JSON');
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

const nodeMatrix = (n) => {
  if (n.matrix) return new Matrix4().fromArray(n.matrix);
  return new Matrix4().compose(
    new Vector3(...(n.translation ?? [0, 0, 0])),
    new Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
    new Vector3(...(n.scale ?? [1, 1, 1])),
  );
};

export function inspect(file) {
  const g = readGltfJson(file);
  const box = new Box3();
  let triangles = 0;
  const visit = (i, parent) => {
    const n = g.nodes[i];
    const m = parent.clone().multiply(nodeMatrix(n));
    if (n.mesh !== undefined) {
      for (const p of g.meshes[n.mesh].primitives) {
        const acc = g.accessors[p.attributes.POSITION];
        if (acc?.min && acc?.max) {
          // transform the 8 corners of the local box (skinned meshes: bind pose, good enough for size)
          for (let c = 0; c < 8; c++) {
            const v = new Vector3(c & 1 ? acc.max[0] : acc.min[0], c & 2 ? acc.max[1] : acc.min[1], c & 4 ? acc.max[2] : acc.min[2]);
            box.expandByPoint(n.skin !== undefined ? v : v.applyMatrix4(m));
          }
        }
        const count = p.indices !== undefined ? g.accessors[p.indices].count : acc?.count ?? 0;
        if ((p.mode ?? 4) === 4) triangles += Math.floor(count / 3);
      }
    }
    for (const c of n.children ?? []) visit(c, m);
  };
  const scene = g.scenes?.[g.scene ?? 0];
  for (const r of scene?.nodes ?? []) visit(r, new Matrix4());
  const size = box.isEmpty() ? [0, 0, 0] : box.getSize(new Vector3()).toArray().map((v) => +v.toFixed(2));
  const external = [...(g.buffers ?? []), ...(g.images ?? [])].map((x) => x.uri).filter((u) => u && !u.startsWith('data:'));
  return {
    file,
    bytes: fs.statSync(file).size,
    animations: (g.animations ?? []).map((a) => a.name),
    skinned: (g.skins ?? []).length > 0,
    triangles,
    size, // [x, y, z] in model units (glTF = metres)
    minY: box.isEmpty() ? 0 : +box.min.y.toFixed(2),
    external,
    materials: (g.materials ?? []).length,
    textures: (g.images ?? []).length,
  };
  void COMPONENTS;
}

const walk = (p) =>
  fs.statSync(p).isDirectory()
    ? fs.readdirSync(p).flatMap((f) => walk(path.join(p, f)))
    : /\.(glb|gltf)$/i.test(p) ? [p] : [];

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('glb-info.mjs')) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const files = args.filter((a) => a !== '--json').flatMap(walk);
  if (!files.length) {
    console.log('usage: node scripts/asset-tools/glb-info.mjs [--json] <file-or-folder>...');
    process.exit(1);
  }
  const out = [];
  for (const f of files) {
    try {
      out.push(inspect(f));
    } catch (e) {
      out.push({ file: f, error: e.message });
    }
  }
  if (asJson) console.log(JSON.stringify(out, null, 1));
  else
    for (const r of out) {
      if (r.error) console.log(`${r.file}: ERROR ${r.error}`);
      else
        console.log(
          `${r.file}  ${(r.bytes / 1024).toFixed(0)} KB  tris ${r.triangles}  size ${r.size.join('×')}` +
            (r.skinned ? '  skinned' : '') +
            (r.external.length ? `  needs: ${r.external.join(', ')}` : '') +
            (r.animations.length ? `\n    clips (${r.animations.length}): ${r.animations.join(', ')}` : ''),
        );
    }
}
