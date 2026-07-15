// Simulates 730 daily puzzles: asserts every course is solvable, par is in
// range, generation is deterministic, and reports distributions + timing.
// Run: node test/sim.mjs

import { generateCourse, solve, COLS, ROWS, FAIRWAY, TREE, SAND, WATER } from '../js/course.js';

const DAYS = 730;
const parCount = new Map();
const attemptCount = new Map();
let worstAttempts = 0;
let hazardMin = 1, hazardMax = 0;
let failures = 0;

const t0 = Date.now();
for (let n = 1; n <= DAYS; n++) {
  const c = generateCourse(n);
  if (!Number.isFinite(c.min)) { console.error(`puzzle ${n}: UNSOLVABLE`); failures++; continue; }
  if (c.min < 3 || c.min > 6) { console.error(`puzzle ${n}: min ${c.min} out of range`); failures++; }
  if (c.attempt === -1) { console.error(`puzzle ${n}: hit fallback course`); failures++; }

  // Determinism: regenerating must give the identical grid.
  const c2 = generateCourse(n);
  if (JSON.stringify(c.grid) !== JSON.stringify(c2.grid)) {
    console.error(`puzzle ${n}: NOT deterministic`); failures++;
  }

  // Tee/hole must sit on fairway.
  if (c.grid[c.tee.y][c.tee.x] !== FAIRWAY || c.grid[c.hole.y][c.hole.x] !== FAIRWAY) {
    console.error(`puzzle ${n}: tee/hole not on fairway`); failures++;
  }

  let hazards = 0;
  for (const row of c.grid) for (const cell of row) if (cell !== FAIRWAY) hazards++;
  const frac = hazards / (COLS * ROWS);
  hazardMin = Math.min(hazardMin, frac);
  hazardMax = Math.max(hazardMax, frac);

  parCount.set(c.par, (parCount.get(c.par) || 0) + 1);
  attemptCount.set(c.attempt, (attemptCount.get(c.attempt) || 0) + 1);
  worstAttempts = Math.max(worstAttempts, c.attempt);
}
const ms = Date.now() - t0;

console.log(`\n${DAYS} puzzles in ${ms}ms (${(ms / DAYS / 2).toFixed(1)}ms per generation incl. determinism re-gen)`);
console.log('par distribution:', [...parCount.entries()].sort((a, b) => a[0] - b[0]).map(([p, c]) => `par ${p}: ${c}`).join(', '));
console.log(`generation attempts needed — worst: ${worstAttempts}, first-try: ${attemptCount.get(0) || 0}/${DAYS}`);
console.log(`hazard coverage: ${(hazardMin * 100).toFixed(0)}%–${(hazardMax * 100).toFixed(0)}% of cells`);

// Print one sample course so a human can eyeball the shape.
const sample = generateCourse(1);
const glyph = { [FAIRWAY]: '·', [TREE]: 'T', [SAND]: 's', [WATER]: '~' };
console.log(`\npuzzle #1 (par ${sample.par}, optimal ${sample.min}):`);
for (let y = 0; y < ROWS; y++) {
  let line = '';
  for (let x = 0; x < COLS; x++) {
    if (x === sample.tee.x && y === sample.tee.y) line += 'O';
    else if (x === sample.hole.x && y === sample.hole.y) line += '⛳';
    else line += glyph[sample.grid[y][x]];
  }
  console.log(line);
}

if (failures > 0) { console.error(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall checks passed');
