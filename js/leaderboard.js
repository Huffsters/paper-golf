// Client for the daily leaderboard API (Pages Function at /api/scores).
// Both calls throw on any failure; callers degrade gracefully, so the game
// works unchanged when the API is absent (e.g. plain local static server).

export async function fetchBoard(puzzle, playerId) {
  const r = await fetch(`/api/scores?puzzle=${puzzle}&playerId=${encodeURIComponent(playerId)}`);
  if (!r.ok) throw new Error(`fetch board: ${r.status}`);
  return r.json();
}

export async function submitScore({ puzzle, playerId, name, strokes, trail }) {
  const r = await fetch('/api/scores', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ puzzle, playerId, name, strokes, trail }),
  });
  if (!r.ok) throw new Error(`submit: ${r.status}`);
  return r.json();
}
