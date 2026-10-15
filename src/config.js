// Project-wide settings. Each game keeps its own settings inside its own folder.
export const CONFIG = {
  title: 'Game Lab 3D',
  // You: `npm run submit` names your zip <studentId>_<Student_Name>.zip, e.g. 66070501234_Somchai_Jaidee.zip.
  studentId: '6xxxxxxxxxx',
  studentName: 'Student Name',
  // The game that opens first. null shows the game menu. Set this to your game's id,
  // e.g. 'my-game', and `npm run dev` opens straight into it. (?game=<id> in the URL also works.)
  startGame: null,
  settings: {
    shadows: true,
    maxPixelRatio: 2, // lower to 1 on slow laptops
    // Graphics quality: 'auto' starts high and steps down if the frame rate drops (school laptops).
    // 'low' = no ambient occlusion, sharper-but-cheaper anti-aliasing, smaller shadow maps.
    quality: 'auto', // 'auto' | 'low' | 'medium' | 'high'
  },
};
