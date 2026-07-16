// Course editor: paint tiles on the board, place tee and hole, then hand the
// finished course (as a shareable code) back to the game shell.

import { COLS, ROWS, FAIRWAY, TREE, SAND, WATER, ROUGH, encodeCourse, decodeCourse } from './course.js?v=6';
import * as R from './render.js?v=6';

const BRUSHES = [
  { id: 'fairway', label: 'Fairway', tile: FAIRWAY, chip: '#a4cd6c' },
  { id: 'rough', label: 'Rough', tile: ROUGH, chip: '#d5dcbd' },
  { id: 'sand', label: 'Sand', tile: SAND, chip: '#f2e2af' },
  { id: 'water', label: 'Water', tile: WATER, chip: '#a8d6f2' },
  { id: 'tree', label: 'Trees', tile: TREE, chip: '#2e6b3d' },
  { id: 'tee', label: 'Tee', chip: '#b08650' },
  { id: 'hole', label: 'Hole', chip: '#d9534f' },
];

let grid = null;
let tee = null;
let hole = null;
let brush = 'fairway';
let dispose = null;
let svgEl = null;
let hintFn = () => {};

function blankGrid() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(ROUGH));
}

function redraw() {
  R.initBoard(svgEl, { grid, tee, hole });
}

function paint(x, y) {
  const b = BRUSHES.find((br) => br.id === brush);
  if (brush === 'tee') {
    if (hole && hole.x === x && hole.y === y) hole = null;
    tee = { x, y };
    if (grid[y][x] === TREE || grid[y][x] === WATER) grid[y][x] = FAIRWAY;
  } else if (brush === 'hole') {
    if (tee && tee.x === x && tee.y === y) tee = null;
    hole = { x, y };
    if (grid[y][x] === TREE || grid[y][x] === WATER) grid[y][x] = FAIRWAY;
  } else {
    if (grid[y][x] === b.tile) return; // no change: skip the redraw during drags
    grid[y][x] = b.tile;
    // Painting a hazard under a marker sweeps the marker away.
    if ((b.tile === TREE || b.tile === WATER)) {
      if (tee && tee.x === x && tee.y === y) tee = null;
      if (hole && hole.x === x && hole.y === y) hole = null;
    }
  }
  redraw();
  updateHint();
}

function updateHint() {
  if (!tee && !hole) hintFn('Paint the course, then place a tee and a hole.');
  else if (!tee) hintFn('Place the tee (start).');
  else if (!hole) hintFn('Place the hole (flag).');
  else hintFn('Looking good — Test it, or Share the link.');
}

function buildBrushBar() {
  const bar = document.getElementById('brushes');
  bar.replaceChildren();
  for (const b of BRUSHES) {
    const btn = document.createElement('button');
    btn.className = 'brush' + (b.id === brush ? ' selected' : '');
    btn.innerHTML = `<span class="brush-chip" style="background:${b.chip}"></span>${b.label}`;
    btn.addEventListener('click', () => { brush = b.id; buildBrushBar(); });
    bar.appendChild(btn);
  }
}

export function openEditor(svg, setHint) {
  svgEl = svg;
  hintFn = setHint;
  if (!grid) { grid = blankGrid(); }
  buildBrushBar();
  redraw();
  dispose = R.enablePaint(svg, paint);
  updateHint();
}

export function closeEditor() {
  dispose?.();
  dispose = null;
}

export function clearEditor() {
  grid = blankGrid();
  tee = null;
  hole = null;
  redraw();
  updateHint();
}

// Validate and build the current course. Returns {code, course} or {error}.
export function currentCourse() {
  if (!tee) return { error: 'Place a tee first (the start square).' };
  if (!hole) return { error: 'Place a hole first (the flag).' };
  const code = encodeCourse(grid, tee, hole);
  const course = decodeCourse(code);
  if (!course) return { error: 'No way to finish this hole — open a path to the flag.' };
  return { code, course };
}

// Load an existing course into the editor (edit a copy of a shared course).
export function loadIntoEditor(course) {
  grid = course.grid.map((row) => row.slice());
  tee = { ...course.tee };
  hole = { ...course.hole };
}
