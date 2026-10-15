// ART DIRECTION: "a tiny contested world at golden hour, seen from orbit".
//   Mood: calm and cinematic between moves, then a short, bright burst of energy on every capture.
//   Shot: the planet fills the middle of the frame; a high-key warm sun lights it from over your left
//   shoulder; a cold blue companion star sits just past the upper-right limb (rim light + lens flare).
//   Palette: the world itself is muted and dark (navy-teal seas, olive/umber land, white-blue ice), so the
//   only saturated things are the two sides: Ember = molten gold (warm), Frost = ice cyan (cold). Grid and
//   UI are a pale lavender hologram that never competes with them. Violet is reserved for the night and
//   black holes; warm white for supernova stars.
//   Shapes: round, smooth, premium: bevelled metal/enamel coins with engraved glowing emblems; hexagonal
//   ice spires as the only sharp silhouettes (on the poles, away from play).
//   References: Outer Wilds (a planet that feels like a place), Elite Dangerous orbital views (night-side
//   city lights, atmosphere limb), Polytopia/Into the Breach (board readability first, UI with restraint).
//   Rule: readability beats spectacle. Effects are short and fade fully; nothing hides a disc or a hint.
//
// This file: discs, markers (black holes, stars), capture beams, shockwaves and camera moves. It reads the
// pure game state (logic.js) and animates it with the engine's board helpers (src/engine/board.js).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { instancedPieces, placePiece, flipPiece, stopPiece, cascadeDelays } from '../../engine/board.js';
import { rowOf, colOf, P1, P2, EMPTY, HOLE } from './logic.js';

const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
const THICK = 0.17;
const FACE = 0.82; // the enamel face's radius inside the metal bezel

/** Canvas helper: returns a CanvasTexture drawn by fn(ctx, size). */
function canvasTex(size, fn, srgb = true) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  fn(cv.getContext('2d'), size);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Emissive map for a face: a fine glowing ring and an engraved emblem (sun for Ember, snowflake for Frost). */
function emblem(kind) {
  return canvasTex(256, (g, size) => {
    const mid = size / 2;
    g.fillStyle = '#000';
    g.fillRect(0, 0, size, size);
    g.translate(mid, mid);
    g.strokeStyle = '#ffffff';
    g.lineCap = 'round';
    g.shadowColor = '#ffffff';
    g.shadowBlur = 10;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(0, 0, mid * 0.86, 0, Math.PI * 2);
    g.stroke();
    if (kind === 'sun') {
      g.lineWidth = 10;
      g.beginPath();
      g.arc(0, 0, 26, 0, Math.PI * 2);
      g.stroke();
      for (let k = 0; k < 12; k++) {
        g.rotate(Math.PI / 6);
        g.lineWidth = k % 2 ? 6 : 9;
        g.beginPath();
        g.moveTo(0, 42);
        g.lineTo(0, k % 2 ? 62 : 80);
        g.stroke();
      }
    } else {
      g.lineWidth = 8;
      for (let k = 0; k < 6; k++) {
        g.rotate(Math.PI / 3);
        g.beginPath();
        g.moveTo(0, 8);
        g.lineTo(0, 80);
        g.moveTo(0, 44);
        g.lineTo(-17, 62);
        g.moveTo(0, 44);
        g.lineTo(17, 62);
        g.moveTo(0, 22);
        g.lineTo(-10, 32);
        g.moveTo(0, 22);
        g.lineTo(10, 32);
        g.stroke();
      }
    }
  });
}

/** Albedo for a face: fine concentric guilloché rings, like an engraved coin. */
const guilloche = () =>
  canvasTex(256, (g, size) => {
    const mid = size / 2;
    for (let r = mid; r > 0; r -= 2) {
      const v = 200 + Math.round(40 * (0.5 + 0.5 * Math.sin(r * 0.9)));
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.beginPath();
      g.arc(mid, mid, r, 0, Math.PI * 2);
      g.fill();
    }
  });

/** A coin with a bevelled metal bezel and two slightly recessed faces. Groups: 0 bezel, 1 top, 2 bottom. */
function coinGeometry() {
  const h = THICK / 2;
  const v = (x, y) => new THREE.Vector2(x, y);
  const bezel = new THREE.LatheGeometry([v(FACE, -h * 0.55), v(0.9, -h), v(0.975, -h), v(1, -h * 0.55), v(1, h * 0.55), v(0.975, h), v(0.9, h), v(FACE, h * 0.55)], 56);
  const top = new THREE.CircleGeometry(FACE, 56).rotateX(-Math.PI / 2).translate(0, h * 0.55, 0);
  const bottom = new THREE.CircleGeometry(FACE, 56).rotateX(Math.PI / 2).translate(0, -h * 0.55, 0);
  // the faces' UVs span the face only: scale them so the emblem fills it
  return mergeGeometries([bezel, top, bottom], true);
}

/**
 * cfg: { radius, rows, cols, latMax, env (reflection map for the metal), colors: { a, b, bFace, aGlow, bGlow, rim, asleep, star } }
 * Returns helpers the game uses: sync, animateMove, animateShift, beam, setGhost, setLastMove, faceCell, intro…
 */
export function createView(engine, cfg) {
  const { fx, camera, scene } = engine;
  const { radius: R, rows, cols, latMax, colors } = cfg;
  const cellLat = (2 * latMax) / rows;
  const cellLon = (Math.PI * 2) / cols;
  const count = rows * cols;

  // ---------- geometry of the board on the sphere ----------
  // Same mapping as THREE.SphereGeometry's uv (which the planet shader uses), so picks and pixels agree.
  const normalOf = (i, out = new THREE.Vector3()) => {
    const lat = latMax - (rowOf(i, cols) + 0.5) * cellLat;
    const phi = (colOf(i, cols) + 0.5) * cellLon;
    return out.set(-Math.cos(phi) * Math.cos(lat), Math.sin(lat), Math.sin(phi) * Math.cos(lat));
  };
  /** Cell under a point on (or near) the planet's surface, or null on the polar caps. */
  const cellAtPoint = (p) => {
    const n = p.clone().normalize();
    const lat = Math.asin(THREE.MathUtils.clamp(n.y, -1, 1));
    if (Math.abs(lat) >= latMax) return null;
    let phi = Math.atan2(n.z, -n.x);
    if (phi < 0) phi += Math.PI * 2;
    const c = Math.min(cols - 1, Math.floor(phi / cellLon));
    const r = Math.min(rows - 1, Math.floor((latMax - lat) / cellLat));
    return r * cols + c;
  };
  // Disc size: fits the cell's narrower side (cells get narrower towards the caps).
  const discRadius = (i) => {
    const lat = latMax - (rowOf(i, cols) + 0.5) * cellLat;
    return 0.4 * Math.min(R * Math.cos(lat) * cellLon, R * cellLat);
  };
  const restQuat = (i, owner, out = new THREE.Quaternion()) => {
    out.setFromUnitVectors(Y, normalOf(i));
    return owner === P2 ? out.multiply(FLIP) : out;
  };

  // ---------- discs: one instanced two-faced coin (top = Ember, bottom = Frost) ----------
  const discGeo = coinGeometry();
  const lines = guilloche();
  const faceMat = (color, glow, map, metal, glowAmount) =>
    new THREE.MeshPhysicalMaterial({
      color, map: lines, metalness: metal, roughness: metal > 0.5 ? 0.26 : 0.2, clearcoat: 1, clearcoatRoughness: 0.12,
      emissive: glow, emissiveIntensity: glowAmount, emissiveMap: map, envMap: cfg.env ?? null, envMapIntensity: 1.3,
    });
  const materials = [
    new THREE.MeshStandardMaterial({ color: colors.rim, metalness: 1, roughness: 0.22, envMap: cfg.env ?? null, envMapIntensity: 1.5 }),
    faceMat(colors.a, colors.aGlow, emblem('sun'), 0.85, 1.9),
    faceMat(colors.bFace, colors.bGlow, emblem('flake'), 0.5, 1.25), // cyan is brighter to the eye: less glow keeps the two sides equal
  ];
  const pieces = instancedPieces(engine, discGeo, materials, count);
  const awake = new THREE.Color(1, 1, 1);
  const sleepy = new THREE.Color(colors.asleep);
  for (let i = 0; i < count; i++) pieces.mesh.setColorAt(i, awake);
  const lift = THICK / 2 + 0.02;
  const restPos = (i, out = new THREE.Vector3()) => normalOf(i, out).multiplyScalar(R + lift);
  const resetPiece = (i, owner) => {
    const p = pieces.at(i);
    stopPiece(engine, p);
    p.visible = owner === P1 || owner === P2;
    p.userData.owner = owner;
    restPos(i, p.position);
    restQuat(i, owner, p.quaternion);
    const r = discRadius(i);
    p.scale.set(r, 1, r);
  };

  // ---------- ghost disc (hover preview) and last-move ring ----------
  const ghostMat = new THREE.MeshBasicMaterial({ color: colors.a, transparent: true, opacity: 0.45, depthWrite: false });
  const ghost = new THREE.Mesh(discGeo, [ghostMat, ghostMat, ghostMat]);
  ghost.visible = false;
  scene.add(ghost);
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.25, 1.5), transparent: true, opacity: 0.85, toneMapped: false });
  const lastRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 8, 64), ringMat);
  lastRing.visible = false;
  scene.add(lastRing);
  let ghostCell = null;
  let lastCell = null;
  let previewCells = [];
  const tilt = new THREE.Quaternion();

  // ---------- shockwave rings on the surface (pooled) ----------
  const waveGeo = new THREE.RingGeometry(0.86, 1, 64);
  const waves = Array.from({ length: 6 }, () => {
    const m = new THREE.Mesh(waveGeo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    m.visible = false;
    m.raycast = () => {};
    scene.add(m);
    return m;
  });
  let waveNext = 0;

  // ---------- capture beams: arcs of light that run along a captured line ----------
  const beamMat = (color) =>
    new THREE.ShaderMaterial({
      uniforms: { uHead: { value: 0 }, uColor: { value: new THREE.Color(color).multiplyScalar(2.2) }, uLen: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform float uHead, uLen; uniform vec3 uColor; varying vec2 vUv;
        void main() {
          float x = vUv.x;
          float behind = uHead - x;
          float a = behind < 0.0 ? 0.0 : exp(-behind * 6.0 / uLen) ;
          a *= smoothstep(0.0, 0.03, x);
          float core = 1.0 - abs(vUv.y - 0.5) * 2.0;
          gl_FragColor = vec4(uColor * a * (0.5 + core), a);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });

  // ---------- black holes and supernova stars (rebuilt from the game state) ----------
  const markers = new THREE.Group();
  scene.add(markers);
  const holeUniforms = { uTime: { value: 0 } };
  const holeMat = new THREE.ShaderMaterial({
    uniforms: holeUniforms,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vUv;
      void main() {
        vec2 p = vUv - 0.5;
        float r = length(p) * 2.0;
        float a = atan(p.y, p.x + 1e-5);
        float swirl = 0.55 + 0.45 * sin(a * 3.0 + 5.0 / (r + 0.2) - uTime * 2.6);
        float disk = smoothstep(1.0, 0.6, r) * smoothstep(0.28, 0.42, r);
        float core = smoothstep(0.34, 0.26, r);
        float lens = exp(-abs(r - 0.36) * 40.0);
        vec3 hot = mix(vec3(1.0, 0.55, 0.2), vec3(0.55, 0.3, 1.0), smoothstep(0.35, 0.9, r));
        vec3 col = hot * swirl * disk * 1.8 + vec3(1.0, 0.85, 1.0) * lens * 1.2;
        float alpha = max(core, max(disk * swirl * 0.85, lens));
        gl_FragColor = vec4(col * (1.0 - core), alpha);
      }`,
    transparent: true, depthWrite: false, toneMapped: false,
  });
  const holeGeo = new THREE.CircleGeometry(1, 48);
  const starTex = canvasTex(128, (g, s) => {
    const m = s / 2;
    const gr = g.createRadialGradient(m, m, 0, m, m, m);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.15, 'rgba(255,240,200,0.8)');
    gr.addColorStop(0.4, 'rgba(255,200,120,0.15)');
    gr.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
    g.translate(m, m);
    g.fillStyle = 'rgba(255,250,235,0.95)';
    for (let k = 0; k < 4; k++) {
      g.rotate(Math.PI / 2);
      g.beginPath();
      g.moveTo(0, -4);
      g.quadraticCurveTo(2, -m * 0.2, 0, -m * 0.98);
      g.quadraticCurveTo(-2, -m * 0.2, 0, -4);
      g.fill();
    }
  });
  const starMat = new THREE.SpriteMaterial({ map: starTex, color: colors.star, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const markerAt = new Map(); // cell → object

  function buildMarkers(g) {
    for (const o of [...markers.children]) markers.remove(o);
    markerAt.clear();
    for (let i = 0; i < count; i++) {
      if (g.cells[i] === HOLE) {
        const m = new THREE.Mesh(holeGeo, holeMat);
        m.quaternion.setFromUnitVectors(Z, normalOf(i));
        m.position.copy(normalOf(i)).multiplyScalar(R + 0.012);
        m.scale.setScalar(discRadius(i) * 1.25);
        m.userData = { cell: i, kind: 'hole' };
        m.raycast = () => {};
        markers.add(m);
        markerAt.set(i, m);
      } else if (g.stars?.[i] && g.cells[i] === EMPTY) {
        const s = new THREE.Sprite(starMat);
        s.userData = { cell: i, kind: 'star', base: discRadius(i) * 2.1 };
        s.position.copy(normalOf(i)).multiplyScalar(R + 0.32);
        s.raycast = () => {};
        markers.add(s);
        markerAt.set(i, s);
      }
    }
  }

  // ---------- camera ----------
  const tmp = new THREE.Vector3();
  let camTween = 0;
  let frameX = 0;
  let frameY = 0;
  let frameKey = '';
  const applyFrame = () => {
    // shift the picture sideways without moving the camera (menu: the planet sits beside the card)
    const w = innerWidth;
    const h = innerHeight;
    const key = `${w}x${h}:${frameX.toFixed(4)}:${frameY.toFixed(4)}`;
    if (key === frameKey) return;
    frameKey = key;
    if (Math.abs(frameX) < 1e-4 && Math.abs(frameY) < 1e-4) camera.clearViewOffset();
    else camera.setViewOffset(w, h, -frameX * w, -frameY * h, w, h);
  };

  const view = {
    pieces,
    normalOf,
    cellAtPoint,
    restPos,
    discRadius,

    /** Snap every disc and marker to the game state (start, undo). Cancels running animations. */
    sync(g) {
      previewCells = [];
      for (let i = 0; i < count; i++) resetPiece(i, g.cells[i]);
      buildMarkers(g);
      view.setLastMove(g.history.entries.findLast((e) => e.move >= 0)?.move ?? null);
    },

    /** Dim the discs that are asleep (night rule). cols: list of night columns. */
    setAsleep(nightCols) {
      const set = new Set(nightCols);
      for (let i = 0; i < count; i++) pieces.mesh.setColorAt(i, set.has(colOf(i, cols)) ? sleepy : awake);
      pieces.mesh.instanceColor.needsUpdate = true;
    },

    /**
     * Place the disc of history entry `e` and flip its captures in waves outward along each line.
     * hooks: onLand(), onFlip(cell, k) where k counts flips so far (raise the pitch with it). Resolves when done.
     */
    async animateMove(e, { onLand, onFlip, onNova, step = 0.085 } = {}) {
      const i = e.move;
      resetPiece(i, e.player);
      const up = normalOf(i);
      view.setGhost(null);
      const star = markerAt.get(i);
      await placePiece(engine, pieces.at(i), { up, drop: 1.8, duration: 0.32 });
      onLand?.();
      view.setLastMove(i);
      if (star) {
        markers.remove(star);
        markerAt.delete(i);
      }
      const color = e.player === P1 ? colors.a : colors.b;
      for (const line of e.lines) view.beam([i, ...line], color, { duration: 0.25 + line.length * step, closed: line.length >= cols - 1 });
      const origin = restPos(i);
      const novaSet = new Set(e.nova ?? []);
      const delays = cascadeDelays(e.lines, { start: 0.04, step });
      // supernova discs flip all at once, a beat after the landing
      if (novaSet.size) onNova?.();
      for (const j of novaSet) delays.set(j, 0.12);
      let k = 0;
      const jobs = [...delays].map(([j, delay]) => {
        const p = pieces.at(j);
        p.userData.owner = e.player;
        const n = normalOf(j);
        // spin round the axis across the line, so discs "roll over" away from the new disc
        const away = tmp.copy(p.position).sub(origin);
        const axis = new THREE.Vector3().crossVectors(n, away).normalize();
        if (axis.lengthSq() < 0.5) axis.set(1, 0, 0).applyQuaternion(p.quaternion);
        return flipPiece(engine, p, { axis, up: n, height: novaSet.has(j) ? 0.9 : 0.55, duration: 0.4, delay, onFlip: () => onFlip?.(j, k++) });
      });
      await Promise.all(jobs);
    },

    /** Tectonic shift: band `row` slides k columns round the planet (discs and markers), then snaps to `g`. */
    async animateShift(row, k, g, { duration = 1.1 } = {}) {
      const inRow = [];
      for (let c = 0; c < cols; c++) {
        const i = row * cols + c;
        const p = pieces.at(i);
        stopPiece(engine, p);
        if (p.visible) inRow.push({ obj: p, pos: p.position.clone(), quat: p.quaternion.clone() });
        const m = markerAt.get(i);
        if (m) inRow.push({ obj: m, pos: m.position.clone(), quat: m.quaternion.clone() });
      }
      const s = { t: 0 };
      const q = new THREE.Quaternion();
      await fx.tween(s, { t: 1 }, {
        duration, ease: 'inOutSine',
        onUpdate: () => {
          // a little overshoot-and-settle reads as heavy rock grinding into place
          const a = k * cellLon * (s.t + Math.sin(s.t * Math.PI) * 0.06);
          q.setFromAxisAngle(Y, a);
          for (const it of inRow) {
            it.obj.position.copy(it.pos).applyQuaternion(q);
            it.obj.quaternion.copy(it.quat).premultiply(q);
          }
        },
      });
      view.sync(g);
    },

    /** An arc of light along cells (first = the move), lifted off the surface. */
    beam(cellList, color, { duration = 0.5, closed = false } = {}) {
      const pts = cellList.map((c, n) => normalOf(c).multiplyScalar(R + 0.28 + 0.12 * Math.sin((n / Math.max(1, cellList.length - 1)) * Math.PI)));
      if (closed) pts.push(pts[0].clone());
      if (pts.length < 2) return;
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const geo = new THREE.TubeGeometry(curve, Math.max(12, pts.length * 10), 0.035, 6, false);
      const mat = beamMat(color);
      mat.uniforms.uLen.value = Math.min(1, 3 / pts.length);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.raycast = () => {};
      mesh.renderOrder = 5;
      scene.add(mesh);
      const u = mat.uniforms.uHead;
      fx.tween(u, { value: 1.6 }, { duration: duration * 1.6, ease: 'linear' }).then(() => {
        scene.remove(mesh);
        geo.dispose();
        mat.dispose();
      });
    },

    /** A ring of light expanding on the surface at `cell`. */
    shockwave(cell, color, { size = 2.4, duration = 0.6 } = {}) {
      const m = waves[waveNext++ % waves.length];
      const n = normalOf(cell);
      m.visible = true;
      m.material.color.set(color).multiplyScalar(1.6);
      m.material.opacity = 1;
      m.quaternion.setFromUnitVectors(Z, n);
      m.position.copy(n).multiplyScalar(R + 0.03);
      const base = discRadius(cell);
      const s = { k: 0 };
      fx.tween(s, { k: 1 }, {
        duration, ease: 'outQuad',
        onUpdate: () => {
          m.scale.setScalar(base * (0.6 + size * s.k));
          m.material.opacity = (1 - s.k) * (1 - s.k);
        },
      }).then(() => (m.visible = false));
    },

    setGhost(cell, color) {
      ghostCell = cell;
      ghost.visible = cell !== null;
      if (cell === null) return;
      ghostMat.color.set(color);
      restQuat(cell, P1, ghost.quaternion);
      const r = discRadius(cell);
      ghost.scale.set(r, 1, r);
    },

    /** Discs that the hovered move would capture hover and wobble, as if about to flip. */
    setPreview(cells) {
      for (const i of previewCells) {
        if (cells.includes(i)) continue;
        const p = pieces.at(i);
        restPos(i, p.position);
        restQuat(i, p.userData.owner, p.quaternion);
      }
      previewCells = cells;
    },

    setLastMove(cell) {
      lastCell = cell;
      lastRing.visible = cell !== null;
      if (cell === null) return;
      lastRing.quaternion.setFromUnitVectors(Z, normalOf(cell));
      lastRing.userData.r = discRadius(cell) * 1.3;
    },

    /** Swing the camera round the planet so `cell` faces it (if it isn't already in view). */
    faceCell(cell, { duration = 0.75, minAngle = 0.55 } = {}) {
      const from = camera.position.clone();
      const dist = from.length();
      const to = normalOf(cell).multiplyScalar(dist);
      // keep a little of the current latitude so it doesn't stare straight down at the poles
      to.y = THREE.MathUtils.lerp(to.y, from.y, 0.35);
      to.setLength(dist);
      const angle = from.angleTo(to);
      if (angle < minAngle) return Promise.resolve();
      return view.flyTo(to, { duration });
    },

    /** Fly the camera to `to` (world position) along an arc round the planet, distance easing too. */
    flyTo(to, { duration = 1, ease = 'inOutSine' } = {}) {
      const from = camera.position.clone();
      const q = new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
      const d0 = from.length();
      const d1 = to.length();
      const id = ++camTween;
      const s = { t: 0 };
      const step = new THREE.Quaternion();
      return fx.tween(s, { t: 1 }, {
        duration, ease,
        onUpdate: () => {
          if (id !== camTween) return;
          step.identity().slerp(q, s.t);
          camera.position.copy(from).normalize().applyQuaternion(step).multiplyScalar(THREE.MathUtils.lerp(d0, d1, s.t));
        },
      });
    },

    /** Cinematic fly-in: from deep space, swinging round the planet to the opening view. */
    intro(to, { duration = 2.6 } = {}) {
      const start = to.clone().normalize().applyAxisAngle(Y, -1.5).add(new THREE.Vector3(0, 0.8, 0)).normalize().multiplyScalar(48);
      camera.position.copy(start);
      return view.flyTo(to, { duration, ease: (t) => 1 - (1 - t) ** 3 });
    },

    /** Where the planet sits on screen: x = 0.2 draws it 20% of the width to the right (menus), y > 0 lower. Tweened. */
    frame(x, duration = 0.9, y = 0) {
      const s = { x: frameX, y: frameY };
      return fx.tween(s, { x, y }, { duration, ease: 'inOutSine', onUpdate: () => ((frameX = s.x), (frameY = s.y)) });
    },

    /** A quick push-in of the camera towards the planet and back (impact feel). */
    nudge(amount = 0.35) {
      const s = { k: 0 };
      let prev = 0;
      const apply = () => {
        camera.position.addScaledVector(tmp.copy(camera.position).normalize(), -(s.k - prev) * amount);
        prev = s.k;
      };
      fx.tween(s, { k: 1 }, { duration: 0.07, ease: 'outQuad', onUpdate: apply }).then(() =>
        fx.tween(s, { k: 0 }, { duration: 0.35, ease: 'outQuad', onUpdate: apply }),
      );
    },

    update(t) {
      applyFrame();
      holeUniforms.uTime.value = t;
      if (ghost.visible) {
        const n = normalOf(ghostCell);
        ghost.position.copy(n).multiplyScalar(R + lift + 0.35 + Math.sin(t * 4) * 0.08);
        ghostMat.opacity = 0.35 + 0.15 * Math.sin(t * 4);
      }
      previewCells.forEach((i, k) => {
        const p = pieces.at(i);
        const n = normalOf(i);
        restPos(i, p.position).addScaledVector(n, 0.12 + 0.07 * Math.sin(t * 9 + k));
        restQuat(i, p.userData.owner, p.quaternion).premultiply(tilt.setFromAxisAngle(tmp.set(1, 0, 0).applyQuaternion(p.quaternion), 0.18 * Math.sin(t * 9 + k)));
      });
      if (lastRing.visible) {
        const s = lastRing.userData.r * (1 + 0.06 * Math.sin(t * 3));
        lastRing.scale.set(s, s, s);
        normalOf(lastCell, lastRing.position).multiplyScalar(R + 0.03);
      }
      for (const m of markers.children) {
        if (m.userData.kind !== 'star') continue;
        const pulse = 1 + 0.18 * Math.sin(t * 3 + m.userData.cell);
        m.scale.setScalar(m.userData.base * pulse);
        m.material.rotation = t * 0.4;
      }
    },
  };
  return view;
}
