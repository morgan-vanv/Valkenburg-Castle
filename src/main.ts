// Placeholder title screen: a procedurally divided dungeon floor lit by a
// lantern that follows the pointer. Proves the TypeScript → Vite → Pages
// pipeline works; the real game replaces this.

import { mulberry32 } from './rng';

const CELL = 40; // one 10' square
const canvas = document.querySelector<HTMLCanvasElement>('#dungeon')!;
const ctx = canvas.getContext('2d')!;

interface Wall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

let cols = 0;
let rows = 0;
let walls: Wall[] = [];
const lantern = { x: innerWidth / 2, y: innerHeight / 2 };
const target = { ...lantern };

// Recursive division: split a rectangle with a wall, leave a one-square door.
function divide(x: number, y: number, w: number, h: number, rand: () => number, out: Wall[]): void {
  if (w < 6 && h < 6) return;
  const horizontal = h > w || (h === w && rand() < 0.5);
  if (horizontal && h >= 6) {
    const wy = y + 3 + Math.floor(rand() * (h - 5));
    const door = x + Math.floor(rand() * w);
    if (door > x) out.push({ x1: x, y1: wy, x2: door, y2: wy });
    if (door + 1 < x + w) out.push({ x1: door + 1, y1: wy, x2: x + w, y2: wy });
    divide(x, y, w, wy - y, rand, out);
    divide(x, wy, w, y + h - wy, rand, out);
  } else if (w >= 6) {
    const wx = x + 3 + Math.floor(rand() * (w - 5));
    const door = y + Math.floor(rand() * h);
    if (door > y) out.push({ x1: wx, y1: y, x2: wx, y2: door });
    if (door + 1 < y + h) out.push({ x1: wx, y1: door + 1, x2: wx, y2: y + h });
    divide(x, y, wx - x, h, rand, out);
    divide(wx, y, x + w - wx, h, rand, out);
  }
}

function build(): void {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  cols = Math.ceil(innerWidth / CELL) + 1;
  rows = Math.ceil(innerHeight / CELL) + 1;
  walls = [
    { x1: 0, y1: 0, x2: cols, y2: 0 },
    { x1: 0, y1: rows, x2: cols, y2: rows },
    { x1: 0, y1: 0, x2: 0, y2: rows },
    { x1: cols, y1: 0, x2: cols, y2: rows },
  ];
  divide(0, 0, cols, rows, mulberry32(1980), walls);
}

function draw(time: number): void {
  lantern.x += (target.x - lantern.x) * 0.12;
  lantern.y += (target.y - lantern.y) * 0.12;
  const flicker = 1 + Math.sin(time / 90) * 0.03 + Math.sin(time / 37) * 0.02;
  const radius = Math.max(innerWidth, innerHeight) * 0.32 * flicker;

  ctx.fillStyle = '#14110f';
  ctx.fillRect(0, 0, innerWidth, innerHeight);

  // Dotted square boundaries, like the original map.
  ctx.fillStyle = 'rgba(239, 228, 207, 0.22)';
  for (let gx = 0; gx <= cols; gx++) {
    for (let gy = 0; gy <= rows; gy++) {
      for (let d = 1; d < 4; d++) {
        ctx.fillRect(gx * CELL + (d * CELL) / 4 - 1, gy * CELL - 1, 2, 2);
        ctx.fillRect(gx * CELL - 1, gy * CELL + (d * CELL) / 4 - 1, 2, 2);
      }
    }
  }

  ctx.strokeStyle = '#efe4cf';
  ctx.lineWidth = 6;
  ctx.lineCap = 'square';
  ctx.beginPath();
  for (const w of walls) {
    ctx.moveTo(w.x1 * CELL, w.y1 * CELL);
    ctx.lineTo(w.x2 * CELL, w.y2 * CELL);
  }
  ctx.stroke();

  // Darkness everywhere except the lantern's pool of light.
  const light = ctx.createRadialGradient(lantern.x, lantern.y, 0, lantern.x, lantern.y, radius);
  light.addColorStop(0, 'rgba(20, 17, 15, 0)');
  light.addColorStop(0.55, 'rgba(20, 17, 15, 0.55)');
  light.addColorStop(1, 'rgba(20, 17, 15, 0.97)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, innerWidth, innerHeight);

  const glow = ctx.createRadialGradient(lantern.x, lantern.y, 0, lantern.x, lantern.y, radius * 0.6);
  glow.addColorStop(0, 'rgba(232, 163, 61, 0.18)');
  glow.addColorStop(1, 'rgba(232, 163, 61, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, innerWidth, innerHeight);

  requestAnimationFrame(draw);
}

addEventListener('pointermove', (e) => {
  target.x = e.clientX;
  target.y = e.clientY;
});
addEventListener('resize', build);

build();
requestAnimationFrame(draw);
