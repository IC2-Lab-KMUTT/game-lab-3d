---
name: sound
description: Add sound effects, music and audio feedback to a Game Lab 3D game: built-in synth effects and melodies (no files), downloaded CC0 sounds and music, adaptive music layers, volume and mute. Use when the user wants the game to have sound, music, or better audio.
---

# Add sound

The sound design is part of the student's game design: ask what mood they want (calm and thoughtful,
tense, playful, retro…) before choosing sounds.

## 1. Instant synth effects (no files)
```js
audio.sfx('coin');                      // presets: click coin jump hit explosion powerup laser win lose
audio.sfx('coin', { pitch: 1.2, volume: 0.2 });  // vary the pitch so repeated sounds don't get annoying
audio.note('C4', { type: 'triangle', duration: 0.3 });  // one note: name or Hz; type sine/square/sawtooth/triangle
```
Good for prototypes, puzzle "clicks" and chiptune games. To add your own preset, add an entry to `PRESETS` in
`src/engine/audio.js`. Each entry is a list of `[startHz, endHz, seconds, wave, delay]` tones, or `['noise', seconds]`.

## 2. Synth music loops
```js
audio.sequence({ bpm: 120, notes: ['C4', 'E4', 'G4', null, 'A4', null, 'G4', 'E4'], type: 'square', volume: 0.08 });
```
`null` is a rest. One note plays per step (two steps per beat by default). Students can compose their own melody.

## 3. Real recorded sounds and music (download)
Real sounds make a game feel much less like a tech demo than synth blips.
Free sources: **kenney.nl/assets** (audio packs: interface, impact, sci-fi, RPG, jingles; CC0),
**freesound.org** (filter by licence: Creative Commons 0), **opengameart.org** (check the licence of each file;
prefer CC0), **pixabay.com/sound-effects** and **pixabay.com/music** (Pixabay licence). Generators: **sfxr.me**
or **jsfxr** for retro sounds you export as WAV.

Put files in `public/assets/sounds/<pack>/` or `public/assets/music/`, and add each one to
`public/assets/CREDITS.md`. Use `.ogg` or `.mp3`, keep them short and small (music under ~3 MB: the Claude
artifact deploy has a 16 MB limit for everything), and write each path as a plain `'/assets/…'` string.

```js
const STEPS = [0, 1, 2].map((i) => `/assets/sounds/my-pack/tap_00${i}.ogg`);
export const ASSETS = STEPS;                         // built paths must also be listed for the deploy build
await audio.preload(...STEPS);                       // optional: no delay the first time
audio.play(STEPS[Math.floor(Math.random() * STEPS.length)], { volume: 0.5, rate: 0.9 + Math.random() * 0.2 });
audio.music('/assets/music/my-theme.ogg', { volume: 0.6 });    // loops on the music channel
audio.stopMusic();
```
Packs often have several takes of the same sound (`_000 … _004`): pick one at random (and vary `rate`) so
repeated actions don't sound robotic. The few sounds and tracks already in `public/assets/` belong to the
Orb Othello showcase (CC0, credited); they may be reused.

## Adaptive music (layers that follow the action)
```js
const music = await audio.musicLayers(
  { calm: '/assets/music/calm.ogg', intense: '/assets/music/intense.ogg' },
  { volume: 0.5, xfade: 4 },            // each track loops with a 4 s crossfade (no seam, no click)
);
music.setIntensity(1, 6);               // 0 = first layer … 1 = last layer, equal-power fade over 6 s
music.duck(0.3, 1.2);                   // dip the music under a big moment, then recover
music.muffle(900);  music.muffle(null); // low-pass for menus / pause, and back
music.stop();                           // or audio.stopMusic()
```
Drive intensity from real game state with hysteresis (go up at one threshold, come down at a lower one) so it
doesn't flap every move. `orb-othello` goes intense when the board is half full and the score is close.

## Mixing and controls
- Channels: `audio.setVolume('master' | 'sfx' | 'music', 0..1)`. Add a mute button: `ui.button('🔊', …)`. `orb-othello` shows how.
- Browsers start audio only after the first click or key press. Starting music from the "Start" menu button is the natural place.
- Every player action should make a sound. Big events (solved, failed, level up) deserve bigger sounds plus a visual effect (see `effects-polish`).
- Keep music quieter than effects (music volume ~0.4–0.6) so actions stay readable.
