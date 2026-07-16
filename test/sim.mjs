// Simulates 730 daily puzzles on the dice engine: asserts every course is
// solvable with its roll sequence, par is in range, generation and rolls are
// deterministic, courses survive an encode/decode round trip, and reports
// distributions + timing. Run: node test/sim.mjs

import {
  generateCourse, solve, rollAt, encodeCourse, decodeCourse,
  COLS, ROWS, FAIRWAY, TREE, SAND, WATER, ROUGH,
} from '../js/course.js';

const DAYS = 730;
const parCount = new Map();
let worstAttempts = 0;
let fairMin = 1, fairMax = 0;
let codeMax = 0;
let failures = 0;

const t0 = Date.now();
for (let n = 1; n <= DAYS; n++) {
  const c = generateCourse(n);
  if (!Number.isFinite(c.min)) { console.error(`puzzle ${n}: UNSOLVABLE`); failures++; continue; }
  if (c.min < 3 || c.min > 6) { console.error(`puzzle ${n}: min ${c.min} out of range`); failures++; }
  if (c.attempt === -1) { console.error(`puzzle ${n}: hit fallback course`); failures++; }

  // Determinism: regenerating must give the identical grid and rolls.
  const c2 = generateCourse(n);
  if (JSON.stringify(c.grid) !== JSON.stringify(c2.grid)) {
    console.error(`puzzle ${n}: NOT deterministic`); failures++;
  }
  for (let i = 0; i < 12; i++) {
    const r = rollAt(c, i);
    if (r < 1 || r > 6 || r !== rollAt(c2, i)) { console.error(`puzzle ${n}: bad roll ${r} @${i}`); failures++; }
  }

  // Tee/hole must sit on fairway (first lie is +1).
  if (c.grid[c.tee.y][c.tee.x] !== FAIRWAY || c.grid[c.hole.y][c.hole.x] !== FAIRWAY) {
    console.error(`puzzle ${n}: tee/hole not on fairway`); failures++;
  }

  // Course code round trip (custom courses reuse the same grids).
  const code = encodeCourse(c.grid, c.tee, c.hole);
  codeMax = Math.max(codeMax, code.length);
  const dec = decodeCourse(code);
  if (!dec || JSON.stringify(dec.grid) !== JSON.stringify(c.grid)
      || dec.tee.x !== c.tee.x || dec.hole.y !== c.hole.y || !Number.isFinite(dec.min)) {
    console.error(`puzzle ${n}: encode/decode round trip failed`); failures++;
  }

  let fair = 0;
  for (const row of c.grid) for (const cell of row) if (cell === FAIRWAY) fair++;
  const frac = fair / (COLS * ROWS);
  fairMin = Math.min(fairMin, frac);
  fairMax = Math.max(fairMax, frac);

  parCount.set(c.par, (parCount.get(c.par) || 0) + 1);
  worstAttempts = Math.max(worstAttempts, c.attempt);
}
const ms = Date.now() - t0;

console.log(`\n${DAYS} puzzles in ${ms}ms (${(ms / DAYS / 2).toFixed(1)}ms per generation incl. determinism re-gen)`);
console.log('par distribution:', [...parCount.entries()].sort((a, b) => a[0] - b[0]).map(([p, c]) => `par ${p}: ${c}`).join(', '));
console.log(`generation attempts needed — worst: ${worstAttempts}`);
console.log(`fairway coverage: ${(fairMin * 100).toFixed(0)}%–${(fairMax * 100).toFixed(0)}% of cells; longest course code: ${codeMax} chars`);

// Malformed-code fuzz: none of these may crash or decode.
const junk = ['', 'v1', 'v199999999:f', 'v1060106011:f247', 'v1061706 01:f247', 'v106170601:f246', 'v106170601:x247', null, 'v10617\n:'];
for (const j of junk) {
  let d;
  try { d = decodeCourse(j); } catch (e) { console.error(`decode threw on ${JSON.stringify(j)}: ${e.message}`); failures++; continue; }
  if (d) { console.error(`decode accepted junk: ${JSON.stringify(j)}`); failures++; }
}

// Print one sample course so a human can eyeball the shape.
const sample = generateCourse(2);
const glyph = { [FAIRWAY]: '·', [TREE]: 'T', [SAND]: 's', [WATER]: '~', [ROUGH]: ',' };
console.log(`\npuzzle #2 (par ${sample.par}, optimal ${sample.min}), first rolls: ${[0,1,2,3,4,5].map(i=>rollAt(sample,i)).join(',')}`);
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
