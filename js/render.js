// SVG renderer: the graph-paper course, the inked shot trace, the ball, and
// the aiming targets. All positions are in cell coordinates; this module owns
// the pixel math.

import { COLS, ROWS, FAIRWAY, TREE, SAND, WATER } from './course.js';
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

// Deterministic per-cell jitter so hazards look hand-placed but never move.
function jit(x, y, salt, amount) {
  return ((hashSeed(x, y, salt) % 1000) / 1000 - 0.5) * amount;
}

function drawPaper(svg) {
  el('rect', { x: 0, y: 0, width: W, height: H, fill: '#fdfcf3', rx: 4 }, svg);
  let d = '';
  for (let x = 1; x < COLS; x++) d += `M${x * CELL} 0V${H}`;
  for (let y = 1; y < ROWS; y++) d += `M0 ${y * CELL}H${W}`;
  el('path', { d, stroke: '#d4e4f0', 'stroke-width': 1, fill: 'none' }, svg);
  el('rect', { x: 0.5, y: 0.5, width: W - 1, height: H - 1, fill: 'none', stroke: '#b9cfe0', 'stroke-width': 1.5, rx: 4 }, svg);
}

function drawWater(g, x, y) {
  el('rect', {
    x: x * CELL + 1.5, y: y * CELL + 1.5, width: CELL - 3, height: CELL - 3,
    rx: 8, fill: '#b9def4',
  }, g);
  const wx = px(x), wy = px(y) + jit(x, y, 3, 4);
  el('path', {
    d: `M${wx - 9} ${wy} q4.5 -5 9 0 t9 0`,
    stroke: '#5f9fce', 'stroke-width': 1.8, fill: 'none', 'stroke-linecap': 'round',
  }, g);
}

function drawSand(g, x, y) {
  el('rect', {
    x: x * CELL + 1.5, y: y * CELL + 1.5, width: CELL - 3, height: CELL - 3,
    rx: 9, fill: '#f2e2af',
  }, g);
  for (let i = 0; i < 3; i++) {
    el('circle', {
      cx: px(x) + jit(x, y, 10 + i, 16), cy: px(y) + jit(x, y, 20 + i, 16),
      r: 1.6, fill: '#cba75c',
    }, g);
  }
}

function drawTree(g, x, y) {
  const tx = px(x) + jit(x, y, 1, 5);
  const ty = px(y) + jit(x, y, 2, 4);
  const s = 1 + jit(x, y, 4, 0.25); // size wobble
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
  // the "green"
  el('ellipse', { cx: hx, cy: hy, rx: CELL * 1.15, ry: CELL * 0.95, fill: '#d3ecc9', opacity: 0.9 }, g);
  el('ellipse', { cx: hx, cy: hy + 3, rx: 8, ry: 4.5, fill: '#c9b98e' }, g);
  el('ellipse', { cx: hx, cy: hy + 2.5, rx: 6, ry: 3.2, fill: '#2d2d2d' }, g);
  el('line', { x1: hx, y1: hy + 2, x2: hx, y2: hy - 24, stroke: '#555', 'stroke-width': 2 }, g);
  el('path', { d: `M${hx} ${hy - 24} L${hx + 14} ${hy - 18.5} L${hx} ${hy - 13} Z`, fill: '#d9534f' }, g);
}

export function initBoard(svg, course) {
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.replaceChildren();
  drawPaper(svg);
  const hazards = el('g', {}, svg);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = course.grid[y][x];
      if (c === WATER) drawWater(hazards, x, y);
      else if (c === SAND) drawSand(hazards, x, y);
    }
  }
  drawHole(svg, course.hole);
  drawTee(svg, course.tee);
  // Trees after the hole so canopies overlap the green naturally.
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (course.grid[y][x] === TREE) drawTree(hazards, x, y);
    }
  }
  const layers = {
    svg,
    path: el('g', {}, svg),
    aim: el('g', {}, svg),
    ball: null,
    fx: el('g', {}, svg),
  };
  layers.ball = el('g', { transform: `translate(${px(course.tee.x)} ${px(course.tee.y)})` }, svg);
  layers.ball.style.transition = 'transform 0.26s ease-out';
  el('circle', { cx: 0, cy: 0, r: 7, fill: '#ffffff', stroke: '#333', 'stroke-width': 2 }, layers.ball);
  svg.appendChild(layers.fx); // fx on top of the ball
  return layers;
}

export function moveBall(layers, x, y, animate = true) {
  layers.ball.style.transition = animate ? 'transform 0.26s ease-out' : 'none';
  layers.ball.setAttribute('transform', `translate(${px(x)} ${px(y)})`);
}

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

// Aiming layer -------------------------------------------------------------

export function clearAim(layers) {
  layers.aim.replaceChildren();
}

// targets: [{dirIdx, x, y}]. onPick(dirIdx) is called on tap.
export function showAim(layers, from, targets, selectedDir, onPick) {
  clearAim(layers);
  for (const t of targets) {
    const sel = t.dirIdx === selectedDir;
    const g = el('g', { class: 'aim-target' + (sel ? ' selected' : '') }, layers.aim);
    if (sel) {
      inkLine(layers.aim, from, t, { stroke: '#e0912f', dash: '2 7' });
      layers.aim.appendChild(g); // keep the target above its preview line
    }
    el('circle', {
      cx: px(t.x), cy: px(t.y), r: sel ? 10 : 8,
      fill: sel ? 'rgba(224,145,47,0.85)' : 'rgba(74,74,156,0.14)',
      stroke: sel ? '#b06f1a' : '#4a4a9c', 'stroke-width': 1.8,
      'stroke-dasharray': sel ? 'none' : '3 3',
    }, g);
    // generous invisible touch area
    const hit = el('circle', { cx: px(t.x), cy: px(t.y), r: 16, fill: 'transparent' }, g);
    hit.style.cursor = 'pointer';
    hit.addEventListener('pointerdown', (e) => { e.preventDefault(); onPick(t.dirIdx); });
  }
}
