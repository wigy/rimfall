import type { Rng } from './rng';
import { makeWeb, type Vec2, type Web } from './web';
import type { EnemyKind } from './types';

type Curve = (t: number) => Vec2;

/** Sample a curve and resample it at equal arc-length steps so lanes are equally wide. */
function resample(curve: Curve, lanes: number, closed: boolean): Vec2[] {
  const samples = 2000;
  const pts: Vec2[] = [];
  const cum: number[] = [0];
  for (let i = 0; i <= samples; i++) {
    pts.push(curve(i / samples));
    if (i > 0) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = cum[samples];
  const count = closed ? lanes : lanes + 1;
  const out: Vec2[] = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const target = (k * total) / lanes;
    while (j < samples - 1 && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const f = Math.min(Math.max((target - cum[j]) / seg, 0), 1);
    out.push({ x: pts[j].x + (pts[j + 1].x - pts[j].x) * f, y: pts[j].y + (pts[j + 1].y - pts[j].y) * f });
  }
  return out;
}

/** Subdivide each polygon edge into `perEdge` lanes. */
function subdivide(verts: Vec2[], perEdge: number, closed: boolean): Vec2[] {
  const out: Vec2[] = [];
  const edges = closed ? verts.length : verts.length - 1;
  for (let e = 0; e < edges; e++) {
    const a = verts[e];
    const b = verts[(e + 1) % verts.length];
    for (let s = 0; s < perEdge; s++) {
      const f = s / perEdge;
      out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
    }
  }
  if (!closed) out.push(verts[verts.length - 1]);
  return out;
}

/** Curve tracing straight segments through the given vertices. */
function polyline(verts: Vec2[]): Curve {
  const segs = verts.length - 1;
  return (t) => {
    const s = Math.min(Math.floor(t * segs), segs - 1);
    const f = t * segs - s;
    const a = verts[s];
    const b = verts[s + 1];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  };
}

function regular(sides: number, radius: number, rotation: number): Vec2[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = rotation + (i / sides) * Math.PI * 2;
    return { x: Math.cos(a) * radius, y: Math.sin(a) * radius };
  });
}

const TAU = Math.PI * 2;

/** Open webs are lowered below the camera so their depth reads clearly instead of collapsing edge-on. */
function openWeb(name: string, points: Vec2[]): Web {
  const minY = Math.min(...points.map((p) => p.y));
  return makeWeb(name, points.map((p) => ({ x: p.x, y: p.y - minY + 0.15 })), false);
}

const SHAPES: (() => Web)[] = [
  () => makeWeb('Ring', resample((t) => ({ x: Math.cos(t * TAU), y: Math.sin(t * TAU) }), 16, true), true),
  () => makeWeb('Box', subdivide(regular(4, 1.25, Math.PI / 4), 4, true), true),
  () => openWeb('Chevron', subdivide([{ x: -1, y: -0.2 }, { x: 0, y: 0.75 }, { x: 1, y: -0.2 }], 7, false)),
  () =>
    makeWeb(
      'Cross',
      [
        [-0.33, -1], [0.33, -1], [0.33, -0.33], [1, -0.33], [1, 0.33], [0.33, 0.33],
        [0.33, 1], [-0.33, 1], [-0.33, 0.33], [-1, 0.33], [-1, -0.33], [-0.33, -0.33],
      ].map(([x, y]) => ({ x, y })),
      true,
    ),
  () =>
    makeWeb(
      'Bloom',
      resample((t) => {
        const r = 0.85 + 0.17 * Math.cos(5 * t * TAU);
        return { x: Math.cos(t * TAU) * r, y: Math.sin(t * TAU) * r };
      }, 20, true),
      true,
    ),
  () => openWeb('Ledge', subdivide([{ x: -1.1, y: 0.35 }, { x: 1.1, y: 0.35 }], 14, false)),
  () => makeWeb('Delta', subdivide(regular(3, 1.15, -Math.PI / 2), 5, true), true),
  () =>
    openWeb('Bowl', resample((t) => ({ x: -Math.cos(t * Math.PI), y: Math.sin(t * Math.PI) * 0.85 - 0.2 }), 14, false)),
  () =>
    makeWeb(
      'Octastar',
      Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * TAU - Math.PI / 2;
        const r = i % 2 === 0 ? 1.1 : 0.6;
        return { x: Math.cos(a) * r, y: Math.sin(a) * r };
      }),
      true,
    ),
  () =>
    openWeb('Swell', resample((t) => ({ x: -1.1 + t * 2.2, y: 0.2 + Math.sin(t * TAU * 1.5) * 0.3 }), 15, false)),
  () =>
    makeWeb(
      'Capsule',
      resample((t) => {
        const a = t * TAU;
        return { x: Math.cos(a) * 1.15, y: Math.sin(a) * (0.55 + 0.25 * Math.cos(a) ** 2) };
      }, 16, true),
      true,
    ),
  () =>
    openWeb('Steps',
      resample(
        polyline([{ x: -1.1, y: -0.2 }, { x: -0.55, y: -0.2 }, { x: -0.55, y: 0.35 }, { x: 0.55, y: 0.35 }, { x: 0.55, y: -0.2 }, { x: 1.1, y: -0.2 }]),
        12, // corners land exactly on lane boundaries
        false,
      ),
    ),
];

export const SHAPE_COUNT = SHAPES.length;

export function webForLevel(level: number): Web {
  return SHAPES[(level - 1) % SHAPES.length]();
}

/** Speed multiplier applied to all enemy movement for a level. */
export function speedForLevel(level: number): number {
  return Math.min(1 + (level - 1) * 0.07, 2.2);
}

export interface SpawnEntry {
  at: number;
  kind: Exclude<EnemyKind, 'mine'>;
  lane: number;
}

export function unlockedKinds(level: number): SpawnEntry['kind'][] {
  const kinds: SpawnEntry['kind'][] = ['drifter'];
  if (level >= 2) kinds.push('weaver');
  if (level >= 3) kinds.push('splitter');
  if (level >= 4) kinds.push('seeder');
  return kinds;
}

const WEIGHTS: Record<SpawnEntry['kind'], number> = { drifter: 5, weaver: 3, splitter: 2, seeder: 1 };
const MAX_SEEDERS = 3;

export function waveForLevel(level: number, lanes: number, rng: Rng): SpawnEntry[] {
  const count = Math.min(10 + level * 2, 40);
  const interval = Math.max(0.45, 1.6 - level * 0.08);
  const kinds = unlockedKinds(level);
  const entries: SpawnEntry[] = [];
  let seeders = 0;
  let t = 1.2;
  for (let i = 0; i < count; i++) {
    const pool = kinds.filter((k) => k !== 'seeder' || seeders < MAX_SEEDERS);
    const total = pool.reduce((s, k) => s + WEIGHTS[k], 0);
    let roll = rng.next() * total;
    let kind = pool[0];
    for (const k of pool) {
      roll -= WEIGHTS[k];
      if (roll < 0) {
        kind = k;
        break;
      }
    }
    if (kind === 'seeder') seeders++;
    entries.push({ at: t, kind, lane: rng.int(lanes) });
    t += interval * (0.5 + rng.next());
  }
  return entries;
}
