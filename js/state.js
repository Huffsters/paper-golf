// localStorage persistence: lifetime stats + today's in-progress round.

const STATS_KEY = 'pg-stats';
const PROG_KEY = 'pg-progress';

const DEFAULT_STATS = {
  played: 0,
  streak: 0,
  maxStreak: 0,
  lastCompleted: 0, // puzzle number of the last successfully-finished round
  dist: { birdie: 0, par: 0, bogey: 0, double: 0, worse: 0, pickup: 0 },
};

export function loadStats() {
  try {
    const s = JSON.parse(localStorage.getItem(STATS_KEY)) || {};
    return { ...DEFAULT_STATS, ...s, dist: { ...DEFAULT_STATS.dist, ...(s.dist || {}) } };
  } catch {
    return structuredClone(DEFAULT_STATS);
  }
}

function saveStats(stats) {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch { /* private mode */ }
}

// Map a finished round to a result bucket + display name.
export function resultInfo(diff, pickedUp) {
  if (pickedUp) return { bucket: 'pickup', name: 'Picked up 😖' };
  if (diff <= -2) return { bucket: 'birdie', name: 'Eagle!! 🦅' }; // par = optimal+1, so shouldn't happen
  if (diff === -1) return { bucket: 'birdie', name: 'Birdie! 🐦' };
  if (diff === 0) return { bucket: 'par', name: 'Par 👌' };
  if (diff === 1) return { bucket: 'bogey', name: 'Bogey' };
  if (diff === 2) return { bucket: 'double', name: 'Double Bogey' };
  return { bucket: 'worse', name: `+${diff}` };
}

// Record a finished round. Streak counts consecutive days finished without
// picking up. Returns the updated stats.
export function recordResult(puzzle, bucket) {
  const stats = loadStats();
  stats.played++;
  stats.dist[bucket] = (stats.dist[bucket] || 0) + 1;
  if (bucket === 'pickup') {
    stats.streak = 0;
  } else {
    stats.streak = stats.lastCompleted === puzzle - 1 ? stats.streak + 1 : 1;
    stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
    stats.lastCompleted = puzzle;
  }
  saveStats(stats);
  return stats;
}

// Today's round: {puzzle, fmt, shots: [dirIdx, ...], done, startedAt?, timeMs?, posted?}
// fmt 2 = dice engine (one direction per swing; distances replay from the
// seeded rolls). Older-format progress is discarded rather than misread.
export function loadProgress(puzzle) {
  try {
    const p = JSON.parse(localStorage.getItem(PROG_KEY));
    if (p && p.puzzle === puzzle && p.fmt === 2 && Array.isArray(p.shots)) return p;
  } catch { /* fall through */ }
  return { puzzle, fmt: 2, shots: [], done: false };
}

export function saveProgress(progress) {
  try { localStorage.setItem(PROG_KEY, JSON.stringify(progress)); } catch { /* private mode */ }
}

// Anonymous per-browser identity + display name for the leaderboard.
export function playerId() {
  try {
    let id = localStorage.getItem('pg-player');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('pg-player', id);
    }
    return id;
  } catch {
    return crypto.randomUUID(); // private mode: valid for this visit only
  }
}

export function getName() {
  try { return localStorage.getItem('pg-name') || ''; } catch { return ''; }
}

export function setName(name) {
  try { localStorage.setItem('pg-name', name); } catch { /* private mode */ }
}

const SEEN_KEY = 'pg-seen-help';
export function firstVisit() {
  try {
    if (localStorage.getItem(SEEN_KEY)) return false;
    localStorage.setItem(SEEN_KEY, '1');
    return true;
  } catch {
    return false;
  }
}
