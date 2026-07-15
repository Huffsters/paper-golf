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
       created_at INTEGER NOT NULL,
       PRIMARY KEY (puzzle, player_id))`,
  ).run();
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
  const { results: top } = await db
    .prepare('SELECT name, strokes, trail FROM scores WHERE puzzle=?1 ORDER BY strokes, created_at LIMIT ?2')
    .bind(puzzle, TOP_N).all();
  const { n: total } = await db
    .prepare('SELECT COUNT(*) AS n FROM scores WHERE puzzle=?1').bind(puzzle).first();
  let me = null;
  if (playerId) {
    const mine = await db
      .prepare('SELECT strokes, created_at FROM scores WHERE puzzle=?1 AND player_id=?2')
      .bind(puzzle, playerId).first();
    if (mine) {
      const { n } = await db
        .prepare('SELECT COUNT(*) AS n FROM scores WHERE puzzle=?1 AND (strokes < ?2 OR (strokes = ?2 AND created_at < ?3))')
        .bind(puzzle, mine.strokes, mine.created_at).first();
      me = { rank: n + 1, strokes: mine.strokes };
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

  await ensureSchema(env.DB);
  await env.DB
    .prepare('INSERT OR IGNORE INTO scores (puzzle, player_id, name, strokes, trail, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(puzzle, playerId, name, strokes, trail, Date.now()).run();
  return json(await boardFor(env.DB, puzzle, playerId));
}
