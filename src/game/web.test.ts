import { describe, expect, it } from 'vitest';
import { bottomLane, laneDelta, laneOf, makeWeb, rimPoint, wrapU } from './web';

const square = makeWeb('sq', [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }], true);
const line = makeWeb('line', [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], false);

describe('web', () => {
  it('counts lanes for closed and open webs', () => {
    expect(square.lanes).toBe(4);
    expect(line.lanes).toBe(2);
  });

  it('wraps closed webs and clamps open ones', () => {
    expect(wrapU(square, 4.5)).toBeCloseTo(0.5);
    expect(wrapU(square, -0.5)).toBeCloseTo(3.5);
    expect(laneOf(line, 5)).toBe(1);
    expect(laneOf(line, -3)).toBe(0);
  });

  it('measures shortest lateral distance around closed webs', () => {
    expect(laneDelta(square, 0.5, 3.5)).toBeCloseTo(-1);
    expect(laneDelta(square, 3.5, 0.5)).toBeCloseTo(1);
    expect(laneDelta(line, 0.5, 1.5)).toBeCloseTo(1);
  });

  it('winds closed webs so +u moves right along the bottom', () => {
    const lane = bottomLane(square);
    const a = rimPoint(square, lane + 0.25);
    const b = rimPoint(square, lane + 0.75);
    expect(b.x).toBeGreaterThan(a.x);
  });
});
