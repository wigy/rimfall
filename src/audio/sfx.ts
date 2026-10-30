import type { GameEvent } from '../game/types';

/** Synthesized sound effects via WebAudio; no audio assets needed. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;

  /** Must be called from a user gesture before audio can play. */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.35;
  }

  play(events: GameEvent[]): void {
    if (!this.ctx || this.muted) return;
    for (const ev of events) {
      switch (ev.type) {
        case 'shoot':
          this.tone(ev.pierce ? 1400 : 900, 180, 0.08, 'square', 0.12);
          break;
        case 'explode':
          if (ev.kind === 'bolt') this.noise(0.08, 0.15, 3000);
          else {
            this.noise(0.35, 0.4, 1600);
            this.tone(220, 40, 0.25, 'sawtooth', 0.15);
          }
          break;
        case 'hit':
          this.tone(600, 300, 0.06, 'square', 0.15);
          break;
        case 'enemyFire':
          this.tone(300, 500, 0.1, 'triangle', 0.12);
          break;
        case 'playerDeath':
          this.noise(1.4, 0.7, 900);
          this.tone(500, 30, 1.2, 'sawtooth', 0.3);
          break;
        case 'warp':
          this.tone(80, 1600, 2.0, 'sawtooth', 0.18);
          this.tone(120, 2400, 2.0, 'square', 0.06);
          break;
        case 'levelStart':
          this.tone(400, 800, 0.15, 'triangle', 0.2);
          break;
        case 'overdrive':
          this.tone(200, 2000, 0.5, 'square', 0.15);
          break;
        case 'extraLife':
          [660, 880, 1320].forEach((f, i) => this.tone(f, f, 0.12, 'square', 0.15, i * 0.12));
          break;
        case 'gameOver':
          [440, 330, 220].forEach((f, i) => this.tone(f, f * 0.9, 0.3, 'triangle', 0.2, i * 0.3));
          break;
      }
    }
  }

  private tone(from: number, to: number, dur: number, type: OscillatorType, vol: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, cutoff: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(100, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(t);
    src.stop(t + dur);
  }
}
