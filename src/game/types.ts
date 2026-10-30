import type { Rng } from './rng';
import type { SpawnEntry } from './levels';
import type { Web } from './web';

export type EnemyKind = 'drifter' | 'weaver' | 'splitter' | 'seeder' | 'mine';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  /** Lateral position in lane units (lane center = lane + 0.5). */
  u: number;
  /** 0 = player's rim, 1 = far end of the web. */
  depth: number;
  hp: number;
  /** Seconds since spawn. */
  age: number;
  /** climb: moving toward the rim. rim: chasing the player along the rim. retreat: seeder heading back down. */
  state: 'climb' | 'rim' | 'retreat';
  /** Lane a weaver oscillates around. */
  baseU: number;
  /** Per-enemy random phase (weaver wobble, mine spin). */
  phase: number;
  fireTimer: number;
  /** Mines a seeder has dropped so far. */
  drops: number;
  dead: boolean;
}

export interface Shot {
  lane: number;
  depth: number;
  pierce: boolean;
  hits: number[];
}

export interface Bolt {
  lane: number;
  depth: number;
  dead: boolean;
}

export type Mode = 'title' | 'playing' | 'dying' | 'warping' | 'gameover';

export type GameEvent =
  | { type: 'shoot'; lane: number; pierce: boolean }
  | { type: 'explode'; u: number; depth: number; kind: EnemyKind | 'bolt' }
  | { type: 'hit'; u: number; depth: number }
  | { type: 'enemyFire'; lane: number; depth: number }
  | { type: 'playerDeath'; lane: number }
  | { type: 'warp' }
  | { type: 'levelStart'; level: number }
  | { type: 'overdrive' }
  | { type: 'extraLife' }
  | { type: 'gameOver' };

export interface Game {
  mode: Mode;
  /** Seconds since the current mode began. */
  modeTime: number;
  level: number;
  /** Seconds since the current level (or post-death restart) began. */
  levelTime: number;
  score: number;
  hiScore: number;
  lives: number;
  nextLifeAt: number;
  web: Web;
  speed: number;
  player: { pos: number; fireCooldown: number };
  shots: Shot[];
  bolts: Bolt[];
  enemies: Enemy[];
  spawnQueue: SpawnEntry[];
  /** Overdrive meter, 0..1. Full meter can be spent for a burst of piercing rapid fire. */
  overdrive: number;
  overdriveTime: number;
  rng: Rng;
  nextId: number;
  /** Drained by the host each frame to drive audio and particles. */
  events: GameEvent[];
}

export interface FrameInput {
  /** Lanes to move this step (signed, may be fractional). */
  move: number;
  fire: boolean;
  overdrive: boolean;
  start: boolean;
}
