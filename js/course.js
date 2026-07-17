// Course model: generation (seeded by puzzle number), dice rolls, shot
// resolution, a roll-aware BFS solver that proves solvability and sets par,
// and the shareable course-code format for the editor. Pure logic, no DOM —
// also imported by the node test harness and the leaderboard API.

// NOTE: no ?v= query here — this file is also bundled into the Pages Function
// (functions/api/scores.js), and the bundler resolves plain paths only. rng.js
// never changes, so browser cache pairing is safe without one.
import { mulberry32, hashSeed, rint } from './rng.js';

export const COLS = 13;
export const ROWS = 19;

export const FAIRWAY = 0;
export const TREE = 1;
export const SAND = 2;
export const WATER = 3;
export const ROUGH = 4;

// 8 compass directions, clockwise from north.
export const DIRS = [
  { dx: 0, dy: -1 }, { dx: 1, dy: -1 }, { dx: 1, dy: 0 }, { dx: 1, dy: 1 },
  { dx: 0, dy: 1 }, { dx: -1, dy: 1 }, { dx: -1, dy: 0 }, { dx: -1, dy: -1 },
];

export const MAX_DIST = 7; // 6 (best roll) + 1 (fairway lie)

export function inBounds(x, y) {
  return x >= 0 && x < COLS && y >= 0 && y < ROWS;
}

// --- dice ------------------------------------------------------------------
// Each swing consumes one D6 roll from a sequence seeded per course, indexed
// by swing number — every player gets the same rolls on the same swing, so
// daily and shared custom courses stay fair. Your lie adjusts the roll:
// fairway +1, rough ±0, sand −1 (never below 1 or above MAX_DIST).

export function lieMod(cell) {
  return cell === FAIRWAY ? 1 : cell === SAND ? -1 : 0;
}

export function lieName(cell) {
  return cell === FAIRWAY ? 'fairway' : cell === SAND ? 'sand' : 'rough';
}

export function rollAt(course, swingIdx) {
  return 1 + Math.floor(mulberry32(hashSeed(course.rollSeed, swingIdx))() * 6);
}

export function turnDistance(course, pos, swingIdx) {
  const roll = rollAt(course, swingIdx);
  const cell = course.grid[pos.y][pos.x];
  const mod = lieMod(cell);
  return { roll, mod, cell, dist: Math.max(1, Math.min(MAX_DIST, roll + mod)) };
}

// --- shot resolution ---------------------------------------------------------

// Fly the ball `dist` cells from `from` along `dir`. The ball flies over sand
// and water (only the landing cell matters) but trees block it mid-flight.
// `oob` shots are disallowed by the UI and solver, but resolve defensively.
export function resolveShot(course, from, dir, dist) {
  let cx = from.x, cy = from.y;
  let blocked = false, oob = false;
  const flight = [];
  for (let i = 0; i < dist; i++) {
    const nx = cx + dir.dx, ny = cy + dir.dy;
    if (!inBounds(nx, ny)) { oob = true; break; }
    if (course.grid[ny][nx] === TREE) { blocked = true; break; }
    cx = nx; cy = ny;
    flight.push({ x: cx, y: cy });
  }
  const cell = course.grid[cy][cx];
  const holed = cx === course.hole.x && cy === course.hole.y;
  return {
    x: cx, y: cy, flight, blocked, oob,
    water: !holed && cell === WATER,
    sand: !holed && cell === SAND,
    rough: !holed && cell === ROUGH,
    holed,
  };
}

// True if aiming `dist` in `dir` from `from` stays on the paper. Off-paper
// aims are simply not offered. (With MAX_DIST 7 on a 19-tall board, straight
// north or south is always available, so no position is ever stuck.)
export function aimInBounds(from, dir, dist) {
  return inBounds(from.x + dir.dx * dist, from.y + dir.dy * dist);
}

// --- solver ------------------------------------------------------------------
// With dice, every legal swing matters to optimal play: a tree-blocked swing
// that goes nowhere and even a water splash (stroke + penalty, ball returns)
// both burn a roll and advance the sequence — sometimes that IS the best
// move, and sometimes water is the only in-bounds option. Instead of the
// roll, a player may always putt exactly 1 square. So: Dijkstra over
// (position, swing index) states, where a normal swing or putt costs 1
// stroke and a water swing costs 2. Returns minimum strokes to hole out.
export function solve(course, maxSwings = 20, maxStrokes = 24) {
  const stateKey = (x, y, swing) => (y * COLS + x) * (maxSwings + 1) + swing;
  const best = new Map();
  const buckets = [];
  const push = (x, y, swing, strokes) => {
    if (swing > maxSwings || strokes > maxStrokes) return;
    const k = stateKey(x, y, swing);
    if (best.has(k) && best.get(k) <= strokes) return;
    best.set(k, strokes);
    (buckets[strokes] ||= []).push({ x, y, swing });
  };
  push(course.tee.x, course.tee.y, 0, 0);
  for (let s = 0; s <= maxStrokes; s++) {
    const bucket = buckets[s];
    if (!bucket) continue;
    for (const st of bucket) {
      if (best.get(stateKey(st.x, st.y, st.swing)) !== s) continue; // stale entry
      const { dist } = turnDistance(course, st, st.swing);
      const options = dist === 1 ? [1] : [dist, 1]; // the roll, and the ever-available 1-square putt
      for (const dir of DIRS) {
        for (const d of options) {
          if (!aimInBounds(st, dir, d)) continue;
          const r = resolveShot(course, st, dir, d);
          if (r.oob) continue;
          if (r.holed) return s + 1;
          if (r.water) push(st.x, st.y, st.swing + 1, s + 2);
          else push(r.x, r.y, st.swing + 1, s + 1);
        }
      }
    }
  }
  return Infinity;
}

// Best-case optimum: the fewest strokes if you could conjure the ideal roll
// every turn (as if rerolls were unlimited). Since a player only ever gets 1
// free reroll + 2 mulligans, no real round can beat this — it's the safe
// anti-cheat floor for the leaderboard (par itself still comes from solve(),
// which honours the actual seeded sequence). Positions only: at each cell the
// reachable distances are the putt (1) plus every roll 1..6 adjusted by lie.
export function solveBestCase(course, maxStrokes = 24) {
  const buckets = [];
  const best = new Map();
  const push = (x, y, strokes) => {
    if (strokes > maxStrokes) return;
    const k = y * COLS + x;
    if (best.has(k) && best.get(k) <= strokes) return;
    best.set(k, strokes);
    (buckets[strokes] ||= []).push({ x, y });
  };
  push(course.tee.x, course.tee.y, 0);
  for (let s = 0; s <= maxStrokes; s++) {
    const bucket = buckets[s];
    if (!bucket) continue;
    for (const st of bucket) {
      if (best.get(st.y * COLS + st.x) !== s) continue;
      const mod = lieMod(course.grid[st.y][st.x]);
      const dists = new Set([1]);
      for (let roll = 1; roll <= 6; roll++) dists.add(Math.max(1, Math.min(MAX_DIST, roll + mod)));
      for (const dir of DIRS) {
        for (const d of dists) {
          if (!aimInBounds(st, dir, d)) continue;
          const r = resolveShot(course, st, dir, d);
          if (r.oob) continue;
          if (r.holed) return s + 1;
          if (r.water) push(st.x, st.y, s + 2);
          else push(r.x, r.y, s + 1);
        }
      }
    }
  }
  return Infinity;
}

// --- generation ----------------------------------------------------------------

function stamp(grid, cx, cy, radius, type) {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if (inBounds(nx, ny)) grid[ny][nx] = type;
    }
  }
}

// Grow an organic blob of `type`, only claiming grass (fairway/rough).
function growBlob(rand, grid, seedX, seedY, size, type) {
  const grass = (c) => c === FAIRWAY || c === ROUGH;
  if (!grass(grid[seedY][seedX])) return;
  const cells = [{ x: seedX, y: seedY }];
  grid[seedY][seedX] = type;
  const sides = [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }];
  for (let i = 1, tries = 0; i < size && tries < size * 8; tries++) {
    const c = cells[Math.floor(rand() * cells.length)];
    const s = sides[Math.floor(rand() * sides.length)];
    const nx = c.x + s.dx, ny = c.y + s.dy;
    if (!inBounds(nx, ny) || !grass(grid[ny][nx])) continue;
    grid[ny][nx] = type;
    cells.push({ x: nx, y: ny });
    i++;
  }
}

function tryGenerate(rand) {
  const grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(ROUGH));
  const tee = { x: rint(rand, 2, COLS - 3), y: ROWS - 2 };
  const hole = { x: rint(rand, 2, COLS - 3), y: rint(rand, 1, 2) };

  // Mowed fairway: a wandering ribbon from tee toward the green.
  let px = tee.x, py = tee.y;
  stamp(grid, px, py, 1, FAIRWAY);
  for (let guard = 0; (px !== hole.x || py !== hole.y) && guard < 200; guard++) {
    if (rand() < 0.72) {
      px += Math.sign(hole.x - px);
      py += Math.sign(hole.y - py);
    } else {
      px += rint(rand, -1, 1);
      if (rand() < 0.8) py += Math.sign(hole.y - py);
    }
    px = Math.max(1, Math.min(COLS - 2, px));
    py = Math.max(1, Math.min(ROWS - 2, py));
    stamp(grid, px, py, rand() < 0.3 ? 2 : 1, FAIRWAY);
  }
  stamp(grid, hole.x, hole.y, 2, FAIRWAY); // the green
  stamp(grid, tee.x, tee.y, 1, FAIRWAY);   // the tee box

  // Water: 1-2 blobs in the middle band.
  const nWater = rint(rand, 1, 2);
  for (let i = 0; i < nWater; i++) {
    growBlob(rand, grid, rint(rand, 1, COLS - 2), rint(rand, 4, ROWS - 6), rint(rand, 6, 13), WATER);
  }

  // Hedge: a horizontal tree line with a gap, most days.
  if (rand() < 0.6) {
    const row = rint(rand, 6, ROWS - 7);
    const x0 = rint(rand, 0, 2);
    const x1 = COLS - 1 - rint(rand, 0, 2);
    const gapAt = rint(rand, x0 + 1, x1 - 1);
    const gapW = rint(rand, 1, 2);
    for (let x = x0; x <= x1; x++) {
      if (x >= gapAt && x < gapAt + gapW) continue;
      if (grid[row][x] !== WATER) grid[row][x] = TREE;
    }
  }

  // Tree clusters.
  const nClusters = rint(rand, 5, 8);
  for (let i = 0; i < nClusters; i++) {
    growBlob(rand, grid, rint(rand, 0, COLS - 1), rint(rand, 2, ROWS - 3), rint(rand, 1, 4), TREE);
  }

  // Sand: one patch guarding the green, plus 1-2 elsewhere.
  const gx = hole.x + rint(rand, -3, 3);
  const gy = hole.y + rint(rand, 2, 3);
  if (inBounds(gx, gy)) growBlob(rand, grid, gx, gy, rint(rand, 3, 6), SAND);
  const nSand = rint(rand, 1, 2);
  for (let i = 0; i < nSand; i++) {
    growBlob(rand, grid, rint(rand, 1, COLS - 2), rint(rand, 4, ROWS - 5), rint(rand, 3, 5), SAND);
  }

  // Keep the tee and the green playable: clear a 1-cell ring to fairway.
  stamp(grid, tee.x, tee.y, 1, FAIRWAY);
  stamp(grid, hole.x, hole.y, 1, FAIRWAY);

  return { grid, tee, hole };
}

// Generate the course for puzzle #n. The day's roll sequence is fixed first
// (independent of layout attempts), then layouts are deterministically
// re-rolled until the solver confirms the hole is interesting with those
// rolls: 3-6 optimal swings. Par is optimal + 1, so a perfect round is a
// birdie.
export function generateCourse(n) {
  const rollSeed = hashSeed(0xd1ce, n);
  for (let attempt = 0; attempt < 500; attempt++) {
    const rand = mulberry32(hashSeed(0x60f1, n, attempt));
    const course = { ...tryGenerate(rand), rollSeed };
    const min = solve(course);
    if (min >= 3 && min <= 6) {
      return { ...course, min, par: min + 1, number: n, attempt };
    }
  }
  // Practically unreachable; an open course is always solvable.
  const grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(FAIRWAY));
  const course = { grid, tee: { x: 6, y: ROWS - 2 }, hole: { x: 6, y: 1 }, rollSeed, number: n, attempt: -1 };
  const min = solve(course);
  return { ...course, min, par: min + 1 };
}

// --- shareable course codes (editor) -------------------------------------------
// Format: v1TTxxTTyyHHxxHHyy:RLE where RLE is tile letters with optional
// decimal run lengths, row-major. Rolls for a custom course are seeded from
// the code itself, so everyone who plays a shared link gets the same rolls.

const TILE_TO_CHAR = ['f', 't', 's', 'w', 'r'];

export function encodeCourse(grid, tee, hole) {
  let rle = '';
  let run = null, len = 0;
  const flush = () => { if (run !== null) rle += run + (len > 1 ? String(len) : ''); };
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const ch = TILE_TO_CHAR[grid[y][x]];
      if (ch === run) len++;
      else { flush(); run = ch; len = 1; }
    }
  }
  flush();
  const p2 = (v) => String(v).padStart(2, '0');
  return `v1${p2(tee.x)}${p2(tee.y)}${p2(hole.x)}${p2(hole.y)}:${rle}`;
}

// Returns a playable course (with solver-verified par) or null if the code is
// malformed or the course can't be finished.
export function decodeCourse(code) {
  const m = /^v1(\d{2})(\d{2})(\d{2})(\d{2}):([frswt0-9]+)$/.exec(code || '');
  if (!m) return null;
  const tee = { x: +m[1], y: +m[2] };
  const hole = { x: +m[3], y: +m[4] };
  if (!inBounds(tee.x, tee.y) || !inBounds(hole.x, hole.y)) return null;
  if (tee.x === hole.x && tee.y === hole.y) return null;
  const cells = [];
  const re = /([frswt])(\d*)/g;
  let mm;
  while ((mm = re.exec(m[5]))) {
    const t = TILE_TO_CHAR.indexOf(mm[1]);
    for (let i = 0; i < (+mm[2] || 1); i++) cells.push(t);
  }
  if (cells.length !== COLS * ROWS) return null;
  const grid = [];
  for (let y = 0; y < ROWS; y++) grid.push(cells.slice(y * COLS, (y + 1) * COLS));
  const landable = (p) => grid[p.y][p.x] !== TREE && grid[p.y][p.x] !== WATER;
  if (!landable(tee) || !landable(hole)) return null;
  let rollSeed = hashSeed(0xcafe, code.length);
  for (let i = 0; i < code.length; i++) rollSeed = hashSeed(rollSeed, code.charCodeAt(i));
  const course = { grid, tee, hole, rollSeed, custom: true };
  const min = solve(course);
  if (!Number.isFinite(min)) return null;
  return { ...course, min, par: min + 1 };
}

// --- calendar --------------------------------------------------------------------

// Puzzle #1 is launch day; the number advances at each player's local
// midnight (Wordle's model). Constructed from local date parts so DST never
// skips or repeats a puzzle.
export const EPOCH = { y: 2026, m: 6, d: 15 }; // 2026-07-15 (month is 0-based)

export function puzzleNumber(date = new Date()) {
  const a = new Date(EPOCH.y, EPOCH.m, EPOCH.d);
  const b = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((b - a) / 864e5) + 1;
}

export function msUntilNextPuzzle(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next - now;
}
