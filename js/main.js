// Game shell: wires the course, renderer, input, persistence, and modals.

import {
  generateCourse, puzzleNumber, msUntilNextPuzzle,
  CLUBS, DIRS, clubAllowed, aimInBounds, resolveShot,
} from './course.js';
import * as R from './render.js';
import { loadStats, loadProgress, saveProgress, recordResult, resultInfo, firstVisit, playerId, getName, setName } from './state.js';
import { buildShareText, share } from './share.js';
import { fetchBoard, submitScore } from './leaderboard.js';

const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const $ = (id) => document.getElementById(id);

const number = puzzleNumber();
const course = generateCourse(number);
const MAX_STROKES = course.par + 5;

const layers = R.initBoard($('board'), course);
const progress = loadProgress(number);

const game = {
  ball: { ...course.tee },
  strokes: 0,
  inSand: false,
  over: false,
  pickedUp: false,
  trail: [], // one emoji per swing
};
let selClub = null;
let selDir = null;
let animating = false;
let finalStats = loadStats();

// --- core turn -------------------------------------------------------------

async function shoot(clubIdx, dirIdx, live) {
  const club = CLUBS[clubIdx];
  const dir = DIRS[dirIdx];
  const from = { ...game.ball };
  const r = resolveShot(course, from, dir, club.dist);
  if (r.oob) return; // defensive; the UI never offers these

  game.strokes += r.water ? 2 : 1; // water = stroke + penalty stroke
  game.trail.push(r.holed ? '⛳' : r.water ? '🟦' : r.sand ? '🟨' : r.blocked ? '🌲' : '🟩');
  if (!r.water) {
    game.ball = { x: r.x, y: r.y };
    game.inSand = r.sand;
  }

  if (live) {
    animating = true;
    R.clearAim(layers);
    selDir = null;
    R.drawShot(layers, from, r, game.strokes, r.holed ? 'holed' : r.water ? 'splash' : 'rest');
    R.moveBall(layers, r.x, r.y, true);
    await wait(290);
    if (r.blocked && !r.water) R.fxLabel(layers, 'thunk!', r.x, r.y, '#7a5a3a');
    if (r.holed) R.fxLabel(layers, 'in!', r.x, r.y, '#2e6b3d');
    if (r.sand) R.fxLabel(layers, 'plugged!', r.x, r.y, '#b06f1a');
    if (r.water) {
      R.fxLabel(layers, 'splash! +1', r.x, r.y);
      await wait(450);
      R.moveBall(layers, from.x, from.y, true);
      await wait(290);
    }
    animating = false;
    progress.shots.push([clubIdx, dirIdx]);
    saveProgress(progress);
  } else {
    R.drawShot(layers, from, r, game.strokes, r.holed ? 'holed' : r.water ? 'splash' : 'rest');
    R.moveBall(layers, game.ball.x, game.ball.y, false);
  }

  if (r.holed) {
    finish(live);
  } else if (game.strokes >= MAX_STROKES) {
    game.pickedUp = true;
    game.trail.push('❌');
    finish(live);
  }
  updateHud();
  if (!game.over && (selClub === null || !clubAllowed(CLUBS[selClub], game.inSand))) {
    selClub = pickDefaultClub();
  }
  renderClubs();
  if (!game.over && live) renderAim();
}

function finish(live) {
  game.over = true;
  R.clearAim(layers);
  const diff = game.strokes - course.par;
  const info = resultInfo(diff, game.pickedUp);
  if (live && !progress.done) {
    progress.done = true;
    saveProgress(progress);
    finalStats = recordResult(number, info.bucket);
  }
  setHint(game.pickedUp ? 'That’s the stroke limit — pick up. Tomorrow’s hole awaits.' : `${info.name} — see you tomorrow!`);
  setTimeout(openEndModal, live ? 700 : 250);
}

function pickDefaultClub() {
  return game.inSand ? CLUBS.findIndex((c) => clubAllowed(c, true)) : 0;
}

// --- aiming ----------------------------------------------------------------

function renderAim() {
  if (game.over || selClub === null) { R.clearAim(layers); return; }
  const dist = CLUBS[selClub].dist;
  const targets = [];
  DIRS.forEach((dir, dirIdx) => {
    if (aimInBounds(game.ball, dir, dist)) {
      targets.push({ dirIdx, x: game.ball.x + dir.dx * dist, y: game.ball.y + dir.dy * dist });
    }
  });
  R.showAim(layers, game.ball, targets, selDir, onTargetTap);
  if (selDir === null) {
    setHint(game.inSand
      ? 'In the sand — only short clubs get you out. Tap a target.'
      : 'Tap a target to line up your shot.');
  }
}

async function onTargetTap(dirIdx) {
  if (animating || game.over) return;
  if (selDir === dirIdx) {
    const clubIdx = selClub;
    selDir = null;
    await shoot(clubIdx, dirIdx, true);
  } else {
    selDir = dirIdx;
    renderAim();
    setHint('Tap the target again to swing.');
  }
}

// --- chrome ----------------------------------------------------------------

function updateHud() {
  $('hud-hole').textContent = `Hole #${number}`;
  $('hud-par').textContent = `Par ${course.par}`;
  $('hud-strokes').textContent = `Strokes ${game.strokes}`;
}

function setHint(text) {
  $('hint').textContent = text;
}

function renderClubs() {
  const wrap = $('clubs');
  wrap.replaceChildren();
  CLUBS.forEach((club, i) => {
    const btn = document.createElement('button');
    btn.className = 'club' + (i === selClub ? ' selected' : '');
    btn.disabled = game.over || !clubAllowed(club, game.inSand);
    btn.innerHTML = `${club.name}<span class="dist">${club.dist}</span>`;
    btn.addEventListener('click', () => {
      if (animating || game.over) return;
      selClub = i;
      selDir = null;
      renderClubs();
      renderAim();
    });
    wrap.appendChild(btn);
  });
}

// --- modals ----------------------------------------------------------------

function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }

for (const m of document.querySelectorAll('.modal')) {
  m.addEventListener('pointerdown', (e) => { if (e.target === m) m.classList.remove('open'); });
  m.querySelector('.close')?.addEventListener('click', () => m.classList.remove('open'));
}
$('btn-help').addEventListener('click', () => openModal('modal-help'));
$('btn-stats').addEventListener('click', () => { renderStats($('stats-body')); openModal('modal-stats'); });

function renderStats(container) {
  const s = loadStats();
  const buckets = [
    ['birdie', 'Birdie'], ['par', 'Par'], ['bogey', 'Bogey'],
    ['double', '+2'], ['worse', '+3 or more'], ['pickup', 'Picked up'],
  ];
  const max = Math.max(1, ...buckets.map(([k]) => s.dist[k] || 0));
  container.innerHTML = `
    <div class="stat-row">
      <div class="stat"><b>${s.played}</b><span>played</span></div>
      <div class="stat"><b>${s.streak}</b><span>streak</span></div>
      <div class="stat"><b>${s.maxStreak}</b><span>best streak</span></div>
    </div>
    <div class="bars">
      ${buckets.map(([k, label]) => {
        const n = s.dist[k] || 0;
        return `<div class="bar-row"><span class="bar-label">${label}</span>
          <span class="bar"><i style="width:${(n / max) * 100}%"></i></span>
          <span class="bar-n">${n}</span></div>`;
      }).join('')}
    </div>`;
}

function openEndModal() {
  const diff = game.strokes - course.par;
  const info = resultInfo(diff, game.pickedUp);
  $('end-title').textContent = info.name;
  $('end-sub').textContent = game.pickedUp
    ? `Hole #${number} — picked up at ${game.strokes} strokes (par ${course.par})`
    : `Hole #${number} — ${game.strokes} strokes, par ${course.par}`;
  $('end-trail').textContent = game.trail.join('');
  renderStats($('end-stats'));
  startCountdown();
  initLeaderboardUI();
  openModal('modal-end');
}

// --- leaderboard -----------------------------------------------------------

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function renderBoard(container, data) {
  const meLine = data.me
    ? `<p class="lb-me">You’re #${data.me.rank} of ${data.total} today</p>`
    : `<p class="lb-me">${data.total} posted today</p>`;
  const rows = data.top.map((r, i) =>
    `<li><span class="lb-rank">${i + 1}</span><span class="lb-nm">${escapeHtml(r.name)}</span><span class="lb-tr">${escapeHtml(r.trail || '')}</span><b>${r.strokes}</b></li>`,
  ).join('');
  container.classList.remove('muted');
  container.innerHTML = meLine + (rows
    ? `<ol class="lb-list">${rows}</ol>`
    : '<p class="muted">No scores posted yet — be the first!</p>');
}

async function initLeaderboardUI() {
  const submitBox = $('lb-submit');
  const body = $('lb-body');
  submitBox.hidden = game.pickedUp || !!progress.posted;
  $('lb-name').value = getName();
  body.textContent = 'Loading…';
  try {
    renderBoard(body, await fetchBoard(number, playerId()));
  } catch {
    submitBox.hidden = true;
    body.textContent = 'Leaderboard unavailable.';
  }
}

$('lb-post').addEventListener('click', async () => {
  const name = $('lb-name').value.trim();
  if (!name) { $('lb-name').focus(); return; }
  setName(name);
  const btn = $('lb-post');
  btn.disabled = true;
  btn.textContent = 'Posting…';
  try {
    const res = await submitScore({
      puzzle: number, playerId: playerId(), name,
      strokes: game.strokes, trail: game.trail.join(''),
    });
    progress.posted = true;
    saveProgress(progress);
    $('lb-submit').hidden = true;
    renderBoard($('lb-body'), res);
  } catch {
    btn.disabled = false;
    btn.textContent = 'Post my score';
    $('lb-body').textContent = 'Couldn’t post — try again in a minute.';
  }
});

$('btn-board').addEventListener('click', async () => {
  openModal('modal-board');
  const body = $('board-body');
  body.textContent = 'Loading…';
  try {
    renderBoard(body, await fetchBoard(number, playerId()));
  } catch {
    body.textContent = 'Leaderboard unavailable.';
  }
});

$('btn-share').addEventListener('click', async () => {
  const diff = game.strokes - course.par;
  const info = resultInfo(diff, game.pickedUp);
  const text = buildShareText({
    number, par: course.par, strokes: game.strokes, trail: game.trail,
    resultName: info.name, streak: finalStats.streak, pickedUp: game.pickedUp,
  });
  const how = await share(text);
  const btn = $('btn-share');
  if (how === 'copied') { btn.textContent = 'Copied!'; setTimeout(() => (btn.textContent = 'Share'), 1600); }
  if (how === 'failed') { btn.textContent = 'Couldn’t copy'; setTimeout(() => (btn.textContent = 'Share'), 1600); }
});

let countdownTimer = null;
function startCountdown() {
  clearInterval(countdownTimer);
  const tick = () => {
    const ms = msUntilNextPuzzle();
    const h = String(Math.floor(ms / 3.6e6)).padStart(2, '0');
    const m = String(Math.floor((ms % 3.6e6) / 6e4)).padStart(2, '0');
    const s = String(Math.floor((ms % 6e4) / 1e3)).padStart(2, '0');
    $('countdown').textContent = `${h}:${m}:${s}`;
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

// --- boot ------------------------------------------------------------------

async function boot() {
  updateHud();
  // Replay a saved in-progress (or finished) round for today.
  for (const [c, d] of progress.shots) {
    if (game.over) break;
    await shoot(c, d, false);
  }
  if (!game.over) {
    selClub = pickDefaultClub();
    renderClubs();
    renderAim();
    if (firstVisit()) openModal('modal-help');
  } else {
    renderClubs();
  }
}

boot();
