// Every game in the project. The id (the key) goes in the URL: http://localhost:5173/?game=<id>
// To add a game, copy src/games/_template to src/games/<id>/ and add an entry here.
export const GAMES = {
  'orb-othello': {
    title: 'Orb Othello',
    description: 'Showcase board game: Othello on a living planet where rows wrap round the world. Optional cosmic rules (tectonic shifts, black holes, supernova stars, a moving night side), hot-seat or vs computer (time-sliced alpha-beta AI), adaptive music, cinematic effects.',
    load: () => import('./orb-othello/index.js'),
  },
  template: {
    title: 'Blank Template',
    description: 'The starting point for your own game.',
    load: () => import('./_template/index.js'),
  },
};
