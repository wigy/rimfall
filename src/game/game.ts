import { createRng } from './rng';
import { SHAPE_COUNT, speedForLevel, waveForLevel, webForLevel } from './levels';
import { bottomLane, laneDelta, laneOf, wrapU } from './web';
import type { Enemy, EnemyKind, FrameInput, Game } from './types';

export const START_LIVES = 3;
export const EXTRA_LIFE_EVERY = 20000;
export const DYING_TIME = 1.6;
export const WARP_TIME = 2.2;
export const GAMEOVER_LOCK = 1.5;
export const TITLE_CYCLE = 5;
/** Enemies don't spawn and the level can't clear until the intro zoom finishes. */
export const LEVEL_INTRO = 1;

export const SHOT_SPEED = 2.4;
export const BOLT_SPEED = 0.55;
export const MINE_SPEED = 0.035;
export const RIM_SPEED = 1.5;
export const FIRE_COOLDOWN = 0.09;
export const OVERDRIVE_COOLDOWN = 0.045;
export const OVERDRIVE_DURATION = 5;
export const OVERDRIVE_PER_KILL = 0.04;
export const MAX_SHOTS = 8;
export const MAX_OVERDRIVE_SHOTS = 16;
/** A rim enemy kills the player when this close (in lanes) to the player's lane center. */
export const CONTACT_RANGE = 0.25;
export const SEEDER_DROP_DEPTH = 0.45;
export const SEEDER_MAX_DROPS = 3;

const CLIMB_SPEED: Record<EnemyKind, number> = { drifter: 0.16, weaver: 0.12, splitter: 0.1, seeder: 0.14, mine: MINE_SPEED };
const HP: Record<EnemyKind, number> = { drifter: 1, weaver: 1, splitter: 1, seeder: 2, mine: 1 };
export const POINTS: Record<EnemyKind | 'bolt', number> = {
  drifter: 150,
  weaver: 200,
  splitter: 100,
  seeder: 300,
  mine: 50,
  bolt: 10,
};

export function createGame(seed = Date.now(), hiScore = 0): Game {
  const web = webForLevel(1);
  return {
    mode: 'title',
    modeTime: 0,
    level: 1,
    levelTime: 0,
    score: 0,
    hiScore,
    lives: START_LIVES,
    nextLifeAt: EXTRA_LIFE_EVERY,
    web,
    speed: 1,
    player: { pos: bottomLane(web) + 0.5, fireCooldown: 0 },
    shots: [],
    bolts: [],
    enemies: [],
    spawnQueue: [],
    overdrive: 0,
    overdriveTime: 0,
    rng: createRng(seed),
    nextId: 1,
    events: [],
  };
}

export function startGame(g: Game): void {
  g.score = 0;
  g.lives = START_LIVES;
  g.nextLifeAt = EXTRA_LIFE_EVERY;
  g.overdrive = 0;
  g.overdriveTime = 0;
  setupLevel(g, 1);
}

export function setupLevel(g: Game, level: number): void {
  g.level = level;
  g.web = webForLevel(level);
  g.speed = speedForLevel(level);
  g.spawnQueue = waveForLevel(level, g.web.lanes, g.rng);
  g.enemies = [];
  g.shots = [];
  g.bolts = [];
  g.player.pos = bottomLane(g.web) + 0.5;
  g.player.fireCooldown = 0;
  g.levelTime = 0;
  setMode(g, 'playing');
  g.events.push({ type: 'levelStart', level });
}

function setMode(g: Game, mode: Game['mode']): void {
  g.mode = mode;
  g.modeTime = 0;
}

export function playerLane(g: Game): number {
  return laneOf(g.web, g.player.pos);
}

export function spawnEnemy(g: Game, kind: EnemyKind, u: number, depth = 1): Enemy {
  const e: Enemy = {
    id: g.nextId++,
    kind,
    u: wrapU(g.web, u),
    depth,
    hp: HP[kind],
    age: 0,
    state: depth <= 0 ? 'rim' : 'climb',
    baseU: wrapU(g.web, u),
    phase: g.rng.range(0, Math.PI * 2),
    fireTimer: g.rng.range(1, 3),
    drops: 0,
    dead: false,
  };
  g.enemies.push(e);
  return e;
}

export function update(g: Game, input: FrameInput, dt: number): void {
  g.modeTime += dt;
  switch (g.mode) {
    case 'title':
      if (input.start) startGame(g);
      else if (g.modeTime > TITLE_CYCLE) {
        // Attract mode: cycle through web shapes.
        const next = (g.level % SHAPE_COUNT) + 1;
        g.level = next;
        g.web = webForLevel(next);
        g.player.pos = bottomLane(g.web) + 0.5;
        g.modeTime = 0;
      }
      break;
    case 'gameover':
      if (input.start && g.modeTime > GAMEOVER_LOCK) startGame(g);
      break;
    case 'playing':
      updatePlaying(g, input, dt);
      break;
    case 'dying':
      if (g.modeTime > DYING_TIME) afterDeath(g);
      break;
    case 'warping':
      if (g.modeTime > WARP_TIME) setupLevel(g, g.level + 1);
      break;
  }
}

function updatePlaying(g: Game, input: FrameInput, dt: number): void {
  g.levelTime += dt;
  const { web, player } = g;

  player.pos = wrapU(web, player.pos + input.move);
  const lane = playerLane(g);

  if (input.overdrive && g.overdrive >= 1 && g.overdriveTime <= 0) {
    g.overdrive = 0;
    g.overdriveTime = OVERDRIVE_DURATION;
    g.events.push({ type: 'overdrive' });
  }
  const overdriven = g.overdriveTime > 0;
  g.overdriveTime = Math.max(0, g.overdriveTime - dt);

  player.fireCooldown -= dt;
  const maxShots = overdriven ? MAX_OVERDRIVE_SHOTS : MAX_SHOTS;
  if (input.fire && player.fireCooldown <= 0 && g.shots.length < maxShots) {
    g.shots.push({ lane, depth: 0, pierce: overdriven, hits: [] });
    player.fireCooldown = overdriven ? OVERDRIVE_COOLDOWN : FIRE_COOLDOWN;
    g.events.push({ type: 'shoot', lane, pierce: overdriven });
  }

  if (g.levelTime >= LEVEL_INTRO) {
    while (g.spawnQueue.length && g.spawnQueue[0].at <= g.levelTime - LEVEL_INTRO) {
      const s = g.spawnQueue.shift()!;
      spawnEnemy(g, s.kind, s.lane + 0.5);
    }
  }

  for (const e of g.enemies) {
    updateEnemy(g, e, dt);
    if (g.mode !== 'playing') return;
  }

  for (const b of g.bolts) {
    b.depth -= BOLT_SPEED * g.speed * dt;
    if (b.depth <= 0) {
      b.dead = true;
      if (b.lane === lane) return killPlayer(g);
    }
  }

  updateShots(g, dt);

  g.enemies = g.enemies.filter((e) => !e.dead);
  g.bolts = g.bolts.filter((b) => !b.dead);

  checkLevelClear(g);
}

function updateEnemy(g: Game, e: Enemy, dt: number): void {
  const { web } = g;
  e.age += dt;
  const climb = CLIMB_SPEED[e.kind] * g.speed * dt;

  if (e.state === 'rim') {
    const target = playerLane(g) + 0.5;
    const d = laneDelta(web, e.u, target);
    const step = Math.min(Math.abs(d), RIM_SPEED * g.speed * dt);
    e.u = wrapU(web, e.u + Math.sign(d) * step);
    if (Math.abs(laneDelta(web, e.u, target)) < CONTACT_RANGE) killPlayer(g);
    return;
  }

  switch (e.kind) {
    case 'drifter':
    case 'splitter':
      e.depth -= climb;
      break;
    case 'weaver':
      e.depth -= climb;
      e.u = wrapU(web, e.baseU + 1.4 * Math.sin(e.age * 1.7 + e.phase));
      e.fireTimer -= dt;
      if (e.fireTimer <= 0 && e.depth > 0.25) {
        const lane = laneOf(web, e.u);
        g.bolts.push({ lane, depth: e.depth, dead: false });
        g.events.push({ type: 'enemyFire', lane, depth: e.depth });
        e.fireTimer = g.rng.range(1.8, 3.6) / g.speed;
      }
      break;
    case 'seeder':
      if (e.state === 'retreat') {
        e.depth += climb * 1.2;
        if (e.depth >= 1) {
          e.depth = 1;
          e.u = g.rng.int(web.lanes) + 0.5;
          e.state = 'climb';
        }
        return;
      }
      e.depth -= climb;
      if (e.drops < SEEDER_MAX_DROPS && e.depth <= SEEDER_DROP_DEPTH) {
        spawnEnemy(g, 'mine', laneOf(web, e.u) + 0.5, e.depth);
        e.drops++;
        e.state = 'retreat';
      }
      break;
    case 'mine':
      e.depth -= climb;
      if (e.depth <= 0) {
        e.dead = true;
        g.events.push({ type: 'explode', u: e.u, depth: 0, kind: 'mine' });
        if (laneOf(web, e.u) === playerLane(g)) killPlayer(g);
      }
      return;
  }

  if (e.depth <= 0) {
    e.depth = 0;
    e.state = 'rim';
    e.u = wrapU(web, e.u);
  }
}

function updateShots(g: Game, dt: number): void {
  const { web } = g;
  const survivors = [];
  for (const s of g.shots) {
    const prev = s.depth;
    s.depth += SHOT_SPEED * dt;
    let spent = false;

    for (const b of g.bolts) {
      if (b.dead || b.lane !== s.lane) continue;
      if (b.depth >= prev - 0.03 && b.depth <= s.depth + 0.01) {
        b.dead = true;
        addScore(g, POINTS.bolt);
        g.events.push({ type: 'explode', u: b.lane + 0.5, depth: b.depth, kind: 'bolt' });
        if (!s.pierce) {
          spent = true;
          break;
        }
      }
    }

    if (!spent) {
      for (const e of g.enemies) {
        if (e.dead || laneOf(web, e.u) !== s.lane || s.hits.includes(e.id)) continue;
        if (e.depth >= prev - 0.03 && e.depth <= s.depth + 0.01) {
          damage(g, e);
          if (!s.pierce) {
            spent = true;
            break;
          }
          s.hits.push(e.id);
        }
      }
    }

    if (!spent && s.depth <= 1) survivors.push(s);
  }
  g.shots = survivors;
}

function damage(g: Game, e: Enemy): void {
  e.hp--;
  if (e.hp > 0) {
    g.events.push({ type: 'hit', u: e.u, depth: e.depth });
    return;
  }
  e.dead = true;
  addScore(g, POINTS[e.kind]);
  g.events.push({ type: 'explode', u: e.u, depth: e.depth, kind: e.kind });
  if (e.kind !== 'mine') g.overdrive = Math.min(1, g.overdrive + OVERDRIVE_PER_KILL);
  if (e.kind === 'splitter') {
    // Children start just above the parent so the shot that killed it can't hit them too.
    const depth = e.depth > 0 ? Math.min(1, e.depth + 0.04) : 0;
    spawnEnemy(g, 'drifter', laneOf(g.web, e.u) - 0.5, depth);
    spawnEnemy(g, 'drifter', laneOf(g.web, e.u) + 1.5, depth);
  }
}

export function addScore(g: Game, points: number): void {
  g.score += points;
  while (g.score >= g.nextLifeAt) {
    g.lives++;
    g.nextLifeAt += EXTRA_LIFE_EVERY;
    g.events.push({ type: 'extraLife' });
  }
  g.hiScore = Math.max(g.hiScore, g.score);
}

function killPlayer(g: Game): void {
  if (g.mode !== 'playing') return;
  setMode(g, 'dying');
  g.overdriveTime = 0;
  g.events.push({ type: 'playerDeath', lane: playerLane(g) });
}

function afterDeath(g: Game): void {
  g.lives--;
  if (g.lives <= 0) {
    setMode(g, 'gameover');
    g.events.push({ type: 'gameOver' });
    return;
  }
  // Survivors are pushed back to the far end; nearby mines and all bolts are cleared.
  g.bolts = [];
  g.shots = [];
  g.enemies = g.enemies.filter((e) => !e.dead && (e.kind !== 'mine' || e.depth > 0.3));
  for (const e of g.enemies) {
    if (e.kind === 'mine') continue;
    e.depth = 1;
    e.state = 'climb';
    e.baseU = e.u;
  }
  setMode(g, 'playing');
}

function checkLevelClear(g: Game): void {
  if (g.levelTime < LEVEL_INTRO || g.spawnQueue.length) return;
  if (g.enemies.some((e) => e.kind !== 'mine')) return;
  for (const m of g.enemies) {
    addScore(g, POINTS.mine);
    g.events.push({ type: 'explode', u: m.u, depth: m.depth, kind: 'mine' });
  }
  g.enemies = [];
  g.bolts = [];
  g.shots = [];
  addScore(g, 500 * g.level);
  setMode(g, 'warping');
  g.events.push({ type: 'warp' });
}
