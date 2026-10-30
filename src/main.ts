import { createGame, setupLevel, update } from './game/game';
import { Renderer } from './render/renderer';
import { Sfx } from './audio/sfx';
import { Input } from './input';

const STEP = 1 / 120;
const HI_KEY = 'rimfall.hiscore';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const sfx = new Sfx();
const input = new Input(canvas, () => sfx.unlock());
const game = createGame(Date.now(), Number(localStorage.getItem(HI_KEY)) || 0);

// Dev-only handle for poking at state from the console or Playwright, e.g. setupLevel(game, 5).
if (import.meta.env.DEV) Object.assign(window, { game, setupLevel });

let paused = false;
let last = performance.now();
let acc = 0;
let savedHi = game.hiScore;

window.addEventListener('resize', () => renderer.resize());
window.addEventListener('blur', () => {
  if (game.mode === 'playing') paused = true;
});
canvas.addEventListener('click', () => {
  if (game.mode === 'playing') input.requestPointerLock();
});

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (input.consume('KeyP') || (paused && input.consume('Escape'))) paused = !paused;
  if (input.consume('KeyM')) sfx.toggleMute();

  if (!paused) {
    acc += dt;
    while (acc >= STEP) {
      update(game, input.frame(STEP), STEP);
      acc -= STEP;
    }
  } else {
    input.frame(STEP); // discard input while paused
  }

  if (game.events.length) {
    renderer.handleEvents(game, game.events);
    sfx.play(game.events);
    if (game.events.some((e) => e.type === 'gameOver') && document.pointerLockElement) document.exitPointerLock();
    game.events.length = 0;
  }
  if (game.hiScore > savedHi) {
    savedHi = game.hiScore;
    localStorage.setItem(HI_KEY, String(savedHi));
  }

  renderer.render(game, dt, paused);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
