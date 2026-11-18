// Seeded, stream-split randomness. Each named stream is independent, so a
// decision that changes how many convoys sail does not reshuffle the posture
// shock or tomorrow's reports. Same seed + same decisions = same world.

export type Rng = () => number;

export function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  if (a === 0) a = 0x6d2b79f5;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFor(seed: string, stream: string): Rng {
  return mulberry32(hashString(`${seed}::${stream}`));
}

export function sampleNormal(rng: Rng): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function sampleGamma(rng: Rng, shape: number, scale: number): number {
  if (!(shape > 0) || !(scale > 0)) return 0;
  if (shape < 1) {
    return sampleGamma(rng, shape + 1, scale) * Math.pow(rng(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let i = 0; i < 80; i++) {
    let x: number;
    let v: number;
    do {
      x = sampleNormal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v * scale;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
  return shape * scale;
}

export function samplePoisson(rng: Rng, lambda: number): number {
  if (!(lambda > 0)) return 0;
  if (lambda > 40) {
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * sampleNormal(rng)));
  }
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng();
  } while (p > limit);
  return k - 1;
}

/** Negative binomial via a gamma-Poisson mixture. `k` is the dispersion; lower k is more overdispersed. Mean is `mean`. Variance is mean + mean^2/k. */
export function sampleNegBin(rng: Rng, mean: number, k: number): number {
  if (!(mean > 0)) return 0;
  const lambda = sampleGamma(rng, k, mean / k);
  return samplePoisson(rng, lambda);
}

export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - pos) + sorted[hi] * (pos - lo);
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
