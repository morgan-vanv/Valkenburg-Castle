// Renders each classic level to SVG (and PNG when sharp is available) in the
// visual language of the 1980 sheet, for checking the transcription by eye.
// Run: npx tsx scripts/preview-map.ts [outDir]

import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { classicCastle } from '../src/data/maps/classic';
import { COLUMN_LETTERS, type LevelMap } from '../src/engine/types';

const outDir = process.argv[2] ?? '/tmp/claude-0/-home-claude/3b2be1b5-7f59-5b84-a231-0097b7d3d398/scratchpad/maps';
const CELL = 60;
const PAD = 60;
const PAPER = '#f6e3b2';
const INK = '#2b2522';
const RED = '#d23a3a';

function renderLevel(lv: LevelMap): string {
  const W = lv.width * CELL + PAD * 2;
  const H = lv.height * CELL + PAD * 2;
  const px = (x: number) => PAD + (x - lv.x0) * CELL;
  const py = (y: number) => PAD + y * CELL;
  const parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  parts.push(`<text x="${PAD}" y="22" font-family="Georgia,serif" font-weight="bold" font-size="22" fill="${RED}">LEVEL ${lv.id}</text>`);

  // Axis labels.
  for (let i = 0; i < lv.width; i++) {
    parts.push(`<text x="${PAD + i * CELL + CELL / 2}" y="${PAD - 12}" text-anchor="middle" font-family="Georgia,serif" font-weight="bold" font-size="20" fill="${RED}">${COLUMN_LETTERS[lv.x0 + i]}</text>`);
  }
  for (let y = 0; y < lv.height; y++) {
    parts.push(`<text x="${PAD - 12}" y="${py(y) + CELL / 2 + 7}" text-anchor="end" font-family="Georgia,serif" font-weight="bold" font-size="20" fill="${RED}">${y + 1}</text>`);
  }

  const feature = new Map<string, string>();
  const mark = (cs: { x: number; y: number }[], t: string) => cs.forEach((c) => feature.set(`${c.x},${c.y}`, t));
  mark(lv.balcony, 'B');
  mark(lv.guardrooms, 'G');
  mark(lv.prisonCells, 'C');
  mark(lv.entrances, 'E');
  mark(lv.hoard, 'H');
  mark(lv.reinforcementPoints, '▼4');
  if (lv.lair) mark([lv.lair], 'D');
  for (const l of classicCastle.links) {
    for (const [a, b] of [[l.a, l.b], [l.b, l.a]] as const) {
      if (a.level !== lv.id) continue;
      const up = b.level < a.level;
      feature.set(`${a.x},${a.y}`, l.kind === 'ladder' ? `X${b.level}` : `${up ? '▲' : '▼'}${b.level}`);
    }
  }

  // Cells.
  for (let y = 0; y < lv.height; y++) {
    for (let x = lv.x0; x < lv.x0 + lv.width; x++) {
      const k = lv.cells[y * lv.width + (x - lv.x0)]!;
      if (k === 'rock') parts.push(`<rect x="${px(x)}" y="${py(y)}" width="${CELL}" height="${CELL}" fill="${INK}"/>`);
      if (k === 'pit') {
        parts.push(`<rect x="${px(x)}" y="${py(y)}" width="${CELL}" height="${CELL}" fill="#e7cf95"/>`);
      }
      const f = feature.get(`${x},${y}`);
      if (f) {
        const col = f === 'B' ? '#9a7b3a' : f.startsWith('X') ? RED : INK;
        parts.push(`<text x="${px(x) + CELL / 2}" y="${py(y) + CELL / 2 + 8}" text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" font-size="${f.length > 1 ? 18 : 24}" fill="${col}">${f}</text>`);
      }
    }
  }
  if (lv.cells.includes('pit')) {
    const pits = lv.cells.map((k, i) => (k === 'pit' ? i : -1)).filter((i) => i >= 0);
    const xs = pits.map((i) => (i % lv.width) + lv.x0);
    const ys = pits.map((i) => Math.floor(i / lv.width));
    const cx = (px(Math.min(...xs)) + px(Math.max(...xs) + 1)) / 2;
    const cy = (py(Math.min(...ys)) + py(Math.max(...ys) + 1)) / 2;
    parts.push(`<text x="${cx}" y="${cy + 10}" text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" font-size="30" fill="${INK}">PIT</text>`);
  }

  // Edges: open first (dotted), then walls, then doors on top.
  const edges: { x1: number; y1: number; x2: number; y2: number; k: string; vertical: boolean }[] = [];
  for (let y = 0; y <= lv.height; y++) {
    for (let x = lv.x0; x < lv.x0 + lv.width; x++) {
      edges.push({ x1: px(x), y1: py(y), x2: px(x + 1), y2: py(y), k: lv.hEdges[y * lv.width + (x - lv.x0)]!, vertical: false });
    }
  }
  for (let y = 0; y < lv.height; y++) {
    for (let x = lv.x0; x <= lv.x0 + lv.width; x++) {
      edges.push({ x1: px(x), y1: py(y), x2: px(x), y2: py(y + 1), k: lv.vEdges[y * (lv.width + 1) + (x - lv.x0)]!, vertical: true });
    }
  }
  const isPit = (x: number, y: number) => x >= lv.x0 && x < lv.x0 + lv.width && y >= 0 && y < lv.height && lv.cells[y * lv.width + (x - lv.x0)] === 'pit';
  const pitInside = (e: (typeof edges)[number]) => {
    const x = lv.x0 + (e.x1 - PAD) / CELL;
    const y = (e.y1 - PAD) / CELL;
    return e.vertical ? isPit(x - 1, y) && isPit(x, y) : isPit(x, y - 1) && isPit(x, y);
  };
  for (const e of edges.filter((e) => e.k === 'open' && !pitInside(e))) {
    parts.push(`<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke="#6b625a" stroke-width="5" stroke-linecap="round" stroke-dasharray="0.1 9"/>`);
  }
  for (const e of edges.filter((e) => e.k !== 'open')) {
    parts.push(`<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke="${INK}" stroke-width="8" stroke-linecap="square"/>`);
  }
  for (const e of edges.filter((e) => e.k === 'door' || e.k === 'locked')) {
    const mx = (e.x1 + e.x2) / 2;
    const my = (e.y1 + e.y2) / 2;
    const s = CELL * 0.5;
    parts.push(`<rect x="${mx - s / 2}" y="${my - s / 2}" width="${s}" height="${s}" fill="none" stroke="${RED}" stroke-width="4"/>`);
    if (e.k === 'locked') {
      parts.push(`<text x="${mx - s / 2 + 8}" y="${my - s / 2 + 18}" text-anchor="middle" font-family="Arial" font-size="20" fill="${INK}">*</text>`);
      parts.push(`<text x="${mx + s / 2 - 8}" y="${my + s / 2 - 2}" text-anchor="middle" font-family="Arial" font-size="20" fill="${INK}">*</text>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n${parts.join('\n')}\n</svg>\n`;
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  let sharp: ((input: Buffer) => { png(): { toFile(p: string): Promise<unknown> } }) | undefined;
  try {
    const require = createRequire(import.meta.url);
    sharp = require('/home/claude/.npm-global/lib/node_modules/sharp');
  } catch {
    sharp = undefined;
  }
  for (const lv of classicCastle.levels) {
    const svg = renderLevel(lv);
    const svgPath = join(outDir, `level-${lv.id}.svg`);
    writeFileSync(svgPath, svg);
    console.log('wrote', svgPath);
    if (sharp) {
      const pngPath = join(outDir, `level-${lv.id}.png`);
      await sharp(Buffer.from(svg)).png().toFile(pngPath);
      console.log('wrote', pngPath);
    }
  }
}

void main();
