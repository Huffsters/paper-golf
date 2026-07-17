// SVG renderer: the graph-paper course, the inked shot trace, the ball, the
// aiming targets, the dice face, and the editor paint surface. All positions
// are in cell coordinates; this module owns the pixel math.

import { COLS, ROWS, FAIRWAY, TREE, SAND, WATER, ROUGH } from './course.js?v=9';
import { hashSeed } from './rng.js';

const CELL = 36;
export const W = COLS * CELL;
export const H = ROWS * CELL;
const NS = 'http://www.w3.org/2000/svg';

const px = (c) => (c + 0.5) * CELL; // cell -> center pixel

function el(name, attrs = {}, parent = null) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

// Deterministic per-cell jitter so decorations look hand-placed but never move.
function jit(x, y, salt, amount) {
  return ((hashSeed(x, y, salt) % 1000) / 1000 - 0.5) * amount;
}

// --- course drawing ----------------------------------------------------------

// Colored-pencil washes: translucent so the paper grid shows through.
function drawTiles(svg, grid) {
  const g = el('g', {}, svg);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = grid[y][x];
      if (c === FAIRWAY) {
        // Alternating shades read as mow stripes.
        const shade = (x + y) % 2 === 0 ? 'rgba(140,196,88,0.42)' : 'rgba(140,196,88,0.30)';
        el('rect', { x: x * CELL, y: y * CELL, width: CELL, height: CELL, fill: shade }, g);
      } else if (c === WATER) {
        el('rect', {
          x: x * CELL + 1, y: y * CELL + 1, width: CELL - 2, height: CELL - 2,
          rx: 7, fill: '#a8d6f2',
        }, g);
      } else if (c === SAND) {
        el('rect', {
          x: x * CELL + 1, y: y * CELL + 1, width: CELL - 2, height: CELL - 2,
          rx: 9, fill: '#f2e2af',
        }, g);
      } else { // ROUGH (also under trees)
        el('rect', { x: x * CELL, y: y * CELL, width: CELL, height: CELL, fill: 'rgba(163,178,120,0.20)' }, g);
      }
    }
  }
}

function drawGrid(svg) {
  let d = '';
  for (let x = 1; x < COLS; x++) d += `M${x * CELL} 0V${H}`;
  for (let y = 1; y < ROWS; y++) d += `M0 ${y * CELL}H${W}`;
  el('path', { d, stroke: '#b9cfe0', 'stroke-width': 1, fill: 'none', opacity: 0.55 }, svg);
  el('rect', { x: 0.5, y: 0.5, width: W - 1, height: H - 1, fill: 'none', stroke: '#a6bfd3', 'stroke-width': 1.5, rx: 4 }, svg);
}

// Decorations sit above the grid lines: waves, speckles, tufts, trees.
function drawDecorations(svg, grid) {
  const g = el('g', {}, svg);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = grid[y][x];
      const cx = px(x), cy = px(y);
      if (c === WATER) {
        for (let i = 0; i < 2; i++) {
          const wy = cy - 6 + i * 11 + jit(x, y, 3 + i, 4);
          el('path', {
            d: `M${cx - 9} ${wy} q4.5 -4.5 9 0 t9 0`,
            stroke: '#5f9fce', 'stroke-width': 1.7, fill: 'none', 'stroke-linecap': 'round',
          }, g);
        }
      } else if (c === SAND) {
        for (let i = 0; i < 3; i++) {
          el('circle', {
            cx: cx + jit(x, y, 10 + i, 18), cy: cy + jit(x, y, 20 + i, 18),
            r: 1.6, fill: '#cba75c',
          }, g);
        }
      } else if (c === ROUGH && hashSeed(x, y, 77) % 3 === 0) {
        // sparse grass tufts
        const tx = cx + jit(x, y, 40, 14), ty = cy + jit(x, y, 41, 14);
        el('path', {
          d: `M${tx - 3} ${ty + 3} q1 -5 0 -7 M${tx} ${ty + 3} q0.5 -6 2 -8 M${tx + 3} ${ty + 3} q1 -4 3 -5`,
          stroke: '#93a86c', 'stroke-width': 1.3, fill: 'none', 'stroke-linecap': 'round',
        }, g);
      }
    }
  }
  // Trees last so canopies overlap neighbours naturally.
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (grid[y][x] === TREE) drawTree(g, x, y);
    }
  }
}

function drawTree(g, x, y) {
  const tx = px(x) + jit(x, y, 1, 5);
  const ty = px(y) + jit(x, y, 2, 4);
  const s = 1 + jit(x, y, 4, 0.25);
  el('ellipse', { cx: tx + 2, cy: ty + 13, rx: 10, ry: 3.5, fill: 'rgba(60,60,30,0.13)' }, g);
  const t = el('g', { transform: `translate(${tx} ${ty}) scale(${s}) rotate(${jit(x, y, 5, 10)})` }, g);
  el('rect', { x: -2, y: 8, width: 4, height: 6, rx: 1.5, fill: '#8a6743' }, t);
  el('path', { d: 'M0 -14 L11 4 H-11 Z', fill: '#3a7a49' }, t);
  el('path', { d: 'M0 -6 L13 10 H-13 Z', fill: '#2e6b3d' }, t);
}

function drawTee(svg, tee) {
  const g = el('g', {}, svg);
  el('rect', {
    x: tee.x * CELL + 5, y: tee.y * CELL + 5, width: CELL - 10, height: CELL - 10,
    rx: 5, fill: 'none', stroke: '#b08650', 'stroke-width': 2, 'stroke-dasharray': '5 4',
  }, g);
}

function drawHole(svg, hole) {
  const g = el('g', {}, svg);
  const hx = px(hole.x), hy = px(hole.y);
  el('ellipse', { cx: hx, cy: hy, rx: CELL * 1.05, ry: CELL * 0.85, fill: '#cdeabc' }, g);
  el('ellipse', {
    cx: hx, cy: hy, rx: CELL * 1.05, ry: CELL * 0.85, fill: 'none',
    stroke: '#8fbc74', 'stroke-width': 1.5, 'stroke-dasharray': '4 4',
  }, g);
  el('ellipse', { cx: hx, cy: hy + 3, rx: 8, ry: 4.5, fill: '#c9b98e' }, g);
  el('ellipse', { cx: hx, cy: hy + 2.5, rx: 6, ry: 3.2, fill: '#2d2d2d' }, g);
  el('line', { x1: hx, y1: hy + 2, x2: hx, y2: hy - 24, stroke: '#555', 'stroke-width': 2 }, g);
  el('path', { d: `M${hx} ${hy - 24} L${hx + 14} ${hy - 18.5} L${hx} ${hy - 13} Z`, fill: '#d9534f' }, g);
}

// course.tee / course.hole may be null in the editor.
export function initBoard(svg, course) {
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.replaceChildren();
  el('rect', { x: 0, y: 0, width: W, height: H, fill: '#fdfcf3', rx: 4 }, svg);
  drawTiles(svg, course.grid);
  drawGrid(svg);
  if (course.hole) drawHole(svg, course.hole);
  if (course.tee) drawTee(svg, course.tee);
  drawDecorations(svg, course.grid);
  const layers = {
    svg,
    path: el('g', {}, svg),
    aim: el('g', {}, svg),
    ball: null,
    fx: el('g', {}, svg),
  };
  if (course.tee) {
    layers.ball = el('g', { transform: `translate(${px(course.tee.x)} ${px(course.tee.y)})` }, svg);
    layers.ball.style.transition = 'transform 0.26s ease-out';
    el('circle', { cx: 0, cy: 0, r: 7, fill: '#ffffff', stroke: '#333', 'stroke-width': 2 }, layers.ball);
  }
  svg.appendChild(layers.fx); // fx on top of the ball
  return layers;
}

export function moveBall(layers, x, y, animate = true) {
  layers.ball.style.transition = animate ? 'transform 0.26s ease-out' : 'none';
  layers.ball.setAttribute('transform', `translate(${px(x)} ${px(y)})`);
}

// --- shot trace ----------------------------------------------------------------

// The inked pen stroke: a slightly bowed line so it reads hand-drawn.
function inkLine(parent, from, to, opts = {}) {
  const x1 = px(from.x), y1 = px(from.y), x2 = px(to.x), y2 = px(to.y);
  const mx = (x1 + x2) / 2 + jit(from.x + to.x, from.y + to.y, 7, 5);
  const my = (y1 + y2) / 2 + jit(from.x + to.x, from.y + to.y, 8, 5);
  return el('path', {
    d: `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`,
    stroke: opts.stroke || '#4a4a9c', 'stroke-width': 2.4, fill: 'none',
    'stroke-linecap': 'round', ...(opts.dash ? { 'stroke-dasharray': opts.dash } : {}),
  }, parent);
}

// Draw one shot on the trace. kind: 'rest' | 'splash' | 'holed'
export function drawShot(layers, from, to, strokeNo, kind) {
  inkLine(layers.path, from, to);
  const x = px(to.x), y = px(to.y);
  if (kind === 'splash') {
    const g = el('g', { stroke: '#d9534f', 'stroke-width': 2.4, 'stroke-linecap': 'round' }, layers.path);
    el('line', { x1: x - 5, y1: y - 5, x2: x + 5, y2: y + 5 }, g);
    el('line', { x1: x - 5, y1: y + 5, x2: x + 5, y2: y - 5 }, g);
  } else {
    el('circle', { cx: x, cy: y, r: 3.4, fill: '#4a4a9c' }, layers.path);
    if (kind !== 'holed') {
      el('text', {
        x: x + 7, y: y - 6, 'font-size': 12, fill: '#4a4a9c',
        class: 'ink-num', 'paint-order': 'stroke', stroke: '#fdfcf3', 'stroke-width': 3,
      }, layers.path).textContent = strokeNo;
    }
  }
}

// Transient handwritten exclamation ("splash!", "thunk!").
export function fxLabel(layers, text, cellX, cellY, color = '#d9534f') {
  const t = el('text', {
    x: px(cellX), y: px(cellY) - 14, 'font-size': 19, fill: color,
    'text-anchor': 'middle', class: 'fx-label', 'paint-order': 'stroke',
    stroke: '#fdfcf3', 'stroke-width': 4,
    transform: `rotate(${jit(cellX, cellY, 30, 14)} ${px(cellX)} ${px(cellY)})`,
  }, layers.fx);
  t.textContent = text;
  setTimeout(() => t.remove(), 900);
}

// --- aiming --------------------------------------------------------------------

export function clearAim(layers) {
  layers.aim.replaceChildren();
}

// targets: [{key, dirIdx, putt, x, y}]. `key` identifies the selection (roll
// and putt targets in the same direction are distinct). onPick(dirIdx, putt)
// fires on tap. Putt targets (the always-available 1-square move) render
// smaller and greener so they read as a gentle tap-in option.
export function showAim(layers, from, targets, selectedKey, onPick) {
  clearAim(layers);
  for (const t of targets) {
    const sel = t.key === selectedKey;
    const g = el('g', { class: 'aim-target' + (sel ? ' selected' : '') }, layers.aim);
    if (sel) {
      inkLine(layers.aim, from, t, { stroke: t.putt ? '#3a8a52' : '#e0912f', dash: '2 7' });
      layers.aim.appendChild(g); // keep the target above its preview line
    }
    const base = t.putt ? 6 : 8;
    el('circle', {
      cx: px(t.x), cy: px(t.y), r: sel ? base + 2 : base,
      fill: sel ? (t.putt ? 'rgba(58,138,82,0.85)' : 'rgba(224,145,47,0.85)')
        : (t.putt ? 'rgba(58,138,82,0.16)' : 'rgba(74,74,156,0.14)'),
      stroke: sel ? (t.putt ? '#2e6b3d' : '#b06f1a') : (t.putt ? '#3a8a52' : '#4a4a9c'),
      'stroke-width': 1.8, 'stroke-dasharray': sel ? 'none' : '3 3',
    }, g);
    const hit = el('circle', { cx: px(t.x), cy: px(t.y), r: t.putt ? 13 : 16, fill: 'transparent' }, g);
    hit.style.cursor = 'pointer';
    hit.addEventListener('pointerdown', (e) => { e.preventDefault(); onPick(t.dirIdx, t.putt); });
  }
}

// --- dice ----------------------------------------------------------------------

const PIPS = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

export function drawDie(svg, value) {
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.replaceChildren();
  el('rect', { x: 2, y: 2, width: 36, height: 36, rx: 8, fill: '#fff', stroke: '#33334f', 'stroke-width': 2.5 }, svg);
  for (const [dx, dy] of PIPS[value] || []) {
    el('circle', { cx: 20 + dx * 9, cy: 20 + dy * 9, r: 3.4, fill: '#33334f' }, svg);
  }
}

// --- editor paint surface --------------------------------------------------------

// Calls cb(cellX, cellY) on tap and drag. Returns a dispose function.
export function enablePaint(svg, cb) {
  const toCell = (e) => {
    const r = svg.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * COLS);
    const y = Math.floor((e.clientY - r.top) / r.height * ROWS);
    return x >= 0 && x < COLS && y >= 0 && y < ROWS ? { x, y } : null;
  };
  let painting = false;
  const down = (e) => {
    e.preventDefault();
    painting = true;
    try { svg.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    const c = toCell(e);
    if (c) cb(c.x, c.y);
  };
  const move = (e) => {
    if (!painting) return;
    const c = toCell(e);
    if (c) cb(c.x, c.y);
  };
  const up = () => { painting = false; };
  svg.addEventListener('pointerdown', down);
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);
  svg.classList.add('painting');
  return () => {
    svg.removeEventListener('pointerdown', down);
    svg.removeEventListener('pointermove', move);
    svg.removeEventListener('pointerup', up);
    svg.removeEventListener('pointercancel', up);
    svg.classList.remove('painting');
  };
}
