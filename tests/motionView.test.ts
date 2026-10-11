/** Phase 2 Step 10: the number tween stays between where it started and where it ends (pure). */
import { describe, expect, test } from "bun:test";
import { TWEEN_MS, tweenValue } from "../web/motion";

describe("tweenValue", () => {
  test("starts at the old value and ends exactly on the new one", () => {
    expect(tweenValue(320, 345, 0, TWEEN_MS)).toBe(320);
    expect(tweenValue(320, 345, TWEEN_MS, TWEEN_MS)).toBe(345);
    expect(tweenValue(320, 345, TWEEN_MS + 500, TWEEN_MS)).toBe(345);
  });

  test("the last frame keeps half points", () => {
    expect(tweenValue(10, 12.5, TWEEN_MS, TWEEN_MS)).toBe(12.5);
  });

  test("a frame timestamp slightly before the start does not overshoot (the bug this guards)", () => {
    expect(tweenValue(320, 345, -4, TWEEN_MS)).toBe(320);
    expect(tweenValue(345, 320, -4, TWEEN_MS)).toBe(345);
    expect(tweenValue(345, 320, -200, TWEEN_MS)).toBe(345);
  });

  test("never leaves the range between start and end, going up or down", () => {
    for (const [from, to] of [[320, 345], [345, 320], [0, 25], [214, 239], [100, 100]] as const) {
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      for (let ms = -60; ms <= TWEEN_MS + 60; ms += 5) {
        const v = tweenValue(from, to, ms, TWEEN_MS);
        expect(v).toBeGreaterThanOrEqual(lo);
        expect(v).toBeLessThanOrEqual(hi);
      }
    }
  });

  test("moves one way only: no wobble", () => {
    let last = 320;
    for (let ms = 0; ms <= TWEEN_MS; ms += 5) {
      const v = tweenValue(320, 345, ms, TWEEN_MS);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    last = 345;
    for (let ms = 0; ms <= TWEEN_MS; ms += 5) {
      const v = tweenValue(345, 320, ms, TWEEN_MS);
      expect(v).toBeLessThanOrEqual(last);
      last = v;
    }
  });

  test("a zero duration jumps straight to the end", () => {
    expect(tweenValue(1, 9, 0, 0)).toBe(9);
  });
});
