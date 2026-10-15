// Players, turns and scores for 1–N player games (hot-seat or AI). No Three.js, no DOM.
//
//   const players = createPlayers([
//     { name: 'Ana', color: '#ff6b6b', controller: 'human' },
//     { name: 'Bot', color: '#2ec4b6', controller: 'ai' },
//   ]);
//   players.current        → the player whose turn it is ({ name, color, controller, score, index, … })
//   players.next()         → advance the turn (skips players with .out = true), emits 'turn'
//   players.addScore(1, 5) → +5 points for player 1, emits 'score'
//   players.on('turn', (p) => …)
import { createEvents } from './events.js';

export function createPlayers(list, { first = 0 } = {}) {
  const events = createEvents();
  const all = list.map((p, index) => ({ controller: 'human', score: 0, out: false, ...p, index }));
  let turn = first;

  return {
    on: events.on,
    all,
    get count() {
      return all.length;
    },
    get current() {
      return all[turn];
    },
    get index() {
      return turn;
    },
    get(i) {
      return all[i];
    },
    isAI: (i = turn) => all[i].controller !== 'human',
    setTurn(i) {
      turn = i;
      events.emit('turn', all[turn]);
    },
    next() {
      if (all.every((p) => p.out)) return all[turn];
      do turn = (turn + 1) % all.length;
      while (all[turn].out);
      events.emit('turn', all[turn]);
      return all[turn];
    },
    addScore(i, points = 1) {
      all[i].score += points;
      events.emit('score', all[i]);
    },
    leader: () => all.reduce((best, p) => (p.score > best.score ? p : best), all[0]),
    reset({ keepScores = false } = {}) {
      turn = first;
      for (const p of all) {
        p.out = false;
        if (!keepScores) p.score = 0;
      }
      events.emit('turn', all[turn]);
    },
  };
}
