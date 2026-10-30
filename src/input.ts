import type { FrameInput } from './game/types';

const KEY_SPEED = 9; // lanes per second
const MOUSE_PX_PER_LANE = 26;
const TOUCH_PX_PER_LANE = 22;

/** Collects keyboard, mouse and touch state; converts it into per-step FrameInput. */
export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private mouseDX = 0;
  private mouseFire = false;
  private mouseOverdrive = false;
  private touchFire = false;
  private touchX: number | null = null;
  private clicked = false;

  constructor(private canvas: HTMLCanvasElement, onGesture: () => void) {
    window.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      onGesture();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseFire = this.mouseOverdrive = this.touchFire = false;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      onGesture();
      this.clicked = true;
      if (e.button === 0) this.mouseFire = true;
      if (e.button === 2) this.mouseOverdrive = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseFire = false;
      if (e.button === 2) this.mouseOverdrive = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas || e.buttons) this.mouseDX += e.movementX;
    });

    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      onGesture();
      this.clicked = true;
      this.touchFire = true;
      this.touchX = e.touches[0].clientX;
      if (e.touches.length >= 2) this.mouseOverdrive = true;
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const x = e.touches[0].clientX;
      if (this.touchX !== null) this.mouseDX += ((x - this.touchX) * MOUSE_PX_PER_LANE) / TOUCH_PX_PER_LANE;
      this.touchX = x;
    }, { passive: false });
    canvas.addEventListener('touchend', (e) => {
      if (e.touches.length === 0) {
        this.touchFire = false;
        this.touchX = null;
        this.mouseOverdrive = false;
      }
    });
  }

  requestPointerLock(): void {
    if (document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock?.();
  }

  /** True once per key press. */
  consume(code: string): boolean {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  /** Build input for one fixed step. Mouse motion and edge-triggered presses are consumed by the first step. */
  frame(dt: number): FrameInput {
    const left = this.keys.has('ArrowLeft') || this.keys.has('KeyA');
    const right = this.keys.has('ArrowRight') || this.keys.has('KeyD');
    const move = ((right ? 1 : 0) - (left ? 1 : 0)) * KEY_SPEED * dt + this.mouseDX / MOUSE_PX_PER_LANE;
    this.mouseDX = 0;
    const start = this.consume('Enter') || this.consume('Space') || this.clicked;
    this.clicked = false;
    return {
      move,
      fire: this.keys.has('Space') || this.keys.has('KeyZ') || this.mouseFire || this.touchFire,
      overdrive: this.keys.has('KeyX') || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.mouseOverdrive,
      start,
    };
  }
}
