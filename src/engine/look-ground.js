// Ground styles for engine.look.ground() / engine.ground(). Textures are drawn on a canvas
// at startup, so there are no image files to download and it works offline.
//
//   createGround({ style: 'plain', size: 40, color: '#2b3150' })      the old flat ground
//   createGround({ style: 'noise', color: '#6a9f4b', color2: '#4f7f3a' })   soft organic patches
//   createGround({ style: 'grid' | 'checker', cell: 1 })                 tiles one unit wide
//   createGround({ style: 'gradient' })    centre colour fading to color2 at the edge (blends into fog)
//   createGround({ style: 'island', size: 24, depth: 3, side: '#7a5537' })   round diorama base
// Always returns one Mesh whose top surface is at y, so physics.add(ground, { mass: 0 }) works.
import * as THREE from 'three';
import { random } from './look-data.js';

function canvasTexture(px, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  draw(c.getContext('2d'), px);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

/** Tileable value noise painted between two colours (soft blotches + fine speckle). */
function noiseTexture(color, color2, repeat) {
  return canvasTexture(
    256,
    (g, n) => {
      const rand = random(11);
      const grid = (cells) => Array.from({ length: cells * cells }, rand);
      const octaves = [[4, 0.55], [8, 0.3], [32, 0.15]].map(([cells, w]) => ({ cells, w, v: grid(cells) }));
      const sample = ({ cells, v }, x, y) => {
        const fx = (x / n) * cells, fy = (y / n) * cells;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const sx = (fx - x0) ** 2 * (3 - 2 * (fx - x0)), sy = (fy - y0) ** 2 * (3 - 2 * (fy - y0));
        const at = (i, j) => v[((j % cells) * cells + (i % cells))]; // wraps, so the texture tiles
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
        const bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
        return top + (bot - top) * sy;
      };
      // mix in sRGB: the canvas stores sRGB bytes
      const a = new THREE.Color(color).getRGB({}, THREE.SRGBColorSpace), b = new THREE.Color(color2).getRGB({}, THREE.SRGBColorSpace);
      const img = g.createImageData(n, n);
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          let h = 0;
          for (const o of octaves) h += sample(o, x, y) * o.w;
          const k = THREE.MathUtils.smoothstep(h, 0.35, 0.65);
          img.data.set([a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k].map((v) => v * 255).concat(255), (y * n + x) * 4);
        }
      g.putImageData(img, 0, 0);
    },
    repeat,
  );
}

export function createGround({ style = 'plain', size = 40, color = '#2b3150', color2, y = 0, cell = 1, depth = 2.5, side = '#6b4a35', roughness = 0.95 } = {}) {
  const c2 = color2 ?? new THREE.Color(color).offsetHSL(0, -0.02, -0.07).getStyle();
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness });
  if (style === 'plain') material.color.set(color);
  else if (style === 'grid')
    material.map = canvasTexture(128, (g, n) => {
      g.fillStyle = color;
      g.fillRect(0, 0, n, n);
      g.strokeStyle = c2;
      g.lineWidth = 6;
      g.strokeRect(0, 0, n, n);
    }, size / cell);
  else if (style === 'checker')
    material.map = canvasTexture(128, (g, n) => {
      g.fillStyle = color;
      g.fillRect(0, 0, n, n);
      g.fillStyle = c2;
      g.fillRect(0, 0, n / 2, n / 2);
      g.fillRect(n / 2, n / 2, n / 2, n / 2);
    }, size / (cell * 2));
  else if (style === 'gradient') {
    material.map = canvasTexture(256, (g, n) => {
      const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
      grad.addColorStop(0, color);
      grad.addColorStop(1, c2);
      g.fillStyle = grad;
      g.fillRect(0, 0, n, n);
    });
    material.map.wrapS = material.map.wrapT = THREE.ClampToEdgeWrapping;
  } else if (style === 'noise' || style === 'island') material.map = noiseTexture(color, c2, Math.max(1, size / 12));
  else throw new Error(`ground style "${style}"? Use plain, grid, checker, noise, gradient or island.`);

  let mesh;
  if (style === 'island') {
    // a thick round slab: grassy top, earthy sides that taper a little (classic diorama base)
    const r = size / 2;
    const geo = new THREE.CylinderGeometry(r, r * 0.9, depth, 64, 3);
    geo.translate(0, -depth / 2, 0);
    // planar UVs on the top cap so the noise texture keeps its scale
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > -0.001) uv.setXY(i, pos.getX(i) / size + 0.5, pos.getZ(i) / size + 0.5);
    const sideMat = new THREE.MeshStandardMaterial({ color: side, roughness: 1, flatShading: true });
    mesh = new THREE.Mesh(geo, [sideMat, material, sideMat]);
  } else {
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
    mesh.rotation.x = -Math.PI / 2;
  }
  mesh.position.y = y;
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}
