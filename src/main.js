// Boots the engine and starts the chosen game. You normally don't need to edit this file.
import './style.css';
import { CONFIG } from './config.js';
import { GAMES } from './games/index.js';
import { createEngine } from './engine/engine.js';

const params = new URLSearchParams(location.search);
const gameId = params.get('game') ?? CONFIG.startGame;
const goTo = (id) => (location.search = `?game=${id ?? 'menu'}`);

const engine = createEngine({
  container: document.getElementById('app'),
  overlay: document.getElementById('ui'),
  settings: CONFIG.settings,
});

async function showMenu() {
  document.title = CONFIG.title;
  engine.lights();
  engine.cameraRig.orbit({ distance: 10, autoRotate: true });
  const knot = new engine.THREE.Mesh(
    new engine.THREE.TorusKnotGeometry(1.4, 0.45, 160, 24),
    new engine.THREE.MeshStandardMaterial({ color: '#7c83ff', metalness: 0.3, roughness: 0.3 }),
  );
  engine.scene.add(knot);
  engine.onUpdate((dt) => (knot.rotation.y += dt * 0.4));
  const entries = Object.entries(GAMES);
  const choice = await engine.ui.menu({
    title: CONFIG.title,
    text: entries.map(([, g]) => `<b>${g.title}</b>: ${g.description}`).join('<br>'),
    buttons: entries.map(([, g]) => g.title),
  });
  goTo(entries.find(([, g]) => g.title === choice)[0]);
}

async function startGame(id) {
  const entry = GAMES[id];
  if (!entry) return showError(`There is no game called "${id}". Check src/games/index.js.`);
  document.title = entry.title;
  engine.ui.button('☰ Games', () => goTo(null), 'bottom-right');
  try {
    const game = (await entry.load()).default;
    await game.setup(engine);
  } catch (err) {
    console.error(err);
    showError(`${err.message}<br><small>Open the browser console (F12) to see more.</small>`);
  }
}

function showError(message) {
  engine.ui.menu({ title: 'Something broke', text: message, buttons: ['Reload', 'Game menu'] }).then((b) =>
    b === 'Reload' ? location.reload() : goTo(null),
  );
}

if (!gameId || gameId === 'menu') showMenu();
else startGame(gameId);

// Build ID (a hash of the source, set by vite.config.js): graders compare it with the submitted zip.
const buildLabel = Object.assign(document.createElement('div'), { textContent: `build ${__BUILD_ID__}` });
buildLabel.style.cssText =
  'position:fixed;left:4px;bottom:2px;font:10px/1.2 monospace;opacity:.45;color:#fff;pointer-events:none;z-index:9999';
document.body.append(buildLabel);
console.info(`Game Lab 3D build ${__BUILD_ID__}`);

// For debugging: type `engine` in the browser console (F12) while `npm run dev` is running.
if (import.meta.env.DEV) window.engine = engine;
