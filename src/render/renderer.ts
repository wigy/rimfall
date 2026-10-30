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

const WEB_COLORS = ['#2f6bff', '#ff2f4f', '#e8e83a', '#2fe8e8', '#3aff6a', '#c04cff'];
const PLAYER_COLOR = '#ffe23a';
const ENEMY_COLORS: Record<EnemyKind | 'bolt', string> = {
  drifter: '#ff3355',
  weaver: '#ff4dff',
  splitter: '#9a6bff',
  seeder: '#3dff8a',
  mine: '#ffb02e',
  bolt: '#ffffff',
};

type Local = [number, number];

const SHAPES: Record<EnemyKind | 'bolt' | 'player' | 'shot', Local[][]> = {
  drifter: [
    [[-0.75, 0], [0, 0.75], [0.75, 0], [0, -0.75]],
    [[-0.3, 0], [0, 0.3], [0.3, 0], [0, -0.3]],
  ],
  weaver: [[[-0.8, -0.55], [0.8, 0.55], [0.8, -0.55], [-0.8, 0.55]]],
  splitter: [
    Array.from({ length: 6 }, (_, i): Local => [Math.cos((i / 6) * Math.PI * 2) * 0.8, Math.sin((i / 6) * Math.PI * 2) * 0.8]),
    [[-0.8, 0], [0.8, 0]],
  ],
  seeder: [
    [[-0.6, -0.6], [0.6, -0.6], [0.6, 0.6], [-0.6, 0.6]],
    [[0, -0.6], [0, 0.6]],
    [[-0.6, 0], [0.6, 0]],
  ],
  mine: [[[0, -0.5], [0.12, -0.12], [0.5, 0], [0.12, 0.12], [0, 0.5], [-0.12, 0.12], [-0.5, 0], [-0.12, -0.12]]],
  bolt: [[[0, -0.25], [0.18, 0], [0, 0.25], [-0.18, 0]]],
  player: [[[-1, 0], [-0.55, 0.6], [-0.3, 0.25], [0.3, 0.25], [0.55, 0.6], [1, 0], [0, -0.25]]],
  shot: [[[0, -0.22], [0.16, 0], [0, 0.22], [-0.16, 0]]],
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
}

interface Star {
  x: number;
  y: number;
  z: number;
}

interface Frame {
  center: Vec2;
  across: Vec2;
  toward: Vec2;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t * t * t;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private scale = 1;
  private cy = 0;
  private camZ = -NEAR;
  private particles: Particle[] = [];
  private stars: Star[] = [];
  private flash = 0;
  private time = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    for (let i = 0; i < 160; i++) this.stars.push(this.newStar(Math.random() * 14));
    this.resize();
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scale = Math.min(this.w, this.h) * 0.38;
    this.cy = this.h / 2 - 0.12 * this.scale;
  }

  private project(p: Vec2, depth: number): Vec2 | null {
    const z = depth * DEPTH - this.camZ;
    if (z < NEAR_CLIP) return null;
    const k = (this.scale * NEAR) / z;
    return { x: this.w / 2 + p.x * k, y: this.cy + (p.y - CAM_Y) * k };
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
      this.camZ = -NEAR - 1.2 - Math.sin(this.time * 0.6) * 0.3;
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
        if (p) this.burst(p, ENEMY_COLORS[ev.kind], ev.kind === 'bolt' ? 6 : 20, ev.kind === 'bolt' ? 80 : 220);
      } else if (ev.type === 'hit') {
        const p = this.project(rimPoint(g.web, ev.u), ev.depth);
        if (p) this.burst(p, '#ffffff', 6, 120);
      } else if (ev.type === 'playerDeath') {
        const p = this.project(rimPoint(g.web, ev.lane + 0.5), 0);
        if (p) {
          this.burst(p, PLAYER_COLOR, 70, 420);
          this.burst(p, '#ffffff', 30, 260);
        }
        this.flash = 1;
      } else if (ev.type === 'overdrive') {
        this.flash = 0.6;
      }
    }
  }

  private burst(p: Vec2, color: string, count: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      const life = 0.4 + Math.random() * 0.6;
      this.particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color });
    }
  }

  private newStar(z = 14): Star {
    return { x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 10, z };
  }

  render(g: Game, dt: number, paused: boolean): void {
    const { ctx } = this;
    this.time += dt;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const playerDepth = this.updateCamera(g);
    const warping = g.mode === 'warping';
    this.drawStars(warping ? 9 + g.modeTime * 14 : 0.6, paused ? 0 : dt);

    const webColor = WEB_COLORS[(g.level - 1) % WEB_COLORS.length];
    const showPlayer = g.mode === 'playing' || g.mode === 'warping' || (g.mode === 'dying' && g.modeTime < 0.05);
    this.drawWeb(g, webColor, showPlayer ? playerLane(g) : -1);

    if (g.mode !== 'title') {
      for (const s of g.shots) {
        const shape = s.pierce ? [[[0, -0.35], [0.1, 0], [0, 0.35], [-0.1, 0]] as Local[]] : SHAPES.shot;
        this.drawThing(g, s.lane + 0.5, s.depth, shape, s.pierce ? '#7ff6ff' : PLAYER_COLOR, 0.5);
      }
      for (const b of g.bolts) this.drawThing(g, b.lane + 0.5, b.depth, SHAPES.bolt, ENEMY_COLORS.bolt, 1, this.time * 8);
      for (const e of g.enemies) {
        const spin = e.kind === 'mine' ? this.time * 3 + e.phase : e.kind === 'seeder' ? this.time * 1.5 : 0;
        const pulse = e.kind === 'mine' ? 0.85 + 0.25 * Math.sin(this.time * 9 + e.phase) : 1;
        const hurt = e.kind === 'seeder' && e.hp < 2;
        this.drawThing(g, e.u, e.depth, SHAPES[e.kind], hurt ? '#b6ffd2' : ENEMY_COLORS[e.kind], pulse, spin);
      }
      if (showPlayer) {
        const overdriven = g.overdriveTime > 0;
        const color = overdriven && Math.floor(this.time * 12) % 2 ? '#7ff6ff' : PLAYER_COLOR;
        this.drawThing(g, playerLane(g) + 0.5, playerDepth, SHAPES.player, color, 1, 0, true);
      }
    }

    this.drawParticles(paused ? 0 : dt);

    if (this.flash > 0) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.35})`;
      ctx.fillRect(0, 0, this.w, this.h);
      this.flash = Math.max(0, this.flash - dt * 2.5);
    }

    this.drawHud(g, paused);
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
      const x = this.w / 2 + (s.x / s.z) * k;
      const y = this.cy + (s.y / s.z) * k;
      const px = this.w / 2 + (s.x / prevZ) * k;
      const py = this.cy + (s.y / prevZ) * k;
      const a = Math.min(1, 2.5 / s.z);
      ctx.strokeStyle = `rgba(160,190,255,${a})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x + 0.5, y + 0.5);
      ctx.stroke();
    }
  }

  private drawWeb(g: Game, color: string, activeLane: number): void {
    const { web } = g;
    const near = web.points.map((p) => this.project(p, 0));
    const far = web.points.map((p) => this.project(p, 1));
    const ring = (pts: (Vec2 | null)[]) => {
      const segs: Vec2[][] = [];
      let cur: Vec2[] = [];
      const list = web.closed ? [...pts, pts[0]] : pts;
      for (const p of list) {
        if (p) cur.push(p);
        else if (cur.length) {
          segs.push(cur);
          cur = [];
        }
      }
      if (cur.length) segs.push(cur);
      return segs;
    };
    for (const seg of [...ring(near), ...ring(far)]) this.glow(seg, color, 1.6, false);
    near.forEach((n, i) => {
      const f = far[i];
      if (n && f) this.glow([n, f], color, 1.2, false, 0.75);
    });
    if (activeLane >= 0) {
      const i2 = (activeLane + 1) % web.points.length;
      for (const i of [activeLane, i2]) {
        const n = near[i];
        const f = far[i];
        if (n && f) this.glow([n, f], PLAYER_COLOR, 1.4, false, 0.55);
      }
    }
  }

  /** Draw a shape in the local frame of lane position u at the given depth. */
  private drawThing(g: Game, u: number, depth: number, shape: Local[][], color: string, size = 1, spin = 0, bright = false): void {
    const frame = this.frameAt(g, u, depth);
    if (!frame) return;
    const cos = Math.cos(spin);
    const sin = Math.sin(spin);
    for (const poly of shape) {
      const pts: Vec2[] = poly.map(([a0, b0]) => {
        const a = (a0 * cos - b0 * sin) * size;
        const b = (a0 * sin + b0 * cos) * size;
        return {
          x: frame.center.x + frame.across.x * a + frame.toward.x * b,
          y: frame.center.y + frame.across.y * a + frame.toward.y * b,
        };
      });
      this.glow(pts, color, bright ? 2.2 : 1.8, poly.length > 2);
    }
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

  /** Vector-monitor style stroke: wide faint halo plus a bright core. */
  private glow(pts: Vec2[], color: string, width: number, closed: boolean, alpha = 1): void {
    if (pts.length < 2) return;
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (closed) ctx.closePath();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.12 * alpha;
    ctx.lineWidth = width * 5;
    ctx.stroke();
    ctx.globalAlpha = 0.3 * alpha;
    ctx.lineWidth = width * 2.4;
    ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawParticles(dt: number): void {
    const { ctx } = this;
    this.particles = this.particles.filter((p) => (p.life -= dt) > 0);
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 1.5 * dt;
      p.vy *= 1 - 1.5 * dt;
      ctx.globalAlpha = p.life / p.max;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private text(str: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center'): void {
    const { ctx } = this;
    ctx.font = `bold ${size}px "Courier New", monospace`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.shadowColor = color;
    ctx.shadowBlur = size * 0.6;
    ctx.fillText(str, x, y);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.fillText(str, x, y);
  }

  private drawHud(g: Game, paused: boolean): void {
    const { ctx, w, h } = this;
    ctx.globalCompositeOperation = 'source-over';
    const s = Math.max(14, Math.min(w, h) * 0.035);
    const pad = s;

    if (g.mode === 'title') {
      const blink = Math.floor(this.time * 2) % 2 === 0;
      this.text('RIMFALL', w / 2, h * 0.2, s * 3.2, '#7ff6ff');
      this.text('A VECTOR TUBE SHOOTER', w / 2, h * 0.2 + s * 2.4, s * 0.7, '#9aa8ff');
      if (blink) this.text('PRESS ENTER OR CLICK TO START', w / 2, h * 0.62, s * 0.9, PLAYER_COLOR);
      const lines = [
        '← → / A D / MOUSE   MOVE',
        'SPACE / Z / CLICK   FIRE',
        'X / SHIFT / RIGHT CLICK   OVERDRIVE',
        'P   PAUSE      M   MUTE',
      ];
      lines.forEach((l, i) => this.text(l, w / 2, h * 0.72 + i * s * 1.2, s * 0.6, '#c8d0ff'));
      this.text(`HI ${g.hiScore}`, w / 2, pad, s * 0.8, '#ffffff');
      return;
    }

    this.text(String(g.score).padStart(6, '0'), pad, pad, s, PLAYER_COLOR, 'left');
    this.text(`HI ${g.hiScore}`, w / 2, pad, s * 0.7, '#ffffff');
    this.text(`LEVEL ${g.level}`, w - pad, pad, s * 0.8, '#9aa8ff', 'right');

    // Lives as small player glyphs.
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < Math.min(g.lives - 1, 8); i++) {
      const cx = pad + s * 0.6 + i * s * 1.5;
      const cyy = pad + s * 1.6;
      const pts = SHAPES.player[0].map(([a, b]) => ({ x: cx + a * s * 0.6, y: cyy - b * s * 0.6 }));
      this.glow(pts, PLAYER_COLOR, 1.4, true);
    }
    ctx.globalCompositeOperation = 'source-over';

    // Overdrive meter.
    const bw = Math.min(w * 0.4, s * 14);
    const bx = w / 2 - bw / 2;
    const by = h - pad * 1.4;
    const full = g.overdrive >= 1;
    const active = g.overdriveTime > 0;
    const fill = active ? g.overdriveTime / OVERDRIVE_DURATION : g.overdrive;
    ctx.strokeStyle = '#7ff6ff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bx, by, bw, s * 0.45);
    ctx.fillStyle = active ? '#7ff6ff' : full ? (Math.floor(this.time * 4) % 2 ? '#7ff6ff' : '#2a6f80') : '#2a8fa0';
    ctx.fillRect(bx + 2, by + 2, (bw - 4) * fill, s * 0.45 - 4);
    const label = active ? 'OVERDRIVE!' : full ? 'OVERDRIVE READY - PRESS X' : 'OVERDRIVE';
    this.text(label, w / 2, by - s * 0.55, s * 0.55, '#7ff6ff');

    if (g.mode === 'playing' && g.levelTime < LEVEL_INTRO + 0.8) {
      this.text(`LEVEL ${g.level}`, w / 2, h * 0.45, s * 1.8, '#ffffff');
      this.text(g.web.name.toUpperCase(), w / 2, h * 0.45 + s * 1.8, s * 0.8, '#9aa8ff');
    }
    if (g.mode === 'warping' && g.modeTime < WARP_TIME * 0.6) {
      this.text('SECTOR CLEAR', w / 2, h * 0.3, s * 1.5, '#7ff6ff');
      this.text(`BONUS ${500 * g.level}`, w / 2, h * 0.3 + s * 1.6, s * 0.9, PLAYER_COLOR);
    }
    if (g.mode === 'dying' && g.modeTime > DYING_TIME * 0.4 && g.lives <= 1) {
      this.text('LAST SHIP LOST', w / 2, h * 0.45, s * 1.2, '#ff3355');
    }
    if (g.mode === 'gameover') {
      this.text('GAME OVER', w / 2, h * 0.42, s * 2.6, '#ff3355');
      if (g.modeTime > 1.5 && Math.floor(this.time * 2) % 2 === 0) {
        this.text('PRESS ENTER OR CLICK', w / 2, h * 0.42 + s * 2.5, s * 0.8, PLAYER_COLOR);
      }
    }
    if (paused) this.text('PAUSED', w / 2, h * 0.5, s * 2, '#ffffff');
  }
}
