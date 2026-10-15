import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRng, hashSeed } from "../engine/rng";

const draws = (n: number, f: () => number) => Array.from({ length: n }, f);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

describe("hashSeed", () => {
  // FNV-1a, 32 bit, over UTF-8; parts are joined with a 0x1F byte. Values were computed with a separate implementation.
  test("a single part is plain FNV-1a (published test vectors)", () => {
    expect(hashSeed()).toBe(0x811c9dc5);
    expect(hashSeed("a")).toBe(0xe40c292c);
    expect(hashSeed("foobar")).toBe(0xbf9cf968);
  });

  test("golden values for several parts", () => {
    expect(hashSeed("ttf", "2026", "17")).toBe(838602009);
    expect(hashSeed("ttf", "odds")).toBe(668632748);
  });

  test("the split between parts matters", () => {
    expect(hashSeed("ab", "c")).toBe(3483414340);
    expect(hashSeed("a", "bc")).toBe(1525061270);
    expect(hashSeed("ab", "c")).not.toBe(hashSeed("a", "bc"));
    expect(hashSeed("abc")).not.toBe(hashSeed("ab", "c"));
  });

  test("is stable, and always an unsigned 32-bit integer", () => {
    expect(hashSeed("x", "y")).toBe(hashSeed("x", "y"));
    for (const s of ["", "é", "日本", "a".repeat(1000)]) {
      const h = hashSeed(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
  });
});

describe("createRng", () => {
  test("golden sequence (mulberry32)", () => {
    const a = createRng(0);
    expect(draws(4, () => a.next())).toEqual([0.26642920868471265, 0.0003297457005828619, 0.2232720274478197, 0.1462021479383111]);
    const b = createRng(hashSeed("ttf", "2026", "17"));
    expect(draws(4, () => b.next())).toEqual([0.07099099364131689, 0.104582613799721, 0.8041559325065464, 0.11498837149702013]);
  });

  test("the same seed gives the same sequence, for every method", () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 200; i++) {
      expect(a.next()).toBe(b.next());
      expect(a.gumbel()).toBe(b.gumbel());
      expect(a.normal()).toBe(b.normal());
    }
  });

  test("different seeds give different sequences", () => {
    const a = draws(20, createRng(1).next);
    const b = draws(20, createRng(2).next);
    expect(a).not.toEqual(b);
    expect(new Set(a).size).toBe(20);
  });

  test("a generator is independent of other generators", () => {
    const a = createRng(7);
    const lone = draws(10, () => a.next());
    const b = createRng(7);
    const noise = createRng(99);
    const mixed = draws(10, () => (noise.next(), b.next()));
    expect(mixed).toEqual(lone);
  });

  test("a seed is read as an unsigned 32-bit integer", () => {
    expect(createRng(-1).next()).toBe(createRng(2 ** 32 - 1).next());
    expect(createRng(2 ** 32).next()).toBe(createRng(0).next());
  });

  test("next() is in [0, 1) and never returns 1 (100k draws)", () => {
    const rng = createRng(123);
    for (let i = 0; i < 100_000; i++) {
      const x = rng.next();
      expect(x >= 0 && x < 1).toBe(true);
    }
  });

  test("next(): mean about 0.5 and variance about 1/12 (100k draws)", () => {
    const xs = draws(100_000, createRng(2026).next);
    expect(Math.abs(mean(xs) - 0.5)).toBeLessThan(0.01);
    expect(Math.abs(sd(xs) ** 2 - 1 / 12)).toBeLessThan(0.005);
  });

  test("gumbel(): finite, mean about 0.5772 (Euler-Mascheroni) and sd about 1.2825 (100k draws)", () => {
    const xs = draws(100_000, createRng(2026).gumbel);
    expect(xs.every(Number.isFinite)).toBe(true);
    expect(Math.abs(mean(xs) - 0.5772)).toBeLessThan(0.03);
    expect(Math.abs(sd(xs) - Math.PI / Math.sqrt(6))).toBeLessThan(0.03);
  });

  test("normal(): finite, mean about 0 and sd about 1 (100k draws)", () => {
    const xs = draws(100_000, createRng(2026).normal);
    expect(xs.every(Number.isFinite)).toBe(true);
    expect(Math.abs(mean(xs))).toBeLessThan(0.02);
    expect(Math.abs(sd(xs) - 1)).toBeLessThan(0.02);
  });

  test("normal(): about 68% of draws lie within one sd", () => {
    const xs = draws(100_000, createRng(5).normal);
    const inside = xs.filter((x) => Math.abs(x) < 1).length / xs.length;
    expect(Math.abs(inside - 0.6827)).toBeLessThan(0.01);
  });

  test("methods can be passed around without `this`", () => {
    const { next, gumbel, normal } = createRng(3);
    expect(next()).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(gumbel())).toBe(true);
    expect(Number.isFinite(normal())).toBe(true);
  });
});

describe("the engine never uses Math.random", () => {
  test("engine/rng.ts has no call to it", () => {
    const src = readFileSync(join(import.meta.dir, "..", "engine", "rng.ts"), "utf8");
    expect(src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")).not.toContain("Math.random");
  });
});
