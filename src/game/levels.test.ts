import { describe, expect, it } from 'vitest';
import { SHAPE_COUNT, unlockedKinds, waveForLevel, webForLevel } from './levels';
import { createRng } from './rng';

describe('levels', () => {
  it('builds every web with roughly uniform lane widths', () => {
    for (let level = 1; level <= SHAPE_COUNT; level++) {
      const web = webForLevel(level);
      expect(web.lanes).toBeGreaterThanOrEqual(10);
      const widths = Array.from({ length: web.lanes }, (_, i) => {
        const a = web.points[i];
        const b = web.points[(i + 1) % web.points.length];
        return Math.hypot(b.x - a.x, b.y - a.y);
      });
      expect(Math.min(...widths) / Math.max(...widths), web.name).toBeGreaterThan(0.5);
    }
  });

  it('only spawns unlocked enemy kinds on valid lanes, in time order', () => {
    for (let level = 1; level <= 12; level++) {
      const lanes = webForLevel(level).lanes;
      const wave = waveForLevel(level, lanes, createRng(level));
      const allowed = unlockedKinds(level);
      expect(wave.length).toBeGreaterThan(0);
      for (let i = 0; i < wave.length; i++) {
        expect(allowed).toContain(wave[i].kind);
        expect(wave[i].lane).toBeGreaterThanOrEqual(0);
        expect(wave[i].lane).toBeLessThan(lanes);
        if (i > 0) expect(wave[i].at).toBeGreaterThanOrEqual(wave[i - 1].at);
      }
    }
  });
});
