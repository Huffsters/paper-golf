// Daily leaderboard API (Cloudflare Pages Function + D1 binding named DB).
//
//   GET  /api/scores?puzzle=N&playerId=UUID  -> { top, total, me? }
//   POST /api/scores {puzzle, playerId, name, strokes, trail} -> same, after insert
//
// Reuses the game's own course generator: a submitted score below the solver's
// optimal is impossible and rejected. One score per player per puzzle (first
// post stands). No accounts — this is a family-friendly honor-system board.

import { generateCourse, EPOCH } from '../../js/course.js';

const TOP_N = 50;
const TRAIL_GLYPHS = new Set(['🟩', '🟦', '🌲', '🟨', '⛳', '❌']);

// Untimed rows (pre-timer entries, or a client that never sent a time) sort
// after any timed row with the same strokes.
const NO_TIME = 999999999999;

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS scores (
       puzzle INTEGER NOT NULL,
       player_id TEXT NOT NULL,
       name TEXT NOT NULL,
       strokes INTEGER NOT NULL,
       trail TEXT NOT NULL DEFAULT '',
       time_ms INTEGER,
       created_at INTEGER NOT NULL,
       PRIMARY KEY (puzzle, player_id))`,
  ).run();
  try {
    // Migrate tables created before the round timer existed.
    await db.prepare('ALTER TABLE scores ADD COLUMN time_ms INTEGER').run();
  } catch { /* column already exists */ }
  await db.prepare(
    'CREATE INDEX IF NOT EXISTS scores_by_puzzle ON scores(puzzle, strokes, created_at)',
  ).run();
  schemaReady = true;
}

// Server-side puzzle number is UTC-based; players roll over at local midnight,
// so accept +/-1 day around it.
function puzzleInWindow(n) {
  const utcNow = Math.floor((Date.now() - Date.UTC(EPOCH.y, EPOCH.m, EPOCH.d)) / 864e5) + 1;
  return Number.isInteger(n) && Math.abs(n - utcNow) <= 1;
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

async function boardFor(db, puzzle, playerId) {
  // Fewest strokes wins; time is the tie-breaker, then post order.
  const { results: top } = await db
    .prepare(`SELECT name, strokes, trail, time_ms FROM scores WHERE puzzle=?1
              ORDER BY strokes, COALESCE(time_ms, ${NO_TIME}), created_at LIMIT ?2`)
    .bind(puzzle, TOP_N).all();
  const { n: total } = await db
    .prepare('SELECT COUNT(*) AS n FROM scores WHERE puzzle=?1').bind(puzzle).first();
  let me = null;
  if (playerId) {
    const mine = await db
      .prepare('SELECT strokes, time_ms, created_at FROM scores WHERE puzzle=?1 AND player_id=?2')
      .bind(puzzle, playerId).first();
    if (mine) {
      const myTime = mine.time_ms ?? NO_TIME;
      const { n } = await db
        .prepare(`SELECT COUNT(*) AS n FROM scores WHERE puzzle=?1 AND (
                    strokes < ?2 OR (strokes = ?2 AND (
                      COALESCE(time_ms, ${NO_TIME}) < ?3 OR
                      (COALESCE(time_ms, ${NO_TIME}) = ?3 AND created_at < ?4))))`)
        .bind(puzzle, mine.strokes, myTime, mine.created_at).first();
      me = { rank: n + 1, strokes: mine.strokes, timeMs: mine.time_ms };
    }
  }
  return { top, total, me };
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: 'leaderboard not configured' }, 503);
  const url = new URL(request.url);
  const puzzle = Number(url.searchParams.get('puzzle'));
  if (!puzzleInWindow(puzzle)) return json({ error: 'bad puzzle' }, 400);
  await ensureSchema(env.DB);
  return json(await boardFor(env.DB, puzzle, url.searchParams.get('playerId') || null));
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: 'leaderboard not configured' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }

  const puzzle = Number(body.puzzle);
  const strokes = Number(body.strokes);
  const playerId = String(body.playerId || '');
  const name = String(body.name || '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 16);
  const trail = [...String(body.trail || '')].filter((g) => TRAIL_GLYPHS.has(g)).slice(0, 13).join('');

  if (!puzzleInWindow(puzzle)) return json({ error: 'bad puzzle' }, 400);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(playerId)) {
    return json({ error: 'bad player id' }, 400);
  }
  if (!name) return json({ error: 'name required' }, 400);

  // A legal finished round is between the solver's optimum and the pickup cap.
  const course = generateCourse(puzzle);
  if (!Number.isInteger(strokes) || strokes < course.min || strokes > course.par + 5) {
    return json({ error: 'impossible score' }, 400);
  }

  // Round time is honor-system like the score itself; just keep it sane.
  let timeMs = Number(body.timeMs);
  timeMs = Number.isInteger(timeMs) && timeMs > 0 && timeMs < 86400000 ? timeMs : null;

  await ensureSchema(env.DB);
  await env.DB
    .prepare('INSERT OR IGNORE INTO scores (puzzle, player_id, name, strokes, trail, time_ms, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(puzzle, playerId, name, strokes, trail, timeMs, Date.now()).run();
  return json(await boardFor(env.DB, puzzle, playerId));
}
