// ─────────────────────────────────────────────────────────────────────────────
//  YOUR GAME STARTS HERE
//  1. Copy this folder to src/games/<your-game-id>/
//  2. Register it in src/games/index.js
//  3. Set CONFIG.startGame = '<your-game-id>' in src/config.js
//  4. npm run dev → http://localhost:5173
// ─────────────────────────────────────────────────────────────────────────────

export default {
  async setup(engine) {
    const { THREE, scene, input, audio, fx, ui } = engine;

    // --- world ---
    engine.sky('#14182b');
    engine.lights();
    engine.ground({ size: 30, color: '#2b3150' });
    engine.cameraRig.orbit({ target: [0, 1, 0], distance: 10 });

    // --- a thing to play with ---
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: '#ff6b6b', emissive: '#ff6b6b', emissiveIntensity: 0.2 }),
    );
    cube.position.y = 0.5;
    cube.castShadow = true;
    scene.add(cube);

    // --- HUD ---
    let clicks = 0;
    const score = ui.text('Click the cube!', 'top-left', { big: true });

    // --- input ---
    input.onClick((event) => {
      if (!input.pick([cube], event)) return;
      clicks++;
      score.set(`Clicks: ${clicks}`);
      audio.sfx('coin');
      fx.burst(cube.position, { color: '#ffd166' });
      fx.floatText('+1', cube.position, { color: '#ffd166' });
      fx.tween(cube.position, { y: 1.5 }, { duration: 0.15 }).then(() =>
        fx.tween(cube.position, { y: 0.5 }, { duration: 0.4, ease: 'outBounce' }),
      );
    });

    // --- every frame ---
    engine.onUpdate((dt) => {
      cube.rotation.y += dt;
      const move = input.move(); // WASD / arrow keys
      cube.position.x += move.x * 4 * dt;
      cube.position.z += move.z * 4 * dt;
    });
  },
};
