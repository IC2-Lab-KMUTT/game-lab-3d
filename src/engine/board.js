// Helpers every board / puzzle game needs: picking cells with the mouse, a move history with
// "undo back to the human's turn", and piece animations (place, flip, cascades) on top of fx.tween.
// No imports: the pure parts (history, cascadeDelays) can be used from Three.js-free logic files and tests.
//
//   const history = createHistory();            history.push({ player, move })   history.pop()
//   const n = history.stepsBackTo((e) => e.player === human);   // undo n moves → human to move again
//   const delays = cascadeDelays(lines, { start: 0.15, step: 0.08 });   // Map cell → seconds
//
//   const picker = cellPicker(engine, {
//     targets: [boardMesh],                     // what the ray can hit
//     cellAt: (hit) => cellId | null,           // hit (point, instanceId, object…) → your cell id
//     onHover: (cell, previous) => …,           // called when the hovered cell changes (null = none)
//     onPick: (cell) => …,                      // a click that wasn't a camera drag
//   });
//   picker.enabled = false;                      // e.g. while the AI thinks
//
//   const pieces = instancedPieces(engine, geometry, materials, count);   // one draw call for all pieces
//   const p = pieces.at(i);  p.position / p.quaternion / p.scale / p.visible   then it syncs itself
//   await placePiece(engine, p, { up, drop: 0.6 });      // fall in along `up` with a squash
//   await flipPiece(engine, p, { axis, up, delay });     // hop + half turn around `axis` (world space)
//   stopPiece(engine, p);                                // cancel its animations (undo, new game)

/** A list of moves with undo helpers. Entries are whatever you push (e.g. { player, move, flips }). */
export function createHistory() {
  const entries = [];
  return {
    entries,
    push(entry) {
      entries.push(entry);
      return entry;
    },
    pop: () => entries.pop(),
    get last() {
      return entries[entries.length - 1];
    },
    get size() {
      return entries.length;
    },
    clear() {
      entries.length = 0;
    },
    /**
     * How many entries to undo so that the most recent entry matching `pred` is undone too.
     * vs-AI undo: stepsBackTo((e) => e.player === human) rewinds to just before the human's last move.
     * 0 when nothing matches.
     */
    stepsBackTo(pred) {
      for (let i = entries.length - 1; i >= 0; i--) if (pred(entries[i])) return entries.length - i;
      return 0;
    },
  };
}

/**
 * Start delay (seconds) for every cell of a cascade. `lines` is a list of cell lists, each ordered
 * outward from the move, so the wave travels away from it. A cell in several lines gets its earliest time.
 */
export function cascadeDelays(lines, { start = 0, step = 0.08 } = {}) {
  const delays = new Map();
  for (const line of lines)
    line.forEach((cell, k) => {
      const t = start + k * step;
      if (!delays.has(cell) || t < delays.get(cell)) delays.set(cell, t);
    });
  return delays;
}

/** Hover + click on cells. The ray is tested once per frame, only while the pointer moved. */
export function cellPicker(engine, { targets, cellAt, onHover, onPick }) {
  const { input } = engine;
  let hovered = null;
  let lastX = NaN;
  let lastY = NaN;
  const picker = {
    enabled: true,
    get hovered() {
      return hovered;
    },
    /** Re-test the pointer now (after the board changed under a still mouse). */
    refresh() {
      lastX = NaN;
    },
  };
  const test = () => {
    const hit = input.pick(targets);
    return hit ? cellAt(hit) ?? null : null;
  };
  const setHover = (cell) => {
    if (cell === hovered) return;
    const prev = hovered;
    hovered = cell;
    onHover?.(cell, prev);
  };
  engine.onUpdate(() => {
    if (!picker.enabled) return setHover(null);
    if (input.pointer.x === lastX && input.pointer.y === lastY) return;
    lastX = input.pointer.x;
    lastY = input.pointer.y;
    setHover(test());
  });
  input.onClick((e) => {
    if (!picker.enabled || e.button !== 0) return;
    const hit = input.pick(targets, e);
    const cell = hit ? cellAt(hit) ?? null : null;
    if (cell !== null) onPick?.(cell);
  });
  return picker;
}

/**
 * `count` copies of one piece drawn as a single InstancedMesh. `at(i)` is a plain Object3D you move
 * and animate as if it were its own mesh; every frame its transform is copied into the instance.
 * `materials` can be an array (one per geometry group, e.g. a two-coloured disc).
 */
export function instancedPieces(engine, geometry, materials, count) {
  const { THREE, scene } = engine;
  const mesh = new THREE.InstancedMesh(geometry, materials, count);
  mesh.frustumCulled = false; // pieces move around; the default bounds would be wrong
  const proxies = Array.from({ length: count }, () => Object.assign(new THREE.Object3D(), { visible: false }));
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const sync = () => {
    proxies.forEach((p, i) => {
      if (p.visible) {
        p.updateMatrix();
        mesh.setMatrixAt(i, p.matrix);
      } else mesh.setMatrixAt(i, hidden);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  sync();
  scene.add(mesh);
  engine.onUpdate(sync);
  return { mesh, proxies, at: (i) => proxies[i], sync };
}

const anim = (obj) => (obj.userData.pieceAnim ??= { t: 0 });

/** Cancel running place/flip animations on a piece (they resolve where they are). */
export function stopPiece(engine, obj) {
  if (obj.userData.pieceAnim) engine.fx.cancelTweens(obj.userData.pieceAnim);
  delete obj.userData.pieceAnim;
}

/**
 * Drop a piece onto its current position: it falls `drop` units along `up` (a world Vector3; the
 * board's normal there) and lands with a squash. Resolves when it has landed.
 */
export function placePiece(engine, obj, { up, drop = 0.8, duration = 0.32, delay = 0 } = {}) {
  const { THREE, fx } = engine;
  stopPiece(engine, obj);
  const rest = obj.position.clone();
  const scale = obj.scale.clone();
  const dir = up ?? new THREE.Vector3(0, 1, 0);
  const a = anim(obj);
  a.t = 0;
  obj.visible = delay <= 0;
  obj.position.copy(rest).addScaledVector(dir, drop);
  return fx
    .tween(a, { t: 1 }, {
      duration, delay, ease: 'linear',
      onUpdate: () => {
        obj.visible = true;
        const k = a.t;
        obj.position.copy(rest).addScaledVector(dir, drop * (1 - k * k)); // falls, speeding up
        const squash = k > 0.8 ? Math.sin(((k - 0.8) / 0.2) * Math.PI) * 0.35 : 0; // squash on impact
        obj.scale.set(scale.x * (1 + squash * 0.5), scale.y * (1 - squash), scale.z * (1 + squash * 0.5));
      },
    })
    .then(() => {
      if (obj.userData.pieceAnim !== a) return; // stopped (undo / new game): leave it where it was put
      obj.position.copy(rest);
      obj.scale.copy(scale);
    });
}

/**
 * Flip a piece: it hops off the board along `up`, turns half a turn around `axis` (world space,
 * through its centre) and lands. `onFlip` fires at the top of the hop (play a sound there).
 */
export function flipPiece(engine, obj, { axis, up, height = 0.6, duration = 0.42, delay = 0, onFlip } = {}) {
  const { THREE, fx } = engine;
  stopPiece(engine, obj);
  const rest = obj.position.clone();
  const start = obj.quaternion.clone();
  const dir = up ?? new THREE.Vector3(0, 1, 0);
  const turn = new THREE.Quaternion();
  const a = anim(obj);
  a.t = 0;
  let flipped = false;
  return fx
    .tween(a, { t: 1 }, {
      duration, delay, ease: 'inOutSine',
      onUpdate: () => {
        const k = a.t;
        obj.position.copy(rest).addScaledVector(dir, Math.sin(k * Math.PI) * height);
        obj.quaternion.copy(turn.setFromAxisAngle(axis, k * Math.PI)).multiply(start);
        if (!flipped && k >= 0.5) {
          flipped = true;
          onFlip?.();
        }
      },
    })
    .then(() => {
      if (obj.userData.pieceAnim !== a) return;
      obj.position.copy(rest);
      obj.quaternion.copy(turn.setFromAxisAngle(axis, Math.PI)).multiply(start);
    });
}
