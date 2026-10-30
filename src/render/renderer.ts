import { DYING_TIME, LEVEL_INTRO, OVERDRIVE_DURATION, WARP_TIME, playerLane } from '../game/game';
import type { EnemyKind, Game, GameEvent } from '../game/types';
import { laneEdges, laneOf, rimPoint, type Vec2 } from '../game/web';

/** World-space length of the tube; rim points are roughly unit radius. */
const DEPTH = 3.2;
/** Camera distance from the near rim at rest. */
const NEAR = 1.6;
/** Camera height (y down); negative looks down into the tube. */
const CAM_Y = -0.25;
const NEAR_CLIP = 0.12;

/** Per-level web palettes: rim line color and a secondary accent for gradients. */
const WEB_PALETTES: [string, string][] = [
  ['#3d7bff', '#7a4dff'],
  ['#ff3d6e', '#ff8a3d'],
  ['#f2e94e', '#4effa0'],
  ['#2ee6ff', '#3d7bff'],
  ['#4effa0', '#2ee6ff'],
  ['#c45cff', '#ff3d9e'],
];
const PLAYER_COLOR = '#ffe14d';
const OVERDRIVE_COLOR = '#6ff7ff';
const ENEMY_COLORS: Record<EnemyKind | 'bolt', string> = {
  drifter: '#ff3d5f',
  weaver: '#ff52e8',
  splitter: '#9b74ff',
  seeder: '#3dffa0',
  mine: '#ffb23d',
  bolt: '#e8f4ff',
};
const FONT = '"Segoe UI", "Helvetica Neue", system-ui, sans-serif';

type Local = [number, number];

const SHAPES: Record<EnemyKind | 'bolt' | 'player', Local[][]> = {
  drifter: [
    [[-0.75, 0], [0, 0.75], [0.75, 0], [0, -0.75]],
    [[-0.3, 0], [0, 0.3], [0.3, 0], [0, -0.3]],
  ],
  weaver: [[[-0.8, -0.55], [0, -0.12], [0.8, -0.55], [0.8, 0.55], [0, 0.12], [-0.8, 0.55]]],
  splitter: [
    Array.from({ length: 6 }, (_, i): Local => [Math.cos((i / 6) * Math.PI * 2) * 0.8, Math.sin((i / 6) * Math.PI * 2) * 0.8]),
    Array.from({ length: 6 }, (_, i): Local => [Math.cos((i / 6) * Math.PI * 2 + Math.PI / 6) * 0.35, Math.sin((i / 6) * Math.PI * 2 + Math.PI / 6) * 0.35]),
  ],
  seeder: [
    [[-0.6, -0.6], [0.6, -0.6], [0.6, 0.6], [-0.6, 0.6]],
    [[-0.25, -0.25], [0.25, -0.25], [0.25, 0.25], [-0.25, 0.25]],
  ],
  mine: [[[0, -0.55], [0.14, -0.14], [0.55, 0], [0.14, 0.14], [0, 0.55], [-0.14, 0.14], [-0.55, 0], [-0.14, -0.14]]],
  bolt: [[[0, -0.28], [0.2, 0], [0, 0.28], [-0.2, 0]]],
  player: [[[-1, 0], [-0.55, 0.6], [-0.3, 0.25], [0.3, 0.25], [0.55, 0.6], [1, 0], [0, -0.25]]],
};

interface Particle {
  kind: 'spark' | 'ring';
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Ring radius / growth for ring particles. */
  r: number;
  vr: number;
  life: number;
  max: number;
  color: string;
  width: number;
}

interface Star {
  x: number;
  y: number;
  z: number;
  tw: number;
}

interface Frame {
  center: Vec2;
  across: Vec2;
  toward: Vec2;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t * t * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Depth fog: things farther down the tube are dimmer. */
const fog = (depth: number) => 1 - 0.55 * clamp01(depth);

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private bloomA = document.createElement('canvas');
  private bloomB = document.createElement('canvas');
  private bloomCtxA: CanvasRenderingContext2D;
  private bloomCtxB: CanvasRenderingContext2D;
  private bloomSupported: boolean;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private scale = 1;
  private cx = 0;
  private cy = 0;
  private fittedWeb: Game['web'] | null = null;
  private camZ = -NEAR;
  private particles: Particle[] = [];
  private stars: Star[] = [];
  private flash = 0;
  private flashColor = '#ffffff';
  private shake = 0;
  private time = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    const a = this.bloomA.getContext('2d');
    const b = this.bloomB.getContext('2d');
    if (!ctx || !a || !b) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    this.bloomCtxA = a;
    this.bloomCtxB = b;
    // Bloom relies on canvas filters; without them we fall back to stroked halos.
    a.filter = 'blur(2px)';
    this.bloomSupported = a.filter === 'blur(2px)';
    for (let i = 0; i < 180; i++) this.stars.push(this.newStar(Math.random() * 14));
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.bloomA.width = Math.max(1, Math.round(this.w / 4));
    this.bloomA.height = Math.max(1, Math.round(this.h / 4));
    this.bloomB.width = Math.max(1, Math.round(this.w / 8));
    this.bloomB.height = Math.max(1, Math.round(this.h / 8));
    this.fittedWeb = null;
  }

  /** HUD text size, shared by layout and HUD drawing. */
  private hudSize(): number {
    return Math.max(14, Math.min(this.w, this.h) * 0.032);
  }

  /**
   * Scale and center the web's near rim (its largest on-screen outline at rest)
   * into the band between the top HUD rows and the bottom overdrive meter.
   */
  private fitWeb(web: Game['web']): void {
    if (this.fittedWeb === web) return;
    this.fittedWeb = web;
    const s = this.hudSize();
    const top = s * 4;
    const bottom = this.h - s * 3;
    const xs = web.points.map((p) => p.x);
    const ys = web.points.map((p) => p.y - CAM_Y);
    const [xMin, xMax] = [Math.min(...xs), Math.max(...xs)];
    const [yMin, yMax] = [Math.min(...ys), Math.max(...ys)];
    // Margin leaves room for the player ship, which pokes out past the rim.
    const margin = 1.12;
    this.scale = Math.min(
      (this.w * 0.9) / ((xMax - xMin) * margin),
      (bottom - top) / ((yMax - yMin) * margin),
      Math.min(this.w, this.h) * 0.45,
    );
    this.cx = this.w / 2 - ((xMin + xMax) / 2) * this.scale;
    this.cy = (top + bottom) / 2 - ((yMin + yMax) / 2) * this.scale;
  }

  private project(p: Vec2, depth: number): Vec2 | null {
    const z = depth * DEPTH - this.camZ;
    if (z < NEAR_CLIP) return null;
    const k = (this.scale * NEAR) / z;
    return { x: this.cx + p.x * k, y: this.cy + (p.y - CAM_Y) * k };
  }

  private updateCamera(g: Game): number {
    // Returns the depth at which to draw the player.
    if (g.mode === 'warping') {
      const travel = easeIn(Math.min(g.modeTime / WARP_TIME, 1)) * (DEPTH + 0.8);
      this.camZ = -NEAR + travel;
      return travel / DEPTH;
    }
    if (g.mode === 'playing' && g.levelTime < LEVEL_INTRO) {
      this.camZ = -NEAR - (1 - easeOut(g.levelTime / LEVEL_INTRO)) * 10;
      return 0;
    }
    if (g.mode === 'title') {
      this.camZ = -NEAR - 2.4 - Math.sin(this.time * 0.6) * 0.3;
      return 0;
    }
    this.camZ = -NEAR;
    return 0;
  }

  /** Spawn particles for game events. Call before the game drains its event list. */
  handleEvents(g: Game, events: GameEvent[]): void {
    for (const ev of events) {
      if (ev.type === 'explode') {
        const p = this.project(rimPoint(g.web, ev.u), ev.depth);
        if (!p) continue;
        const color = ENEMY_COLORS[ev.kind];
        const near = 1.4 - ev.depth;
        if (ev.kind === 'bolt') {
          this.sparks(p, color, 8, 110 * near);
        } else {
          this.sparks(p, color, 26, 260 * near);
          this.sparks(p, '#ffffff', 8, 160 * near);
          this.ring(p, color, 70 * near, 0.45, 3);
        }
      } else if (ev.type === 'hit') {
        const p = this.project(rimPoint(g.web, ev.u), ev.depth);
        if (p) this.sparks(p, '#ffffff', 8, 140);
      } else if (ev.type === 'playerDeath') {
        const p = this.project(rimPoint(g.web, ev.lane + 0.5), 0);
        if (p) {
          this.sparks(p, PLAYER_COLOR, 90, 480);
          this.sparks(p, '#ffffff', 40, 300);
          this.ring(p, PLAYER_COLOR, 420, 0.9, 5);
          this.ring(p, '#ffffff', 240, 0.6, 3);
        }
        this.flash = 1;
        this.flashColor = '#ffffff';
        this.shake = 1;
      } else if (ev.type === 'overdrive') {
        this.flash = 0.5;
        this.flashColor = OVERDRIVE_COLOR;
        this.shake = 0.3;
      } else if (ev.type === 'warp') {
        this.flash = 0.35;
        this.flashColor = '#ffffff';
      }
    }
  }

  private sparks(p: Vec2, color: string, count: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.25 + Math.random() * 0.75);
      const life = 0.35 + Math.random() * 0.65;
      this.particles.push({
        kind: 'spark', x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        r: 0, vr: 0, life, max: life, color, width: 1.5 + Math.random() * 1.5,
      });
    }
  }

  private ring(p: Vec2, color: string, radius: number, life: number, width: number): void {
    this.particles.push({ kind: 'ring', x: p.x, y: p.y, vx: 0, vy: 0, r: 4, vr: radius / life, life, max: life, color, width });
  }

  private newStar(z = 14): Star {
    return { x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 10, z, tw: Math.random() * Math.PI * 2 };
  }

  render(g: Game, dt: number, paused: boolean): void {
    const { ctx } = this;
    const step = paused ? 0 : dt;
    this.time += step;

    this.fitWeb(g.web);
    const playerDepth = this.updateCamera(g);
    const [webColor, webAccent] = WEB_PALETTES[(g.level - 1) % WEB_PALETTES.length];
    const warping = g.mode === 'warping';

    // Scene is drawn additively onto a transparent canvas, bloomed, and only then
    // composited over the background, so the background itself never blooms.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const shakeAmt = this.shake * this.shake * 14;
    ctx.setTransform(
      this.dpr, 0, 0, this.dpr,
      (Math.random() - 0.5) * shakeAmt * this.dpr,
      (Math.random() - 0.5) * shakeAmt * this.dpr,
    );
    this.shake = Math.max(0, this.shake - step * 2);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    this.drawStars(warping ? 9 + g.modeTime * 16 : 0.5, step);

    const showPlayer = g.mode === 'playing' || g.mode === 'warping' || (g.mode === 'dying' && g.modeTime < 0.05);
    this.drawWeb(g, webColor, webAccent, showPlayer ? playerLane(g) : -1);

    if (g.mode !== 'title') {
      for (const s of g.shots) this.drawShot(g, s.lane + 0.5, s.depth, s.pierce);
      for (const b of g.bolts) this.drawThing(g, b.lane + 0.5, b.depth, SHAPES.bolt, ENEMY_COLORS.bolt, 1, this.time * 8, 0.35);
      for (const e of g.enemies) {
        const spin = e.kind === 'mine' ? this.time * 3 + e.phase : e.kind === 'seeder' ? this.time * 1.5 : 0;
        const pulse = e.kind === 'mine' ? 0.85 + 0.25 * Math.sin(this.time * 9 + e.phase) : 1;
        const hurt = e.kind === 'seeder' && e.hp < 2;
        const rimGlow = e.state === 'rim' ? 0.35 + 0.25 * Math.sin(this.time * 14) : 0.22;
        this.drawThing(g, e.u, e.depth, SHAPES[e.kind], hurt ? '#c8ffe2' : ENEMY_COLORS[e.kind], pulse, spin, rimGlow);
      }
      if (showPlayer) this.drawPlayer(g, playerDepth);
    }

    this.drawParticles(step);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.bloom();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground(g, webColor);
    this.drawVignette();

    if (this.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(this.flashColor, this.flash * 0.3);
      ctx.fillRect(0, 0, this.w, this.h);
      this.flash = Math.max(0, this.flash - dt * 2.5);
    }

    ctx.globalCompositeOperation = 'source-over';
    this.drawHud(g, paused);
  }

  private bloom(): void {
    if (!this.bloomSupported) return;
    const { ctx, canvas } = this;
    const passes: [HTMLCanvasElement, CanvasRenderingContext2D, string, number][] = [
      [this.bloomA, this.bloomCtxA, 'blur(3px)', 0.9],
      [this.bloomB, this.bloomCtxB, 'blur(5px)', 0.8],
    ];
    for (const [c, bctx, filter, alpha] of passes) {
      bctx.globalCompositeOperation = 'copy';
      bctx.filter = filter;
      bctx.drawImage(canvas, 0, 0, c.width, c.height);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(c, 0, 0, canvas.width, canvas.height);
    }
    ctx.globalAlpha = 1;
  }

  private drawBackground(g: Game, webColor: string): void {
    const { ctx } = this;
    ctx.globalCompositeOperation = 'destination-over';
    const vp = this.project({ x: 0, y: 0 }, 1) ?? { x: this.w / 2, y: this.h / 2 };
    const r = Math.max(this.w, this.h) * 0.75;
    const glow = ctx.createRadialGradient(vp.x, vp.y, 0, vp.x, vp.y, r);
    const intensity = g.mode === 'warping' ? 0.16 + 0.2 * clamp01(g.modeTime / WARP_TIME) : 0.13;
    glow.addColorStop(0, rgba(webColor, intensity));
    glow.addColorStop(0.35, rgba(webColor, intensity * 0.3));
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.w, this.h);
    const base = ctx.createLinearGradient(0, 0, 0, this.h);
    base.addColorStop(0, '#05040f');
    base.addColorStop(1, '#010208');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  private drawVignette(): void {
    const { ctx } = this;
    ctx.globalCompositeOperation = 'source-over';
    const r = Math.hypot(this.w, this.h) / 2;
    const v = ctx.createRadialGradient(this.w / 2, this.h / 2, r * 0.45, this.w / 2, this.h / 2, r);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  private drawStars(speed: number, dt: number): void {
    const { ctx } = this;
    const k = this.scale * NEAR;
    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i];
      const prevZ = s.z;
      s.z -= speed * dt;
      if (s.z < 0.3) {
        this.stars[i] = this.newStar();
        continue;
      }
      const x = this.cx + (s.x / s.z) * k;
      const y = this.cy + (s.y / s.z) * k;
      const px = this.cx + (s.x / prevZ) * k;
      const py = this.cy + (s.y / prevZ) * k;
      const twinkle = 0.65 + 0.35 * Math.sin(this.time * 3 + s.tw);
      const a = Math.min(1, 2.2 / s.z) * twinkle;
      ctx.strokeStyle = `rgba(170,200,255,${a})`;
      ctx.lineWidth = Math.min(2.2, 4 / s.z + 0.6);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x + 0.01, y + 0.01);
      ctx.stroke();
    }
  }

  private drawWeb(g: Game, color: string, accent: string, activeLane: number): void {
    const { ctx } = this;
    const { web } = g;
    const len = web.points.length;
    const near = web.points.map((p) => this.project(p, 0));
    const far = web.points.map((p) => this.project(p, 1));

    // Translucent lane faces, alternating slightly for a paneled look.
    for (let i = 0; i < web.lanes; i++) {
      const j = (i + 1) % len;
      const [a, b, c, d] = [near[i], near[j], far[j], far[i]];
      if (!a || !b || !c || !d) continue;
      const active = i === activeLane;
      const grad = ctx.createLinearGradient((a.x + b.x) / 2, (a.y + b.y) / 2, (c.x + d.x) / 2, (c.y + d.y) / 2);
      if (active) {
        grad.addColorStop(0, rgba(PLAYER_COLOR, 0.2));
        grad.addColorStop(1, rgba(PLAYER_COLOR, 0.02));
      } else {
        const base = i % 2 ? 0.07 : 0.045;
        grad.addColorStop(0, rgba(accent, base));
        grad.addColorStop(1, rgba(color, base * 0.25));
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
      ctx.fill();
    }

    // Faint depth rings plus an energy pulse running up the tube.
    for (const d of [0.25, 0.5, 0.75]) this.strokeRing(g, d, rgba(color, 0.12 * fog(d)), 1);
    if (g.mode === 'playing' || g.mode === 'title') {
      const t = (this.time * 0.45) % 1;
      this.strokeRing(g, 1 - t, rgba(accent, 0.45 * Math.sin(t * Math.PI)), 2);
    }

    // Spokes fade with depth.
    for (let i = 0; i < len; i++) {
      const n = near[i];
      const f = far[i];
      if (!n || !f) continue;
      const onActive = activeLane >= 0 && (i === activeLane || i === (activeLane + 1) % len);
      const c = onActive ? PLAYER_COLOR : color;
      const grad = ctx.createLinearGradient(n.x, n.y, f.x, f.y);
      grad.addColorStop(0, rgba(c, onActive ? 0.95 : 0.8));
      grad.addColorStop(1, rgba(c, 0.18));
      ctx.strokeStyle = grad;
      ctx.lineWidth = onActive ? 2 : 1.3;
      ctx.beginPath();
      ctx.moveTo(n.x, n.y);
      ctx.lineTo(f.x, f.y);
      ctx.stroke();
    }

    this.strokeRing(g, 1, rgba(color, 0.4), 1.3);
    this.strokeRing(g, 0, rgba(color, 0.35), 7);
    this.strokeRing(g, 0, color, 2.4);
    this.strokeRing(g, 0, 'rgba(255,255,255,0.55)', 0.8);
  }

  private strokeRing(g: Game, depth: number, style: string, width: number): void {
    const { ctx } = this;
    const pts = g.web.points.map((p) => this.project(p, depth));
    const list = g.web.closed ? [...pts, pts[0]] : pts;
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    let pen = false;
    for (const p of list) {
      if (!p) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
      pen = true;
    }
    ctx.stroke();
  }

  private localPoints(frame: Frame, poly: Local[], size: number, spin: number): Vec2[] {
    const cos = Math.cos(spin);
    const sin = Math.sin(spin);
    return poly.map(([a0, b0]) => {
      const a = (a0 * cos - b0 * sin) * size;
      const b = (a0 * sin + b0 * cos) * size;
      return {
        x: frame.center.x + frame.across.x * a + frame.toward.x * b,
        y: frame.center.y + frame.across.y * a + frame.toward.y * b,
      };
    });
  }

  /** Draw a filled, outlined shape in the local frame of lane position u at the given depth. */
  private drawThing(g: Game, u: number, depth: number, shape: Local[][], color: string, size = 1, spin = 0, fill = 0.22): void {
    const frame = this.frameAt(g, u, depth);
    if (!frame) return;
    const f = fog(depth);
    shape.forEach((poly, idx) => {
      const pts = this.localPoints(frame, poly, size, spin);
      this.path(pts, poly.length > 2);
      if (idx === 0 && poly.length > 2) {
        this.ctx.fillStyle = rgba(color, fill * f);
        this.ctx.fill();
      }
      this.stroke(rgba(color, f), idx === 0 ? 2 : 1.4);
      if (idx === 0) this.stroke(rgba('#ffffff', 0.35 * f), 0.7);
    });
  }

  private drawShot(g: Game, u: number, depth: number, pierce: boolean): void {
    const { ctx } = this;
    const head = this.project(rimPoint(g.web, u), depth);
    const tail = this.project(rimPoint(g.web, u), Math.max(0, depth - (pierce ? 0.12 : 0.08)));
    if (!head || !tail) return;
    const color = pierce ? OVERDRIVE_COLOR : PLAYER_COLOR;
    const grad = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
    grad.addColorStop(0, rgba(color, 0));
    grad.addColorStop(1, rgba(color, 0.9));
    const f = fog(depth);
    const size = (pierce ? 4 : 3.2) * f + 1;
    ctx.strokeStyle = grad;
    ctx.lineWidth = size * 1.4;
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(head.x, head.y);
    ctx.stroke();
    ctx.fillStyle = rgba('#ffffff', 0.95);
    ctx.beginPath();
    ctx.arc(head.x, head.y, size * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(color, 0.5);
    ctx.beginPath();
    ctx.arc(head.x, head.y, size * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawPlayer(g: Game, depth: number): void {
    const { ctx } = this;
    const frame = this.frameAt(g, playerLane(g) + 0.5, depth);
    if (!frame) return;
    const overdriven = g.overdriveTime > 0;
    const color = overdriven ? OVERDRIVE_COLOR : PLAYER_COLOR;
    const pts = this.localPoints(frame, SHAPES.player[0], 1, 0);

    if (overdriven) {
      const aura = this.localPoints(frame, SHAPES.player[0], 1.25 + 0.08 * Math.sin(this.time * 20), 0);
      this.path(aura, true);
      this.stroke(rgba(OVERDRIVE_COLOR, 0.35), 3);
    }

    this.path(pts, true);
    const tip = pts[2];
    const grad = ctx.createLinearGradient(frame.center.x, frame.center.y, tip.x, tip.y);
    grad.addColorStop(0, rgba(color, 0.45));
    grad.addColorStop(1, rgba(color, 0.1));
    ctx.fillStyle = grad;
    ctx.fill();
    this.stroke(color, 2.6);
    this.stroke('rgba(255,255,255,0.7)', 0.9);

    // Core light at the ship's center.
    const core = this.localPoints(frame, [[0, 0.1]], 1, 0)[0];
    const r = Math.min(Math.hypot(frame.across.x, frame.across.y) * 0.18, this.scale * 0.035);
    const cg = ctx.createRadialGradient(core.x, core.y, 0, core.x, core.y, r);
    cg.addColorStop(0, 'rgba(255,255,255,0.75)');
    cg.addColorStop(0.35, rgba(color, 0.35));
    cg.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(core.x, core.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  private frameAt(g: Game, u: number, depth: number): Frame | null {
    const lane = laneOf(g.web, u);
    const [l, r] = laneEdges(g.web, lane);
    const pl = this.project(l, depth);
    const pr = this.project(r, depth);
    const c = this.project(rimPoint(g.web, u), depth);
    const c2 = this.project(rimPoint(g.web, u), depth - 0.06);
    if (!pl || !pr || !c || !c2) return null;
    const across = { x: (pr.x - pl.x) / 2, y: (pr.y - pl.y) / 2 };
    const half = Math.hypot(across.x, across.y);
    let tx = c2.x - c.x;
    let ty = c2.y - c.y;
    const tl = Math.hypot(tx, ty) || 1;
    // "Toward" axis points out of the tube; scale it to the lane half-width.
    tx = (tx / tl) * half * 0.8;
    ty = (ty / tl) * half * 0.8;
    return { center: c, across, toward: { x: tx, y: ty } };
  }

  private path(pts: Vec2[], closed: boolean): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (closed) ctx.closePath();
  }

  /** Stroke the current path; adds a soft halo when bloom isn't available. */
  private stroke(style: string, width: number): void {
    const { ctx } = this;
    ctx.strokeStyle = style;
    if (!this.bloomSupported) {
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = width * 3.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = width;
    ctx.stroke();
  }

  private drawParticles(dt: number): void {
    const { ctx } = this;
    this.particles = this.particles.filter((p) => (p.life -= dt) > 0);
    for (const p of this.particles) {
      const t = p.life / p.max;
      ctx.strokeStyle = p.color;
      if (p.kind === 'ring') {
        p.r += p.vr * dt;
        ctx.globalAlpha = t * t;
        ctx.lineWidth = p.width * t + 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 2 * dt;
      p.vy *= 1 - 2 * dt;
      p.vy += 60 * dt;
      ctx.globalAlpha = t;
      ctx.lineWidth = p.width;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private text(
    str: string,
    x: number,
    y: number,
    size: number,
    color: string | CanvasGradient,
    opts: { align?: CanvasTextAlign; weight?: number; spacing?: number; glow?: string; alpha?: number } = {},
  ): void {
    const { ctx } = this;
    ctx.font = `${opts.weight ?? 700} ${size}px ${FONT}`;
    ctx.letterSpacing = `${(opts.spacing ?? 0) * size}px`;
    ctx.textAlign = opts.align ?? 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = opts.alpha ?? 1;
    if (opts.glow) {
      ctx.shadowColor = opts.glow;
      ctx.shadowBlur = size * 0.7;
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.letterSpacing = '0px';
  }

  private label(str: string, x: number, y: number, s: number, align: CanvasTextAlign): void {
    this.text(str, x, y, s * 0.42, 'rgba(190,200,255,0.6)', { align, weight: 600, spacing: 0.3 });
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  private shipIcon(cx: number, cy: number, size: number, color: string): void {
    const { ctx } = this;
    const pts = SHAPES.player[0].map(([a, b]) => ({ x: cx + a * size, y: cy - b * size }));
    this.path(pts, true);
    ctx.fillStyle = rgba(color, 0.3);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private drawHud(g: Game, paused: boolean): void {
    const { ctx, w, h } = this;
    const s = this.hudSize();
    const pad = s * 1.1;

    if (g.mode === 'title') {
      this.drawTitle(g, s);
      return;
    }

    // Top bar: score, hi score, level.
    this.label('SCORE', pad, pad * 0.75, s, 'left');
    this.text(g.score.toLocaleString('en-US'), pad, pad * 0.75 + s * 0.95, s * 1.15, '#ffffff', { align: 'left', glow: rgba(PLAYER_COLOR, 0.8) });
    this.label('HIGH SCORE', w / 2, pad * 0.75, s, 'center');
    this.text(g.hiScore.toLocaleString('en-US'), w / 2, pad * 0.75 + s * 0.95, s * 0.8, 'rgba(255,255,255,0.85)', { weight: 600 });
    this.label(`LEVEL`, w - pad, pad * 0.75, s, 'right');
    this.text(`${g.level}`, w - pad, pad * 0.75 + s * 0.95, s * 1.15, '#ffffff', { align: 'right', glow: rgba('#7a8cff', 0.8) });
    this.text(g.web.name.toUpperCase(), w - pad, pad * 0.75 + s * 2, s * 0.42, 'rgba(190,200,255,0.6)', { align: 'right', weight: 600, spacing: 0.3 });

    for (let i = 0; i < Math.min(g.lives - 1, 8); i++) {
      this.shipIcon(pad + s * 0.55 + i * s * 1.35, pad * 0.75 + s * 2.1, s * 0.5, PLAYER_COLOR);
    }

    // Overdrive meter: a glowing pill.
    const bw = Math.min(w * 0.42, s * 15);
    const bh = s * 0.42;
    const bx = w / 2 - bw / 2;
    const by = h - pad - bh;
    const full = g.overdrive >= 1;
    const active = g.overdriveTime > 0;
    const fill = active ? g.overdriveTime / OVERDRIVE_DURATION : g.overdrive;
    this.roundRect(bx, by, bw, bh, bh / 2);
    ctx.fillStyle = 'rgba(111,247,255,0.08)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(111,247,255,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (fill > 0) {
      const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      grad.addColorStop(0, '#3d7bff');
      grad.addColorStop(0.6, OVERDRIVE_COLOR);
      grad.addColorStop(1, '#ffffff');
      const pulse = full && !active ? 0.65 + 0.35 * Math.sin(this.time * 8) : 1;
      ctx.globalAlpha = pulse;
      ctx.shadowColor = OVERDRIVE_COLOR;
      ctx.shadowBlur = full || active ? 16 : 6;
      this.roundRect(bx + 2, by + 2, Math.max(bh - 4, (bw - 4) * fill), bh - 4, (bh - 4) / 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
    const label = active ? 'OVERDRIVE ACTIVE' : full ? 'OVERDRIVE READY  ·  PRESS X' : 'OVERDRIVE';
    this.text(label, w / 2, by - s * 0.5, s * 0.42, full || active ? OVERDRIVE_COLOR : 'rgba(190,200,255,0.6)', {
      weight: 700,
      spacing: 0.3,
      glow: full || active ? OVERDRIVE_COLOR : undefined,
    });

    // Center messages.
    if (g.mode === 'playing' && g.levelTime < LEVEL_INTRO + 0.8) {
      const a = clamp01((LEVEL_INTRO + 0.8 - g.levelTime) / 0.4);
      this.text(`LEVEL ${g.level}`, w / 2, h * 0.45, s * 2.2, this.heroGradient(h * 0.45, s * 2.2), { weight: 800, spacing: 0.08, glow: 'rgba(120,160,255,0.9)', alpha: a });
      this.text(g.web.name.toUpperCase(), w / 2, h * 0.45 + s * 1.9, s * 0.6, 'rgba(200,210,255,0.85)', { weight: 600, spacing: 0.5, alpha: a });
    }
    if (g.mode === 'warping' && g.modeTime < WARP_TIME * 0.7) {
      const a = clamp01((WARP_TIME * 0.7 - g.modeTime) / 0.4);
      this.text('SECTOR CLEAR', w / 2, h * 0.3, s * 1.8, this.heroGradient(h * 0.3, s * 1.8), { weight: 800, spacing: 0.08, glow: 'rgba(111,247,255,0.9)', alpha: a });
      this.text(`+${(500 * g.level).toLocaleString('en-US')} BONUS`, w / 2, h * 0.3 + s * 1.7, s * 0.75, PLAYER_COLOR, { weight: 700, spacing: 0.2, glow: PLAYER_COLOR, alpha: a });
    }
    if (g.mode === 'dying' && g.modeTime > DYING_TIME * 0.4 && g.lives <= 1) {
      this.text('LAST SHIP LOST', w / 2, h * 0.45, s * 1.3, '#ff3d5f', { weight: 800, spacing: 0.1, glow: '#ff3d5f' });
    }
    if (g.mode === 'gameover') {
      this.dim(0.45);
      this.text('GAME OVER', w / 2, h * 0.42, s * 3, '#ff3d5f', { weight: 800, spacing: 0.08, glow: '#ff3d5f' });
      this.text(`FINAL SCORE  ${g.score.toLocaleString('en-US')}`, w / 2, h * 0.42 + s * 2.3, s * 0.7, '#ffffff', { weight: 600, spacing: 0.2 });
      if (g.modeTime > 1.5) {
        this.text('PRESS ENTER OR CLICK TO PLAY AGAIN', w / 2, h * 0.42 + s * 3.6, s * 0.55, PLAYER_COLOR, {
          weight: 700, spacing: 0.25, alpha: 0.6 + 0.4 * Math.sin(this.time * 4),
        });
      }
    }
    if (paused) {
      this.dim(0.5);
      this.text('PAUSED', w / 2, h * 0.47, s * 2.4, '#ffffff', { weight: 800, spacing: 0.15, glow: 'rgba(120,160,255,0.9)' });
      this.text('PRESS P TO RESUME', w / 2, h * 0.47 + s * 1.8, s * 0.5, 'rgba(200,210,255,0.8)', { weight: 600, spacing: 0.3 });
    }
  }

  private dim(a: number): void {
    this.ctx.fillStyle = `rgba(0,0,8,${a})`;
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  private heroGradient(y: number, size: number): CanvasGradient {
    const grad = this.ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.55, '#9fe9ff');
    grad.addColorStop(1, '#7a6bff');
    return grad;
  }

  private drawTitle(g: Game, s: number): void {
    const { ctx, w, h } = this;
    const ty = h * 0.17;
    const size = Math.min(s * 3.6, w * 0.13);
    const grad = ctx.createLinearGradient(w / 2 - size * 3, 0, w / 2 + size * 3, 0);
    grad.addColorStop(0, '#6ff7ff');
    grad.addColorStop(0.5, '#ffffff');
    grad.addColorStop(1, '#ff52e8');
    this.text('RIMFALL', w / 2, ty, size, grad, { weight: 900, spacing: 0.12, glow: 'rgba(120,180,255,0.9)' });
    this.text('A VECTOR TUBE SHOOTER', w / 2, ty + size * 0.75, s * 0.5, 'rgba(200,210,255,0.75)', { weight: 600, spacing: 0.6 });

    const pulse = 0.72 + 0.28 * Math.sin(this.time * 3.5);
    this.text('PRESS ENTER OR CLICK TO START', w / 2, h * 0.68, s * 0.62, PLAYER_COLOR, {
      weight: 700, spacing: 0.25, glow: PLAYER_COLOR, alpha: pulse,
    });

    // Controls panel.
    const rows: [string, string][] = [
      ['MOVE', '← →  ·  A D  ·  MOUSE'],
      ['FIRE', 'SPACE  ·  Z  ·  CLICK'],
      ['OVERDRIVE', 'X  ·  SHIFT  ·  RIGHT CLICK'],
      ['PAUSE / MUTE', 'P  ·  M'],
    ];
    const pw = Math.min(w * 0.9, s * 17);
    const rowH = s * 0.95;
    const ph = rowH * rows.length + s * 0.8;
    const px = w / 2 - pw / 2;
    const py = h * 0.73;
    this.roundRect(px, py, pw, ph, s * 0.4);
    ctx.fillStyle = 'rgba(10,14,40,0.55)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,150,255,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
    rows.forEach(([k, v], i) => {
      const y = py + s * 0.4 + rowH * (i + 0.5);
      this.text(k, px + s * 0.8, y, s * 0.42, 'rgba(190,200,255,0.6)', { align: 'left', weight: 700, spacing: 0.3 });
      this.text(v, px + pw - s * 0.8, y, s * 0.48, '#ffffff', { align: 'right', weight: 600, spacing: 0.1 });
    });

    if (g.hiScore > 0) {
      this.label('HIGH SCORE', w / 2, s * 0.9, s, 'center');
      this.text(g.hiScore.toLocaleString('en-US'), w / 2, s * 1.85, s * 0.8, '#ffffff', { weight: 600 });
    }
  }
}
