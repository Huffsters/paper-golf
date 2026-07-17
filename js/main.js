// Game shell: wires the course, renderer, dice, input, persistence, modals,
// and the course editor. Modes: 'daily' (timed, stats, leaderboard, streak),
// 'free' (endless random holes), 'custom' (shared course links), 'edit'.

import {
  generateCourse, decodeCourse, puzzleNumber, msUntilNextPuzzle,
  DIRS, aimInBounds, resolveShot, turnDistance, lieName,
} from './course.js?v=9';
import * as R from './render.js?v=9';
import * as ED from './editor.js?v=9';
import { loadStats, loadProgress, saveProgress, recordResult, resultInfo, firstVisit, playerId, getName, setName } from './state.js?v=9';
import { buildShareText, share, fmtTime } from './share.js?v=9';
import { fetchBoard, submitScore } from './leaderboard.js?v=9';

const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const $ = (id) => document.getElementById(id);

const dailyNumber = puzzleNumber();
const dailyCourse = generateCourse(dailyNumber);
const progress = loadProgress(dailyNumber);

let mode = 'daily'; // 'daily' | 'free' | 'custom' | 'edit'
let course = dailyCourse;
let layers = null;
let game = null;
let selKey = null; // currently-lined-up aim target: 'r'+dir (roll) or 'p'+dir (putt)
let animating = false;
let finalStats = loadStats();
let customCode = null;      // course code when mode === 'custom'
let customFromEditor = false;

const isDaily = () => mode === 'daily';
const maxStrokes = () => course.par + 5;

const MULLIGANS = 2; // reroll tokens per round, on top of the first-shot freebie

// --- round lifecycle ---------------------------------------------------------

function startRound(newMode, newCourse, opts = {}) {
  mode = newMode;
  course = newCourse;
  customCode = opts.code || null;
  customFromEditor = !!opts.fromEditor;
  layers = R.initBoard($('board'), course);
  // draw = index into the seeded roll stream; committed = shots played;
  // rerolls advance draw and burn freeUsed / mulligansUsed.
  game = {
    ball: { ...course.tee }, strokes: 0, committed: 0, over: false, pickedUp: false,
    trail: [], draw: 0, rolled: false, freeUsed: false, mulligansUsed: 0, turn: null,
  };
  selKey = null;
  stopTicker();
  $('hud-timebox').hidden = true;
  $('dice').hidden = false;
  $('editor-bar').hidden = true;
  updateHud();
  updateFooter();
  promptRoll();
}

// Build the daily round from saved progress (replays today's shots by their
// recorded draw index, then restores the live resource counters).
async function loadDaily() {
  startRound('daily', dailyCourse);
  for (const [dirIdx, putt, drawIdx] of progress.shots) {
    if (game.over) break;
    await shoot(dirIdx, !!putt, false, drawIdx);
  }
  game.freeUsed = !!progress.freeUsed;
  game.mulligansUsed = progress.mulligansUsed || 0;
  if (progress.draw != null) game.draw = progress.draw;
  if (!game.over) {
    if (progress.startedAt) startTicker(); // resume the clock mid-round
    promptRoll();
  }
}

function randomCourse() {
  return generateCourse(1e6 + Math.floor(Math.random() * 2 ** 30));
}

// --- round timer (daily only) ------------------------------------------------

let ticker = null;

function startTicker() {
  stopTicker();
  $('hud-timebox').hidden = false;
  const tick = () => { $('hud-time').textContent = fmtTime(Date.now() - progress.startedAt); };
  tick();
  ticker = setInterval(tick, 1000);
}

function stopTicker() {
  clearInterval(ticker);
  ticker = null;
}

function showFinalTime() {
  if (isDaily() && progress.timeMs != null) {
    $('hud-timebox').hidden = false;
    $('hud-time').textContent = fmtTime(progress.timeMs);
  }
}

// --- dice turn ------------------------------------------------------------------
// Each swing: the player taps Roll to reveal this draw's die, may spend a
// reroll (free first-shot one, or a mulligan) to advance to the next draw, then
// aims. The roll value is still seeded — Roll just hands the reveal to the
// player instead of doing it automatically.

// Start of a swing: hide the die, show the Roll button.
function promptRoll() {
  game.rolled = false;
  game.turn = null;
  selKey = null;
  R.clearAim(layers);
  if (game.over) { $('dice').hidden = true; return; }
  $('dice').hidden = false;
  $('btn-roll').hidden = false;
  $('die').toggleAttribute('hidden', true); // SVG: no `hidden` IDL prop, set the attribute
  $('roll-text').innerHTML = '';
  $('btn-free').hidden = true;
  $('btn-mull').hidden = true;
  setHint('Tap Roll to take your shot 🎲');
}

async function animateDie(frames) {
  animating = true;
  for (let i = 0; i < frames; i++) {
    R.drawDie($('die'), 1 + Math.floor(Math.random() * 6));
    await wait(70);
  }
  animating = false;
}

async function doRoll() {
  if (animating || game.over || game.rolled) return;
  if (isDaily() && !progress.startedAt) {
    progress.startedAt = Date.now(); // the clock starts at your first roll
    startTicker();
  }
  $('btn-roll').hidden = true;
  $('die').toggleAttribute('hidden', false); // SVG: no `hidden` IDL prop, drop the attribute
  await animateDie(4);
  game.rolled = true;
  revealTurn();
}

async function doReroll(kind) {
  if (animating || game.over || !game.rolled) return;
  if (kind === 'free') {
    if (game.committed !== 0 || game.freeUsed) return;
    game.freeUsed = true;
  } else {
    if (game.mulligansUsed >= MULLIGANS) return;
    game.mulligansUsed += 1;
  }
  game.draw += 1;
  if (isDaily()) {
    progress.draw = game.draw;
    progress.freeUsed = game.freeUsed;
    progress.mulligansUsed = game.mulligansUsed;
    saveProgress(progress);
  }
  selKey = null;
  R.clearAim(layers);
  await animateDie(3);
  revealTurn();
}

// Show this draw's die, the reroll options, and the aim targets.
function revealTurn() {
  const t = turnDistance(course, game.ball, game.draw);
  game.turn = t;
  R.drawDie($('die'), t.roll);
  const modTxt = t.mod > 0 ? ' +1 fairway' : t.mod < 0 ? ' −1 sand' : '';
  const puttNote = t.dist > 1 ? ' <span class="putt-note">· or putt 1</span>' : '';
  $('roll-text').innerHTML = `Rolled <b>${t.roll}</b>${modTxt} → fly <b>${t.dist}</b> square${t.dist === 1 ? '' : 's'}${puttNote}`;
  $('btn-free').hidden = !(game.committed === 0 && !game.freeUsed);
  const mullLeft = MULLIGANS - game.mulligansUsed;
  $('btn-mull').hidden = mullLeft <= 0;
  $('btn-mull').textContent = `🔄 mulligan (${mullLeft})`;
  updateHud();
  renderAim();
}

// --- core turn -----------------------------------------------------------------

async function shoot(dirIdx, putt, live, drawOverride) {
  const drawIdx = drawOverride ?? game.draw;
  const t = turnDistance(course, game.ball, drawIdx);
  const dist = putt ? 1 : t.dist; // a putt is always exactly 1 square
  const dir = DIRS[dirIdx];
  const from = { ...game.ball };
  const r = resolveShot(course, from, dir, dist);
  if (r.oob) return; // defensive; the UI never offers these

  game.committed += 1;
  game.draw = drawIdx + 1; // next swing draws a fresh roll from the stream
  game.strokes += r.water ? 2 : 1; // water = stroke + penalty stroke
  game.trail.push(r.holed ? '⛳' : r.water ? '🟦' : r.sand ? '🟨' : r.blocked ? '🌲' : r.rough ? '🟫' : '🟩');
  if (!r.water) game.ball = { x: r.x, y: r.y };

  if (live) {
    animating = true;
    R.clearAim(layers);
    selKey = null;
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
    if (isDaily()) {
      progress.shots.push([dirIdx, putt ? 1 : 0, drawIdx]);
      progress.draw = game.draw;
      saveProgress(progress);
    }
  } else {
    R.drawShot(layers, from, r, game.strokes, r.holed ? 'holed' : r.water ? 'splash' : 'rest');
    R.moveBall(layers, game.ball.x, game.ball.y, false);
  }

  if (r.holed) {
    finish(live);
  } else if (game.strokes >= maxStrokes()) {
    game.pickedUp = true;
    game.trail.push('❌');
    finish(live);
  }
  updateHud();
  if (!game.over && live) promptRoll(); // next swing waits for the player to Roll
}

function finish(live) {
  game.over = true;
  R.clearAim(layers);
  $('dice').hidden = true;
  stopTicker();
  const diff = game.strokes - course.par;
  const info = resultInfo(diff, game.pickedUp);
  if (isDaily()) {
    if (live && !progress.done) {
      progress.done = true;
      if (progress.startedAt && !game.pickedUp) {
        progress.timeMs = Date.now() - progress.startedAt;
      }
      saveProgress(progress);
      finalStats = recordResult(dailyNumber, info.bucket);
    }
    showFinalTime();
    setHint(game.pickedUp ? 'That’s the stroke limit — pick up. Tomorrow’s hole awaits.' : `${info.name} — see you tomorrow!`);
  } else {
    setHint(`${info.name} — grab another hole any time.`);
  }
  setTimeout(openEndModal, live ? 700 : 250);
}

// --- aiming --------------------------------------------------------------------

function renderAim() {
  if (game.over || !game.turn) { R.clearAim(layers); return; }
  const dist = game.turn.dist;
  const targets = [];
  DIRS.forEach((dir, dirIdx) => {
    if (aimInBounds(game.ball, dir, dist)) {
      targets.push({ key: `r${dirIdx}`, dirIdx, putt: false, x: game.ball.x + dir.dx * dist, y: game.ball.y + dir.dy * dist });
    }
    // The always-available 1-square putt — a separate ring, unless the roll is
    // already 1 (then the roll targets ARE the adjacent squares).
    if (dist > 1 && aimInBounds(game.ball, dir, 1)) {
      targets.push({ key: `p${dirIdx}`, dirIdx, putt: true, x: game.ball.x + dir.dx, y: game.ball.y + dir.dy });
    }
  });
  R.showAim(layers, game.ball, targets, selKey, onTargetTap);
  if (selKey === null) {
    const lie = {
      fairway: 'On the fairway: roll +1.',
      rough: 'In the rough: no bonus.',
      sand: 'In the sand: roll −1.',
    }[lieName(game.turn.cell)];
    setHint(dist > 1 ? `${lie} Tap a big target, or a small dot to putt 1.` : `${lie} Tap a target.`);
  }
}

async function onTargetTap(dirIdx, putt) {
  if (animating || game.over) return;
  const key = (putt ? 'p' : 'r') + dirIdx;
  if (selKey === key) {
    selKey = null;
    await shoot(dirIdx, putt, true);
  } else {
    selKey = key;
    renderAim();
    setHint(putt ? 'Tap again to putt 1 square.' : 'Tap the target again to swing.');
  }
}

// --- chrome --------------------------------------------------------------------

function updateHud() {
  $('hud-hole').textContent = { daily: `Hole #${dailyNumber}`, free: 'Free play', custom: 'Custom hole', edit: 'Editor' }[mode];
  $('hud-par').textContent = mode === 'edit' ? '✏️' : `Par ${course.par}`;
  $('hud-strokes').textContent = mode === 'edit' ? 'paint!' : `Strokes ${game.strokes}`;
  const mullBox = $('hud-mullbox');
  if (mode === 'edit' || !game) { mullBox.hidden = true; return; }
  mullBox.hidden = false;
  $('hud-mull').textContent = '🔄'.repeat(MULLIGANS - game.mulligansUsed) || '—';
}

function setHint(text) {
  $('hint').textContent = text;
}

function updateFooter() {
  $('footer-note').textContent = {
    daily: 'a new hole every midnight',
    free: 'free play — nothing counts',
    custom: 'a friend’s course — nothing counts',
    edit: 'draw, then share your hole',
  }[mode];
  $('btn-newfree').hidden = mode !== 'free';
  $('btn-freeplay').hidden = mode === 'edit';
  $('btn-freeplay').textContent = isDaily() ? 'free play ⛳' : 'today’s hole';
  $('btn-editor').textContent = mode === 'edit' ? 'exit editor' : 'editor ✏️';
}

$('btn-freeplay').addEventListener('click', async () => {
  if (animating) return;
  if (mode === 'edit') return;
  if (isDaily()) startRound('free', randomCourse());
  else await loadDaily();
});

$('btn-newfree').addEventListener('click', () => {
  if (animating) return;
  startRound('free', randomCourse());
});

$('btn-roll').addEventListener('click', doRoll);
$('btn-free').addEventListener('click', () => doReroll('free'));
$('btn-mull').addEventListener('click', () => doReroll('mull'));

// --- editor --------------------------------------------------------------------

function enterEditor() {
  mode = 'edit';
  stopTicker();
  $('hud-timebox').hidden = true;
  $('dice').hidden = true;
  $('editor-bar').hidden = false;
  updateHud();
  updateFooter();
  ED.openEditor($('board'), setHint);
}

async function exitEditor() {
  ED.closeEditor();
  $('editor-bar').hidden = true;
  await loadDaily();
}

$('btn-editor').addEventListener('click', async () => {
  if (animating) return;
  if (mode === 'edit') await exitEditor();
  else { ED.closeEditor(); enterEditor(); }
});

$('btn-ed-clear').addEventListener('click', () => ED.clearEditor());

$('btn-ed-test').addEventListener('click', () => {
  const res = ED.currentCourse();
  if (res.error) { setHint(res.error); return; }
  ED.closeEditor();
  $('editor-bar').hidden = true;
  startRound('custom', res.course, { code: res.code, fromEditor: true });
  setHint(`Par ${res.course.par} — play your hole!`);
});

$('btn-ed-share').addEventListener('click', async () => {
  const res = ED.currentCourse();
  if (res.error) { setHint(res.error); return; }
  const url = `${location.origin}/#c=${res.code}`;
  try {
    await navigator.clipboard.writeText(url);
    setHint(`Link copied! Par ${res.course.par} — send it to a friend.`);
  } catch {
    setHint(`Couldn’t copy — the link is: ${url}`);
  }
});

// --- modals --------------------------------------------------------------------

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
  const daily = isDaily();
  const where = { daily: `Hole #${dailyNumber}`, free: 'Free play', custom: 'Custom hole' }[mode];
  const timeStr = daily && progress.timeMs != null && !game.pickedUp ? ` · ${fmtTime(progress.timeMs)}` : '';
  $('end-title').textContent = info.name;
  $('end-sub').textContent = game.pickedUp
    ? `${where} — picked up at ${game.strokes} strokes (par ${course.par})`
    : `${where} — ${game.strokes} strokes, par ${course.par}${timeStr}`;
  $('end-trail').textContent = game.trail.join('');
  $('btn-share').hidden = !daily;
  $('leaderboard').hidden = !daily;
  $('end-next').hidden = !daily;
  $('end-stats').hidden = !daily;
  $('free-actions').hidden = mode !== 'free';
  $('custom-actions').hidden = mode !== 'custom';
  $('btn-back-editor').hidden = !customFromEditor;
  if (daily) {
    renderStats($('end-stats'));
    startCountdown();
    initLeaderboardUI();
  }
  openModal('modal-end');
}

$('btn-next-free').addEventListener('click', () => {
  closeModal('modal-end');
  startRound('free', randomCourse());
});

for (const id of ['btn-back-daily', 'btn-back-daily2']) {
  $(id).addEventListener('click', async () => {
    closeModal('modal-end');
    await loadDaily();
  });
}

$('btn-play-again').addEventListener('click', () => {
  closeModal('modal-end');
  startRound('custom', course, { code: customCode, fromEditor: customFromEditor });
});

$('btn-copy-course').addEventListener('click', async () => {
  const url = `${location.origin}/#c=${customCode}`;
  const btn = $('btn-copy-course');
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = 'Copied!';
  } catch {
    btn.textContent = 'Couldn’t copy';
  }
  setTimeout(() => (btn.textContent = 'Copy course link'), 1600);
});

$('btn-back-editor').addEventListener('click', () => {
  closeModal('modal-end');
  ED.loadIntoEditor(course);
  enterEditor();
});

$('btn-share').addEventListener('click', async () => {
  const diff = game.strokes - course.par;
  const info = resultInfo(diff, game.pickedUp);
  const text = buildShareText({
    number: dailyNumber, par: course.par, strokes: game.strokes, trail: game.trail,
    resultName: info.name, streak: finalStats.streak, pickedUp: game.pickedUp,
    timeMs: game.pickedUp ? null : progress.timeMs,
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

// --- leaderboard ---------------------------------------------------------------

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function renderBoard(container, data) {
  const meLine = data.me
    ? `<p class="lb-me">You’re #${data.me.rank} of ${data.total} today</p>`
    : `<p class="lb-me">${data.total} posted today</p>`;
  const rows = data.top.map((r, i) =>
    `<li><span class="lb-rank">${i + 1}</span><span class="lb-nm">${escapeHtml(r.name)}</span><span class="lb-tr">${escapeHtml(r.trail || '')}</span><span class="lb-time">${r.time_ms != null ? fmtTime(r.time_ms) : ''}</span><b>${r.strokes}</b></li>`,
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
    renderBoard(body, await fetchBoard(dailyNumber, playerId()));
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
      puzzle: dailyNumber, playerId: playerId(), name,
      strokes: game.strokes, trail: game.trail.join(''),
      timeMs: progress.timeMs ?? null,
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
    renderBoard(body, await fetchBoard(dailyNumber, playerId()));
  } catch {
    body.textContent = 'Leaderboard unavailable.';
  }
});

// --- boot ----------------------------------------------------------------------

async function boot() {
  const m = /^#c=([frswtv0-9:]+)$/.exec(location.hash);
  const custom = m && decodeCourse(m[1]);
  if (custom) {
    startRound('custom', custom, { code: m[1] });
    setHint(`A friend sent you this hole — par ${custom.par}. Good luck!`);
    return;
  }
  await loadDaily();
  if (m && !custom) setHint('That course link is broken — playing today’s hole instead.');
  else if (!game.over && firstVisit()) openModal('modal-help');
}

// A tab left open across local midnight would otherwise stay pinned to
// yesterday's puzzle (stale course, save key, and leaderboard). When it regains
// focus on a new day, reload to pick up today's hole.
function checkDateRollover() {
  if (document.visibilityState === 'visible' && puzzleNumber() !== dailyNumber) {
    location.reload();
  }
}
document.addEventListener('visibilitychange', checkDateRollover);
window.addEventListener('focus', checkDateRollover);

boot();
