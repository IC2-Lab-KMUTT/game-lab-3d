// ORB OTHELLO: the kit's showcase board game. Othello on a planet whose rows wrap all the way round,
// with optional "cosmic rules" (tectonic shifts, black holes, supernova stars, a moving night side).
// Files: logic.js (rules, pure) · ai.js (computer player, pure, time-sliced) · planet.js (surface shader,
//        clouds, atmosphere) · scenery.js (sky, poles, rings, moon, companion star) · view.js (discs,
//        effects, camera; art direction notes at its top) · hud.js + orb.css (interface) · this file
//        (turns, input, sound, music, big moments).
// Generic helpers live in the engine: board.js (picking, history, piece animations), ai.js (bestMoveAsync),
// space.js (baked sky, atmosphere, lens flare), audio.js (musicLayers), effects.js (slowMo).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  createGame, legalMoves, captureLines, play, undo, status, mustPass, scores, nextShift, nightColumns,
  PASS, P1, P2, ROWS, COLS, HOLE, NIGHT_WIDTH, RULE_NAMES, rowOf, colOf,
} from './logic.js';
import { chooseMoveAsync, LEVELS } from './ai.js';
import { createPlanet } from './planet.js';
import { createScenery } from './scenery.js';
import { createView } from './view.js';
import { createHud, RULE_TEXT } from './hud.js';
import { cellPicker } from '../../engine/board.js';

const SETTINGS = {
  radius: 5,
  latMax: (60 * Math.PI) / 180, // the board covers ±60° latitude; the rest is polar cap
  camera: { distance: 16, min: 8.5, max: 26 },
  aiPauseMs: 320, // a beat before the computer moves, so the human sees the turn change
  passPauseMs: 1500,
  flipStep: 0.085, // seconds between flips along a captured line
  musicVolume: 0.5,
  names: { [P1]: 'Ember', [P2]: 'Frost' },
  colors: {
    a: '#ffb43a', aGlow: '#ff6a00', // Ember: molten gold
    b: '#5fd8ff', bFace: '#3fb6ea', bGlow: '#18b8ff', // Frost: ice-cyan enamel
    rim: '#3a3550', asleep: '#5a6390',
    grid: '#a99bff', nightGrid: '#6a4bd8',
    atmo: '#5fa8ff', sunset: '#c0607a',
    companion: '#9cc4ff', // the blue companion star (rim light)
    crystal: '#4f86c4', crystalGlow: '#1d3fae',
    auroraA: '#3dffc4', auroraB: '#7a4dff',
    ringA: '#9a8a76', ringB: '#5a5672',
    band: '#ff8a4c', star: '#fff1cf',
  },
};

const SOUNDS = {
  ember: ['/assets/sounds/kenney-impact/impactMetal_light_000.ogg', '/assets/sounds/kenney-impact/impactMetal_light_001.ogg', '/assets/sounds/kenney-impact/impactMetal_light_002.ogg'],
  frost: ['/assets/sounds/kenney-impact/impactGlass_light_000.ogg', '/assets/sounds/kenney-impact/impactGlass_light_001.ogg', '/assets/sounds/kenney-impact/impactGlass_light_002.ogg'],
  flip: '/assets/sounds/kenney-interface/glass_002.ogg',
  hover: '/assets/sounds/kenney-interface/tick_002.ogg',
  invalid: '/assets/sounds/kenney-interface/error_004.ogg',
  pass: '/assets/sounds/kenney-interface/question_001.ogg',
  undo: '/assets/sounds/kenney-interface/back_001.ogg',
  click: '/assets/sounds/kenney-interface/click_001.ogg',
  start: '/assets/sounds/kenney-interface/maximize_001.ogg',
  ring: '/assets/sounds/kenney-scifi/forceField_000.ogg',
  boom: '/assets/sounds/kenney-scifi/lowFrequency_explosion_000.ogg',
  nova: '/assets/sounds/kenney-scifi/forceField_002.ogg',
  rumble: '/assets/sounds/kenney-scifi/lowFrequency_explosion_001.ogg',
  whoosh: '/assets/sounds/kenney-scifi/spaceEngineLarge_000.ogg',
  win: '/assets/music/space-victory.ogg',
  lose: '/assets/music/space-defeat.ogg',
};
// Adaptive music: calm ambient early on, the pulsing layer when the game is late and close.
const MUSIC = { calm: '/assets/music/space-ambient.ogg', intense: '/assets/music/space-urgent-loop.ogg' };
const COL_NAMES = 'ABCDEFGHIJKLMNOP';
const PLAY_FRAME_Y = 0.06; // the planet sits a little low, so its north pole clears the scoreboard
const cellName = (i) => `${COL_NAMES[colOf(i)]}${rowOf(i) + 1}`;

// Post effects per quality level: low draws straight to the screen (no post passes at all).
const LOOK_BY_QUALITY = {
  low: { bloom: false, grade: false },
  medium: { bloom: { strength: 0.55, radius: 0.45, threshold: 0.92 }, grade: false },
  high: { bloom: { strength: 0.72, radius: 0.55, threshold: 0.86 }, grade: { saturation: 1.08, contrast: 1.06, shadows: '#0d0628' } },
};

export default {
  async setup(engine) {
    const { look, audio, fx, input, camera, renderer } = engine;
    const C = SETTINGS.colors;
    const colorOf = (p) => (p === P1 ? C.a : C.b);
    const cssOf = (p) => (p === P1 ? 'var(--ember)' : 'var(--frost)');

    // ---------- look ----------
    look.preset('space', {
      sky: '#010106', env: false, vignette: 0, fog: false,
      sun: { color: '#fff0d8', intensity: 2.6 },
      rim: { color: C.companion, intensity: 1.4 },
      hemi: { sky: '#3a3070', ground: '#05030f', intensity: 0.25 },
    });
    look.sun.castShadow = false; // nothing here needs shadows; saves a render pass on laptops
    let qualityApplied = '';
    const applyQuality = () => {
      if (qualityApplied === look.quality) return;
      qualityApplied = look.quality;
      look.set(LOOK_BY_QUALITY[look.quality] ?? LOOK_BY_QUALITY.medium);
    };
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; // reflections for the metal discs

    const cfg = { radius: SETTINGS.radius, rows: ROWS, cols: COLS, latMax: SETTINGS.latMax, colors: C, env, quality: look.quality };
    const planet = createPlanet(engine, cfg);
    const scenery = createScenery(engine, cfg);
    const view = createView(engine, cfg);
    applyQuality();

    const controls = engine.cameraRig.orbit({
      target: [0, 0, 0], distance: SETTINGS.camera.distance,
      minDistance: SETTINGS.camera.min, maxDistance: SETTINGS.camera.max, maxPolarAngle: Math.PI - 0.25,
    });
    // Start looking at the opening cross (between cells (3,7) and (4,8)), from a little above the equator.
    const startView = () => view.normalOf(3 * COLS + 7).add(view.normalOf(4 * COLS + 8)).normalize().add(new THREE.Vector3(0, 0.22, 0)).setLength(SETTINGS.camera.distance);
    camera.position.copy(startView()).multiplyScalar(1.45);
    Object.assign(controls, { minPolarAngle: 0.25, enablePan: false, rotateSpeed: 0.55, zoomSpeed: 0.8, dampingFactor: 0.07, autoRotateSpeed: 0.35 });

    // ---------- lights ----------
    // Key sun: over the player's left shoulder, so the side you look at is always lit.
    // Companion star: behind the planet, upper right (rim light + lens flare).
    const light = new THREE.Vector3(0.4, 0.6, 0.7).normalize();
    const lightTarget = new THREE.Vector3();
    const starDir = new THREE.Vector3(-1, 0.4, 0).normalize();
    const starTarget = new THREE.Vector3();
    const right = new THREE.Vector3();
    const camUp = new THREE.Vector3();
    const fwd = new THREE.Vector3();
    let nightF = 0; // the night's first column, gliding towards the real one
    const aimLights = (dt) => {
      fwd.copy(camera.position).normalize();
      right.crossVectors(camera.up, fwd).normalize();
      camUp.crossVectors(fwd, right);
      // Night rule: the night is painted by the planet shader exactly on the rule's columns (a real
      // terminator would darken half the planet and not match the rule); it glides one column per move.
      if (g.rules.night) {
        const target = nightColumns(g)[0];
        const diff = ((((target - nightF) % COLS) + COLS * 1.5) % COLS) - COLS / 2;
        nightF = (nightF + diff * Math.min(1, dt * 2.5) + COLS) % COLS;
        planet.setNight(nightF, NIGHT_WIDTH, true);
      } else planet.setNight(0, 0, false);
      lightTarget.copy(fwd).multiplyScalar(0.75).addScaledVector(camUp, 0.55).addScaledVector(right, -0.45).normalize();
      light.lerp(lightTarget, Math.min(1, dt * 6)).normalize();
      starTarget.copy(fwd).multiplyScalar(-0.85).addScaledVector(right, 0.42).addScaledVector(camUp, 0.3).normalize();
      starDir.lerp(starTarget, Math.min(1, dt * 3)).normalize(); // lags a little behind the camera: feels like a place
      planet.setLight(light);
      planet.setRim(starDir);
      look.sun.position.copy(light).multiplyScalar(50);
      look.sun.target.position.set(0, 0, 0);
      look.rim.position.copy(starDir).multiplyScalar(50);
      look.rim.target.position.set(0, 0, 0);
    };

    // ---------- state ----------
    let g = createGame();
    let opts = { mode: 'ai', level: 'medium', human: P1, hints: true, rules: Object.fromEntries(RULE_NAMES.map((n) => [n, false])), quality: look.qualityMode ?? 'auto' };
    let musicOn = true;
    let volume = 0.8;
    let token = 0; // bumped by undo / new game / menu, so stale async steps stop
    let busy = false; // animating or the computer is thinking
    let over = false;
    let inMenu = false;
    let hover = null;
    let preview = [];
    let showing = null; // [player, text] shown on the turn line while a move animates
    let stats = null;

    const isAI = (p) => opts.mode === 'ai' && p !== opts.human;
    const humanTurn = () => !busy && !over && !inMenu && !isAI(g.current);

    // ---------- sound ----------
    const sfx = (url, o) => audio.play(url, o).catch((err) => console.warn(err.message));
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    let music = null;
    let musicLoading = null;
    let intense = false;
    function startMusic() {
      if (!musicOn || music || musicLoading) return;
      musicLoading = audio
        .musicLayers(MUSIC, { volume: SETTINGS.musicVolume, xfade: 4, fadeIn: 3 })
        .then((m) => {
          musicLoading = null;
          if (!musicOn) return m.stop(0.1);
          music = m;
          if (inMenu) m.muffle(900, 0.01);
          m.setIntensity(intense ? 1 : 0, 0.01);
        })
        .catch((err) => ((musicLoading = null), console.warn(err.message)));
    }
    function toggleMusic() {
      musicOn = !musicOn;
      if (musicOn) startMusic();
      else (audio.stopMusic(), (music = null));
      refresh();
    }
    /** Late and close → the intense layer. Hysteresis, so it doesn't flap on every move. */
    function updateIntensity() {
      const s = scores(g);
      const filled = (s[P1] + s[P2]) / (ROWS * COLS);
      const gap = Math.abs(s[P1] - s[P2]);
      if (!intense && ((filled > 0.5 && gap <= 14) || filled > 0.72)) intense = true;
      else if (intense && filled < 0.4) intense = false;
      music?.setIntensity(intense ? 1 : 0, 6);
    }
    window.addEventListener('pointerdown', startMusic);
    window.addEventListener('keydown', startMusic);

    // ---------- HUD ----------
    const hud = createHud(engine, {
      names: SETTINGS.names,
      cells: ROWS * COLS,
      actions: {
        newGame: () => newGame(),
        undo: () => undoMove(),
        hints: () => {
          opts.hints = !opts.hints;
          refresh();
        },
        music: () => toggleMusic(),
        volume: (v) => {
          volume = v;
          audio.setVolume('master', v);
        },
        quality: (q) => (look.quality = q),
        menu: () => openMenu(),
        click: () => (startMusic(), sfx(SOUNDS.click, { volume: 0.35 })),
        hover: () => sfx(SOUNDS.hover, { volume: 0.12, rate: 1.3 }),
      },
    });
    audio.setVolume('master', volume);

    const ruleStatus = () => {
      const out = {};
      if (g.rules.tectonic) {
        const s = nextShift(g);
        out.tectonic = s.in === 1 ? 'after this move' : `in ${s.in} moves`;
      }
      if (g.rules.holes) out.holes = `${[...g.cells].filter((v) => v === HOLE).length} voids`;
      if (g.rules.nova) {
        const n = g.stars.reduce((a, b) => a + b, 0);
        out.nova = n ? `${n} star${n > 1 ? 's' : ''} left` : 'all used';
      }
      if (g.rules.night) {
        const night = new Set(nightColumns(g));
        const sleeping = [...g.cells].filter((v, i) => (v === P1 || v === P2) && night.has(colOf(i))).length;
        out.night = `${sleeping} asleep`;
      }
      return out;
    };

    const refresh = () => {
      hud.setToggles({ hints: opts.hints, music: musicOn });
      const showHints = opts.hints && humanTurn();
      const legal = showHints ? legalMoves(g) : [];
      const hoverOk = humanTurn() && hover !== null && captureLines(g, hover).length > 0;
      preview = hoverOk ? captureLines(g, hover).flat() : [];
      planet.setCells(g.cells, { legal, preview, hover: hoverOk ? hover : null });
      planet.setMarks(g.stars);
      planet.setTurn(colorOf(g.current));
      view.setGhost(hoverOk ? hover : null, colorOf(g.current));
      view.setPreview(preview);
      view.setAsleep(nightColumns(g));
      const shift = nextShift(g);
      if (shift && shift.in <= 2 && !over) planet.setBand(shift.row, shift.k, shift.in === 1 ? 1 : 0.5);
      else planet.setBand(0, 1, 0);
      hud.setRules(ruleStatus());
      if (over) return;
      if (showing) return hud.setTurn(...showing);
      const name = SETTINGS.names[g.current];
      if (isAI(g.current)) hud.setTurn(g.current, `${name} is thinking<span class="dots"></span>`);
      else if (opts.mode === 'ai') hud.setTurn(g.current, 'Your move');
      else hud.setTurn(g.current, `${name} to move`);
    };
    const labelPlayers = () =>
      hud.setPlayers(opts.mode === 'ai'
        ? { [opts.human]: 'You', [3 - opts.human]: `Computer · ${LEVELS[opts.level].label}` }
        : { [P1]: 'Player 1', [P2]: 'Player 2' });

    // ---------- turns ----------
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    async function nextTurn() {
      const my = token;
      const st = status(g);
      if (st.over) return endGame(st);
      if (mustPass(g)) {
        busy = true;
        showing = [g.current, `${SETTINGS.names[g.current]} passes`];
        refresh();
        const why = g.rules.night ? 'nothing to flank in daylight' : 'no move flanks anything';
        hud.banner(`${SETTINGS.names[g.current]} passes<small>${why}</small>`, cssOf(g.current));
        sfx(SOUNDS.pass, { volume: 0.6 });
        await wait(SETTINGS.passPauseMs);
        showing = null;
        if (my !== token) return;
        const e = play(g, PASS);
        hud.log({ player: e.player, text: 'Pass', detail: '' });
        if (e.shift) await shiftBand(e.shift);
        if (my !== token) return;
        busy = false;
        return nextTurn();
      }
      refresh();
      picker.refresh();
      if (isAI(g.current)) runAI();
    }

    async function runAI() {
      const my = token;
      busy = true;
      refresh();
      const t0 = performance.now();
      // think while the "thinking…" line animates: the search runs in small slices between frames
      // one ~5 ms slice per frame, after it is drawn: the frame rate stays smooth while it thinks
      const move = await chooseMoveAsync(g, opts.level, { cancelled: () => my !== token, sliceMs: 5, pause: () => new Promise(requestAnimationFrame) });
      if (my !== token || move === undefined) return;
      await wait(Math.max(0, SETTINGS.aiPauseMs - (performance.now() - t0)));
      if (my !== token) return;
      if (move !== PASS) await view.faceCell(move);
      if (my !== token) return;
      await doMove(move);
    }

    /** The big-moment kit: slow motion, chromatic punch, flash, shake, music dip. */
    function bigMoment({ color, slow = 0.3, hold = 0.55, shake = 0.16 }) {
      fx.slowMo(slow, hold);
      fx.flash(color, 0.45);
      fx.shake(shake, 0.5);
      music?.duck(0.3, 1.2);
      if (look.quality !== 'low') {
        const s = { a: 1 };
        fx.tween(s, { a: 0 }, { duration: 0.9, onUpdate: () => look.set({ aberration: s.a * 0.9 }) }).then(() => look.set({ aberration: 0 }));
      }
    }

    async function shiftBand({ row, k }) {
      const my = token;
      hud.banner(`Tectonic shift<small>band ${row + 1} slides ${Math.abs(k)} ${k > 0 ? 'east' : 'west'}</small>`, '#ffb08a');
      sfx(SOUNDS.rumble, { volume: 0.7, rate: 0.7 });
      fx.shake(0.05, 1.1);
      planet.rowFlash(row, C.band);
      planet.setBand(0, 1, 0);
      music?.duck(0.5, 0.8);
      stats.shifts++;
      await view.animateShift(row, k, g);
      if (my !== token) return;
      refresh();
    }

    async function doMove(cell) {
      const my = token;
      busy = true;
      hover = null;
      const e = play(g, cell);
      if (!e) return (busy = false);
      if (e.move === PASS) {
        // (only the AI can get here: humans pass through nextTurn)
        busy = false;
        return nextTurn();
      }
      if (!isAI(e.player)) hud.hideHelp();
      // the board under the discs shows the old state until the animation is done
      const shown = g.cells.slice();
      if (e.shift) {
        // show the pre-shift board while the move animates; the slide comes after
        const { row, k } = e.shift;
        for (let c = 0; c < COLS; c++) shown[row * COLS + c] = g.cells[row * COLS + ((((c + k) % COLS) + COLS) % COLS)];
      }
      planet.setCells(shown);
      view.setGhost(null);
      view.setPreview([]);
      const before = scores(g);
      // count up live as discs land and flip
      const live = { [P1]: before[P1], [P2]: before[P2] };
      live[e.player] -= e.flipped.length;
      live[3 - e.player] += e.flipped.length;
      hud.setScores(live);
      const ringLine = e.lines.find((l) => l.length >= COLS - 1);
      const ring = !!ringLine;
      const color = colorOf(e.player);
      showing = [e.player, `${SETTINGS.names[e.player]} captures ${e.flipped.length}`];
      hud.setTurn(...showing);
      const big = e.flipped.length >= 6 || ring;
      stats.best[e.player] = Math.max(stats.best[e.player], e.flipped.length);
      const tags = [ring && 'ring', e.nova?.length && 'nova'].filter(Boolean).join(' · ');
      hud.log({ player: e.player, text: cellName(cell), detail: `+${e.flipped.length}${tags ? ` · ${tags}` : ''}` });
      await view.animateMove(e, {
        step: SETTINGS.flipStep,
        onLand: () => {
          const n = view.normalOf(cell);
          sfx(pick(e.player === P1 ? SOUNDS.ember : SOUNDS.frost), { volume: 0.8, rate: 0.95 + Math.random() * 0.1 });
          planet.ripple(n, color);
          view.shockwave(cell, color, { size: big ? 3.4 : 2.2 });
          fx.burst(view.restPos(cell), { color, count: big ? 40 : 24, speed: 2.8, life: 0.6, size: 0.16, gravity: 0, spread: 0 });
          view.nudge(big ? 0.6 : 0.3);
          if (ring) {
            stats.rings[e.player]++;
            hud.banner(`Ring closed!<small>${ringLine.length} discs round the world</small>`, cssOf(e.player), 'big');
            sfx(SOUNDS.ring, { volume: 0.75 });
            sfx(SOUNDS.boom, { volume: 0.5, rate: 0.8 });
            planet.rowFlash(rowOf(cell), color, colOf(cell));
            bigMoment({ color });
          } else if (big) fx.shake(0.07, 0.25);
        },
        onNova: () => {
          stats.novas[e.player]++;
          hud.banner(`Supernova!<small>${e.nova.length} touching disc${e.nova.length === 1 ? '' : 's'} flip</small>`, '#fff1cf', 'big');
          sfx(SOUNDS.boom, { volume: 0.7 });
          sfx(SOUNDS.nova, { volume: 0.6 });
          view.shockwave(cell, C.star, { size: 6, duration: 0.9 });
          fx.burst(view.restPos(cell).multiplyScalar(1.02), { color: C.star, count: 70, speed: 4.5, life: 0.9, size: 0.2, gravity: 0, spread: 0 });
          planet.ripple(view.normalOf(cell), C.star);
          bigMoment({ color: '#fff1cf', slow: 0.35, hold: 0.4, shake: 0.2 });
        },
        onFlip: (j, k) => {
          sfx(SOUNDS.flip, { volume: 0.3, rate: Math.min(2.4, 0.85 + k * 0.07) });
          fx.burst(view.restPos(j), { color, count: 8, speed: 1.6, life: 0.4, size: 0.12, gravity: 0, spread: 0 });
          live[e.player]++;
          live[3 - e.player]--;
          hud.bump(e.player);
          hud.setScores(live);
        },
      });
      showing = null;
      if (my !== token) return;
      if (e.shift) await shiftBand(e.shift);
      if (my !== token) return;
      busy = false;
      hud.setScores(scores(g));
      updateIntensity();
      nextTurn();
    }

    function endGame(st) {
      over = true;
      busy = false;
      refresh();
      const { winner, scores: s } = st;
      const my = token;
      const name = SETTINGS.names[winner];
      let title = winner ? `${name} wins` : 'Draw';
      let text = winner ? `${name} holds ${s[winner]} of ${ROWS * COLS - [...g.cells].filter((v) => v === HOLE).length} cells.` : 'The planet is split exactly in two.';
      const humanWon = opts.mode === 'ai' && winner === opts.human;
      if (opts.mode === 'ai' && winner) {
        title = humanWon ? 'Victory' : 'Defeat';
        text = humanWon ? `You beat the ${LEVELS[opts.level].label.toLowerCase()} computer. ${text}` : `The ${LEVELS[opts.level].label.toLowerCase()} computer wins this one. ${text}`;
      }
      hud.setTurn(winner || null, winner ? `${name} wins` : 'Draw');
      const lost = opts.mode === 'ai' && winner && !humanWon;
      music?.duck(0.15, lost ? 5 : 6, { release: 3 });
      sfx(lost ? SOUNDS.lose : SOUNDS.win, { volume: 0.9 });
      if (winner) {
        // the winner's colour floods the planet from the last move, the auroras turn, fireworks in orbit
        const last = g.history.entries.findLast((e) => e.move >= 0);
        const origin = last ? view.normalOf(last.move) : camera.position.clone().normalize();
        const col = colorOf(winner);
        planet.flood(origin, col);
        planet.ripple(origin, col);
        scenery.setAurora(col, winner === P1 ? '#ff3d6e' : '#7a4dff', 1.1);
        const mine = [...g.cells].map((v, i) => (v === winner ? i : -1)).filter((i) => i >= 0);
        for (let k = 0; k < 12; k++)
          setTimeout(() => {
            if (my !== token || !mine.length) return;
            const c = pick(mine);
            fx.burst(view.restPos(c).multiplyScalar(1.15), { color: k % 3 ? col : '#ffffff', count: 46, speed: 3.2, life: 1.1, size: 0.18, gravity: 0, spread: 0 });
            view.shockwave(c, col, { size: 4, duration: 0.9 });
          }, 300 + k * 220);
        fx.flash(col, 0.6);
      }
      controls.autoRotate = true;
      view.flyTo(camera.position.clone().setLength(21), { duration: 2.4 });
      setTimeout(async () => {
        if (my !== token) return;
        const statList = [
          ['Biggest capture', Math.max(stats.best[P1], stats.best[P2])],
          ['Rings closed', stats.rings[P1] + stats.rings[P2]],
          ...(g.rules.nova ? [['Supernovas', stats.novas[P1] + stats.novas[P2]]] : []),
          ...(g.rules.tectonic ? [['Shifts', stats.shifts]] : []),
          ['Moves', g.history.entries.filter((e) => e.move >= 0).length],
        ];
        const choice = await hud.end({ title, color: winner ? colorOf(winner) : null, scores: s, text, stats: statList });
        if (my !== token) return;
        controls.autoRotate = false;
        if (choice === 'again') newGame();
        else openMenu();
      }, 2600);
    }

    function resetFx() {
      planet.flood(null);
      scenery.setAurora(C.auroraA, C.auroraB, 0.75);
      engine.timeScale = 1;
    }

    async function newGame({ intro = false } = {}) {
      token++;
      const my = token;
      showing = null;
      g = createGame({ rules: opts.rules, seed: (Math.random() * 2 ** 31) >>> 0 });
      nightF = nightColumns(g)[0] ?? 0;
      stats = { best: { [P1]: 0, [P2]: 0 }, rings: { [P1]: 0, [P2]: 0 }, novas: { [P1]: 0, [P2]: 0 }, shifts: 0 };
      over = false;
      busy = true;
      hover = null;
      intense = false;
      music?.setIntensity(0, 3);
      controls.autoRotate = false;
      resetFx();
      hud.closeOverlays();
      hud.clearLog();
      view.sync(g);
      labelPlayers();
      hud.setScores(scores(g));
      refresh();
      if (intro) {
        hud.showPlayUi(false);
        sfx(SOUNDS.whoosh, { volume: 0.45, rate: 0.75 });
        controls.enabled = false;
        await view.intro(startView());
        controls.enabled = true;
        if (my !== token) return;
        const active = RULE_NAMES.filter((n) => g.rules[n]).map((n) => RULE_TEXT[n].name);
        hud.banner(`${active.length ? 'Cosmic match' : 'Classic match'}<small>${active.length ? active.join(' · ') : 'flank · wrap · close rings'}</small>`, 'var(--ink)');
      } else {
        view.faceCell(3 * COLS + 7, { minAngle: 0.3 });
      }
      hud.showPlayUi(true);
      sfx(SOUNDS.start, { volume: 0.45 });
      planet.ripple(view.normalOf(3 * COLS + 7), C.grid);
      busy = false;
      nextTurn();
    }

    function undoMove() {
      if (inMenu || !g.history.size) return;
      const steps = g.history.stepsBackTo((e) => e.move !== PASS && !isAI(e.player));
      if (!steps) return;
      token++;
      showing = null;
      for (let k = 0; k < steps; k++) undo(g);
      over = false;
      busy = false;
      hover = null;
      controls.autoRotate = false;
      resetFx();
      hud.closeOverlays();
      hud.showPlayUi(true);
      view.sync(g);
      hud.setScores(scores(g));
      hud.log({ player: g.current, text: 'Undo', detail: `${steps} move${steps > 1 ? 's' : ''}` });
      sfx(SOUNDS.undo, { volume: 0.7 });
      fx.flash('#6f5bff', 0.25);
      updateIntensity();
      nextTurn();
    }

    async function openMenu() {
      token++;
      busy = true;
      inMenu = true;
      hud.closeOverlays();
      resetFx();
      controls.autoRotate = true;
      view.frame(0.2);
      view.flyTo(camera.position.clone().setLength(SETTINGS.camera.distance * 1.3), { duration: 1.2 });
      music?.muffle(900, 1.2);
      music?.setIntensity(0, 2);
      refresh();
      opts = await hud.menu(opts);
      inMenu = false;
      look.quality = opts.quality;
      music?.muffle(null, 2);
      view.frame(0, 1.2, PLAY_FRAME_Y);
      startMusic();
      newGame({ intro: true });
    }

    // ---------- input ----------
    const picker = cellPicker(engine, {
      targets: [planet.mesh],
      cellAt: (hit) => view.cellAtPoint(hit.point),
      onHover: (cell) => {
        hover = cell;
        if (humanTurn() && cell !== null && captureLines(g, cell).length) sfx(SOUNDS.hover, { volume: 0.2 });
        refresh();
      },
      onPick: (cell) => {
        if (!humanTurn()) return;
        if (!captureLines(g, cell).length) {
          sfx(SOUNDS.invalid, { volume: 0.4 });
          return;
        }
        doMove(cell);
      },
    });

    let lastT = 0;
    engine.onUpdate((dt, t) => {
      applyQuality();
      aimLights(Math.max(0.001, t - lastT));
      lastT = t;
      planet.update(t);
      view.update(t);
      scenery.update(t, camera, light, starDir);
      if (inMenu) return;
      if (input.wasPressed('KeyU')) undoMove();
      if (input.wasPressed('KeyN')) newGame();
      if (input.wasPressed('KeyH')) (opts.hints = !opts.hints), refresh();
      if (input.wasPressed('KeyM')) toggleMusic();
      if (input.wasPressed('Escape')) openMenu();
    });

    await audio.preload(...SOUNDS.ember, ...SOUNDS.frost, SOUNDS.flip, SOUNDS.hover, SOUNDS.click).catch((err) => console.warn(err.message));
    view.sync(g);
    refresh();
    // Warm up the effect shaders now (behind the menu), so the first capture doesn't stutter compiling them.
    view.beam([0, 1, 2], C.a, { duration: 0.02 });
    view.shockwave(0, C.a, { duration: 0.02 });
    fx.burst(new THREE.Vector3(), { count: 1, life: 0.02 });
    renderer.compile(engine.scene, camera);
    // Debug handle (dev only): window.orb.g is the live game state.
    if (import.meta.env.DEV)
      window.orb = {
        get g() { return g; }, view, planet, scenery, hud, opts: () => opts, doMove, undoMove, newGame,
        get music() { return music; },
        legal: () => legalMoves(g),
        /** Start a game with these options without the menu: orb.start({ rules: { nova: true }, mode: 'hotseat' }). */
        start(o = {}, { intro = false } = {}) {
          hud.closeOverlays();
          inMenu = false;
          opts = { ...opts, ...o, rules: { ...opts.rules, ...(o.rules ?? {}) } };
          view.frame(0, 0.01, PLAY_FRAME_Y);
          return newGame({ intro });
        },
        /** Set up a test position: discs = [[row, col, player], …]; stars = [[row, col], …] replaces the random ones. */
        setPosition(discs, first = P1, rules = {}, stars = null) {
          token++;
          g = createGame({ start: discs, first, rules: { ...opts.rules, ...rules } });
          if (stars) (g.stars.fill(0), stars.forEach(([r, c]) => (g.stars[r * COLS + c] = 1)));
          stats = { best: { [P1]: 0, [P2]: 0 }, rings: { [P1]: 0, [P2]: 0 }, novas: { [P1]: 0, [P2]: 0 }, shifts: 0 };
          over = busy = false;
          view.sync(g);
          nextTurn();
        },
        busy: () => busy,
        /** Where a cell is on screen (CSS pixels) and whether it faces the camera, for scripted clicks. */
        screenOf(cell) {
          const p = view.restPos(cell);
          const facing = p.clone().normalize().dot(camera.position.clone().sub(p).normalize()) > 0.2;
          p.project(camera);
          return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight, facing };
        },
      };
    openMenu();
  },
};
