// Deterministic PRNG so every player generates an identical course for a given day.

// mulberry32: tiny, fast, good-enough 32-bit PRNG.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mix several integers into one 32-bit seed.
export function hashSeed(...nums) {
  let h = 0x9e3779b9;
  for (const n of nums) {
    h ^= n + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

// Helpers over a rand() function.
export function rint(rand, min, max) {
  // inclusive both ends
  return min + Math.floor(rand() * (max - min + 1));
}

export function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}
