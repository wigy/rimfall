/**
 * The "web" is the tube the game is played on: a polyline of rim points
 * extruded into depth. Lane i lies between rim points i and i+1.
 *
 * Lateral positions are expressed as `u` in lane units: lane i spans
 * [i, i+1) and its center is i + 0.5. Closed webs wrap around, open webs clamp.
 */
export interface Vec2 {
  x: number;
  y: number;
}

export interface Web {
  name: string;
  points: Vec2[];
  closed: boolean;
  lanes: number;
}

export function makeWeb(name: string, points: Vec2[], closed: boolean): Web {
  let pts = points;
  // Closed webs are wound counter-clockwise on screen (y down), so that +u
  // moves right along the bottom of the shape, matching open webs.
  if (closed && signedArea(pts) > 0) pts = [...pts].reverse();
  return { name, points: pts, closed, lanes: closed ? pts.length : pts.length - 1 };
}

function signedArea(points: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function wrapU(web: Web, u: number): number {
  const n = web.lanes;
  if (web.closed) return ((u % n) + n) % n;
  return Math.min(Math.max(u, 0), n - 1e-6);
}

export function laneOf(web: Web, u: number): number {
  return Math.floor(wrapU(web, u));
}

export function laneCenter(web: Web, u: number): number {
  return laneOf(web, u) + 0.5;
}

/** Signed shortest lateral distance from `from` to `to`, in lane units. */
export function laneDelta(web: Web, from: number, to: number): number {
  const d = to - from;
  if (!web.closed) return d;
  const n = web.lanes;
  return ((((d + n / 2) % n) + n) % n) - n / 2;
}

export function laneEdges(web: Web, lane: number): [Vec2, Vec2] {
  const len = web.points.length;
  return [web.points[lane], web.points[(lane + 1) % len]];
}

/** Point on the rim polyline at lateral position u. */
export function rimPoint(web: Web, u: number): Vec2 {
  const w = wrapU(web, u);
  const i = Math.floor(w);
  const f = w - i;
  const [a, b] = laneEdges(web, i);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

/** The lane whose center is lowest on screen; where the player starts. */
export function bottomLane(web: Web): number {
  let best = 0;
  let bestY = -Infinity;
  for (let i = 0; i < web.lanes; i++) {
    const p = rimPoint(web, i + 0.5);
    if (p.y > bestY + 1e-9) {
      bestY = p.y;
      best = i;
    }
  }
  return best;
}
