// Course model: generation (seeded by puzzle number), shot resolution, and a
// BFS solver that proves solvability and sets par. Pure logic, no DOM — also
// imported by the node test harness.

import { mulberry32, hashSeed, rint } from './rng.js';

export const COLS = 13;
export const ROWS = 19;

export const FAIRWAY = 0;
export const TREE = 1;
export const SAND = 2;
export const WATER = 3;

export const CLUBS = [
  { id: 'driver', name: 'Driver', dist: 6 },
  { id: 'iron', name: 'Iron', dist: 4 },
  { id: 'wedge', name: 'Wedge', dist: 2 },
  { id: 'putter', name: 'Putter', dist: 1 },
];

// 8 compass directions, clockwise from north.
export const DIRS = [
  { dx: 0, dy: -1 }, { dx: 1, dy: -1 }, { dx: 1, dy: 0 }, { dx: 1, dy: 1 },
  { dx: 0, dy: 1 }, { dx: -1, dy: 1 }, { dx: -1, dy: 0 }, { dx: -1, dy: -1 },
];

// From sand you can only play the short clubs (dist <= 2).
export const SAND_MAX_DIST = 2;

export function inBounds(x, y) {
  return x >= 0 && x < COLS && y >= 0 && y < ROWS;
}

export function clubAllowed(club, inSand) {
  return !inSand || club.dist <= SAND_MAX_DIST;
}

// Fly the ball `dist` cells from `from` along `dir`. The ball flies over sand
// and water (only the landing cell matters) but trees block it mid-flight.
// Returns landing cell plus what happened. `oob` shots are disallowed by the
// UI and solver, but resolve defensively anyway (ball stays put).
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
    holed,
  };
}

// True if aiming `dist` in `dir` from `from` stays on the paper (raw target
// in bounds). Off-paper aims are simply not offered to the player.
export function aimInBounds(from, dir, dist) {
  return inBounds(from.x + dir.dx * dist, from.y + dir.dy * dist);
}

// BFS over (position, inSand) states; every swing costs 1. Water and OOB
// shots return the ball with an extra stroke, so they are never on a shortest
// path and are skipped. Returns minimum strokes to hole out, or Infinity.
export function solve(course) {
  const stateKey = (x, y, s) => (y * COLS + x) * 2 + (s ? 1 : 0);
  const seen = new Uint8Array(COLS * ROWS * 2);
  let frontier = [{ x: course.tee.x, y: course.tee.y, sand: false }];
  seen[stateKey(course.tee.x, course.tee.y, false)] = 1;
  for (let strokes = 1; frontier.length > 0 && strokes <= 30; strokes++) {
    const next = [];
    for (const st of frontier) {
      for (const dir of DIRS) {
        for (const club of CLUBS) {
          if (!clubAllowed(club, st.sand)) continue;
          if (!aimInBounds(st, dir, club.dist)) continue;
          const r = resolveShot(course, st, dir, club.dist);
          if (r.oob || r.water) continue;
          if (r.holed) return strokes;
          if (r.x === st.x && r.y === st.y) continue; // fully blocked, no progress
          const key = stateKey(r.x, r.y, r.sand);
          if (seen[key]) continue;
          seen[key] = 1;
          next.push({ x: r.x, y: r.y, sand: r.sand });
        }
      }
    }
    frontier = next;
  }
  return Infinity;
}

// Grow an organic blob of `type` from a seed cell, only claiming fairway.
function growBlob(rand, grid, seedX, seedY, size, type) {
  if (grid[seedY][seedX] !== FAIRWAY) return;
  const cells = [{ x: seedX, y: seedY }];
  grid[seedY][seedX] = type;
  const sides = [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }];
  for (let i = 1, tries = 0; i < size && tries < size * 8; tries++) {
    const c = cells[Math.floor(rand() * cells.length)];
    const s = sides[Math.floor(rand() * sides.length)];
    const nx = c.x + s.dx, ny = c.y + s.dy;
    if (!inBounds(nx, ny) || grid[ny][nx] !== FAIRWAY) continue;
    grid[ny][nx] = type;
    cells.push({ x: nx, y: ny });
    i++;
  }
}

function tryGenerate(rand) {
  const grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(FAIRWAY));
  const tee = { x: rint(rand, 2, COLS - 3), y: ROWS - 2 };
  const hole = { x: rint(rand, 2, COLS - 3), y: rint(rand, 1, 2) };

  // Water: 1-2 blobs in the middle band.
  const nWater = rint(rand, 1, 2);
  for (let i = 0; i < nWater; i++) {
    growBlob(rand, grid, rint(rand, 1, COLS - 2), rint(rand, 4, ROWS - 6), rint(rand, 6, 13), WATER);
  }

  // Hedge: a horizontal tree line with a gap, most days.
  if (rand() < 0.65) {
    const row = rint(rand, 6, ROWS - 7);
    const x0 = rint(rand, 0, 2);
    const x1 = COLS - 1 - rint(rand, 0, 2);
    const gapAt = rint(rand, x0 + 1, x1 - 1);
    const gapW = rint(rand, 1, 2);
    for (let x = x0; x <= x1; x++) {
      if (x >= gapAt && x < gapAt + gapW) continue;
      if (grid[row][x] === FAIRWAY) grid[row][x] = TREE;
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

  // Keep the tee and the green playable: clear a 1-cell ring around each.
  for (const p of [tee, hole]) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = p.x + dx, ny = p.y + dy;
        if (inBounds(nx, ny)) grid[ny][nx] = FAIRWAY;
      }
    }
  }

  return { grid, tee, hole };
}

// Generate the course for puzzle #n. Deterministically retries (bumping an
// attempt counter mixed into the seed) until the solver confirms the hole is
// interesting: reachable in 3-6 optimal strokes. Par is optimal + 1, so a
// perfect round scores a birdie.
export function generateCourse(n) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const rand = mulberry32(hashSeed(0x60f1, n, attempt));
    const course = tryGenerate(rand);
    const min = solve(course);
    if (min >= 3 && min <= 6) {
      return { ...course, min, par: min + 1, number: n, attempt };
    }
  }
  // Practically unreachable; an empty course is always solvable.
  const grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(FAIRWAY));
  const course = { grid, tee: { x: 6, y: ROWS - 2 }, hole: { x: 6, y: 1 }, number: n, attempt: -1 };
  const min = solve(course);
  return { ...course, min, par: min + 1 };
}

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
