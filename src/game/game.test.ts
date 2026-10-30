import { describe, expect, it } from 'vitest';
import {
  DYING_TIME,
  LEVEL_INTRO,
  OVERDRIVE_DURATION,
  POINTS,
  WARP_TIME,
  createGame,
  playerLane,
  spawnEnemy,
  startGame,
  update,
} from './game';
import type { FrameInput, Game } from './types';

const DT = 1 / 120;
const idle: FrameInput = { move: 0, fire: false, overdrive: false, start: false };

/** A game in the playing state with no scheduled spawns, past the intro. */
function playing(): Game {
  const g = createGame(42);
  startGame(g);
  g.spawnQueue = [];
  g.levelTime = LEVEL_INTRO;
  g.events = [];
  return g;
}

function run(g: Game, seconds: number, input: Partial<FrameInput> = {}): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) update(g, { ...idle, ...input }, DT);
}

describe('game', () => {
  it('starts from the title screen', () => {
    const g = createGame(1);
    expect(g.mode).toBe('title');
    update(g, { ...idle, start: true }, DT);
    expect(g.mode).toBe('playing');
    expect(g.level).toBe(1);
  });

  it('shoots an enemy in the player lane but not in other lanes', () => {
    const g = playing();
    const lane = playerLane(g);
    const target = spawnEnemy(g, 'drifter', lane + 0.5, 0.6);
    const other = spawnEnemy(g, 'drifter', lane + 2.5, 0.6);
    run(g, 0.5, { fire: true });
    expect(g.enemies).not.toContain(target);
    expect(g.enemies).toContain(other);
    expect(g.score).toBe(POINTS.drifter);
  });

  it('kills the player when a rim enemy reaches their lane', () => {
    const g = playing();
    spawnEnemy(g, 'drifter', playerLane(g) + 2.5, 0);
    run(g, 2);
    expect(g.mode).toBe('dying');
    run(g, DYING_TIME + 0.1);
    expect(g.mode).toBe('playing');
    expect(g.lives).toBe(2);
    expect(g.enemies.every((e) => e.depth > 0.8 && e.state === 'climb')).toBe(true);
  });

  it('splits a splitter into two drifters in neighbouring lanes', () => {
    const g = playing();
    const lane = playerLane(g);
    spawnEnemy(g, 'splitter', lane + 0.5, 0.5);
    run(g, 0.4, { fire: true });
    run(g, 0.01);
    const kids = g.enemies.filter((e) => e.kind === 'drifter');
    expect(kids).toHaveLength(2);
    expect(kids.map((e) => Math.floor(e.u)).sort()).toEqual(
      [(lane - 1 + g.web.lanes) % g.web.lanes, (lane + 1) % g.web.lanes].sort(),
    );
  });

  it('detonating a mine in the player lane is fatal', () => {
    const g = playing();
    spawnEnemy(g, 'mine', playerLane(g) + 0.5, 0.01);
    spawnEnemy(g, 'drifter', playerLane(g) + 4.5, 1); // keeps the level from clearing
    run(g, 0.5);
    expect(g.mode).toBe('dying');
  });

  it('a seeder drops a mine and retreats', () => {
    const g = playing();
    spawnEnemy(g, 'seeder', playerLane(g) + 3.5, 0.5);
    run(g, 1);
    expect(g.enemies.some((e) => e.kind === 'mine')).toBe(true);
    expect(g.enemies.find((e) => e.kind === 'seeder')!.state).toBe('retreat');
  });

  it('warps to the next level once all enemies are gone, clearing mines for a bonus', () => {
    const g = playing();
    spawnEnemy(g, 'mine', playerLane(g) + 3.5, 0.8);
    run(g, DT);
    expect(g.mode).toBe('warping');
    expect(g.score).toBe(POINTS.mine + 500);
    run(g, WARP_TIME + 0.1);
    expect(g.mode).toBe('playing');
    expect(g.level).toBe(2);
    expect(g.spawnQueue.length).toBeGreaterThan(0);
  });

  it('overdrive needs a full meter and makes shots pierce', () => {
    const g = playing();
    const lane = playerLane(g);
    spawnEnemy(g, 'drifter', lane + 5.5, 1); // keeps the level from clearing
    run(g, DT, { overdrive: true });
    expect(g.overdriveTime).toBe(0);
    g.overdrive = 1;
    spawnEnemy(g, 'drifter', lane + 0.5, 0.4);
    spawnEnemy(g, 'drifter', lane + 0.5, 0.7);
    update(g, { ...idle, overdrive: true, fire: true }, DT);
    expect(g.overdriveTime).toBeGreaterThan(OVERDRIVE_DURATION - 0.1);
    expect(g.shots[0].pierce).toBe(true);
    run(g, 0.4);
    expect(g.enemies.filter((e) => Math.floor(e.u) === lane)).toHaveLength(0);
  });

  it('awards an extra life every 20000 points', () => {
    const g = playing();
    g.score = 19990;
    spawnEnemy(g, 'drifter', playerLane(g) + 0.5, 0.3);
    run(g, 0.3, { fire: true });
    expect(g.lives).toBe(4);
  });

  it('ends the game when the last life is lost', () => {
    const g = playing();
    g.lives = 1;
    spawnEnemy(g, 'drifter', playerLane(g) + 0.5, 0);
    run(g, DYING_TIME + 0.2);
    expect(g.mode).toBe('gameover');
  });
});
