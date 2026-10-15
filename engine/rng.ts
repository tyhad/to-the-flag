/**
 * Seeded random numbers for the odds simulation (Phase 3, Step 3).
 *
 * The engine is pure: the same inputs must give the same answer, so nothing here touches Math.random.
 * `hashSeed` turns text (for example season + round) into a seed; `createRng` turns a seed into a stream of draws.
 */

export interface Rng {
  /** Uniform in [0, 1). Never returns 1. */
  next(): number;
  /** Standard Gumbel(0, 1) draw: mean about 0.5772. Adding one to each log-strength and sorting gives a Plackett-Luce order. */
  gumbel(): number;
  /** Standard normal draw: mean 0, standard deviation 1 (Box-Muller). */
  normal(): number;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const PART_SEPARATOR = 0x1f;
const encoder = new TextEncoder();

/**
 * A stable unsigned 32-bit hash of the parts: FNV-1a over their UTF-8 bytes, with a 0x1F byte between parts so that
 * ("ab", "c") and ("a", "bc") differ. With a single part this is plain FNV-1a.
 */
export function hashSeed(...parts: string[]): number {
  let h = FNV_OFFSET;
  parts.forEach((part, i) => {
    if (i > 0) h = Math.imul(h ^ PART_SEPARATOR, FNV_PRIME);
    for (const byte of encoder.encode(part)) h = Math.imul(h ^ byte, FNV_PRIME);
  });
  return h >>> 0;
}

/** A generator with its own state, using mulberry32. The seed is read as an unsigned 32-bit integer. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /** Uniform in (0, 1): a zero is drawn again, so logarithms stay finite. */
  const open = (): number => {
    let u = next();
    while (u === 0) u = next();
    return u;
  };

  const gumbel = (): number => -Math.log(-Math.log(open()));

  const normal = (): number => Math.sqrt(-2 * Math.log(open())) * Math.cos(2 * Math.PI * next());

  return { next, gumbel, normal };
}
