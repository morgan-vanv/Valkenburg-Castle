// Writes a flat preview of the V3.1 castle, one SVG per level (same framing
// as mockup/sketch.py so it can be laid next to mockup/shots/levelN.png):
// room tints, walls, pits, props, railings, lights, links, spawns, loot,
// traps and contract sites.
// Run: npx tsx scripts/v3-map-preview.ts [outDir]   (default docs/castle-preview)
// PNG: node scripts/v3-map-svg2png.mjs <in.svg> <out.png>

import { mkdirSync, writeFileSync } from 'node:fs';
import { castle } from '../src/data/castle/index';
import { axialToOffset, parseHexKey, type Hex, type Pos } from '../src/game/hex';
import type { LevelDef, PropKind } from '../src/game/types';

const outDir = process.argv[2] ?? 'docs/castle-preview';
const SIZE = 9; // as sketch.py
const SQ3 = Math.sqrt(3);
const COLS = 46;
const ROWS = 32;
const OX = 20;
const OY = 50;
const W = Math.floor(SIZE * SQ3 * (COLS + 1)) + 200;
const H = Math.floor(SIZE * 1.5 * (ROWS + 1)) + 70;

const WALL = '#e4dccb';
const WALL_EDGE = '#8a8170';
const PIT = '#120c0c';
const BG = '#1b1714';

function xy(h: Hex): { x: number; y: number } {
  const { col, row } = axialToOffset(h);
  return { x: OX + SIZE * SQ3 * (col + 0.5 * (row & 1)), y: OY + SIZE * 1.5 * row };
}

function poly(x: number, y: number, s: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(x + s * Math.cos(a)).toFixed(1)},${(y + s * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const PROP_GLYPH: Record<PropKind, string> = {
  table: 'T', bench: 'b', bunk: 'k', barrel: 'o', crate: 'x', anvil: 'a', cage: '#', bones: '%', rock: 'r',
  shelf: 'S', forge: 'F', winch: 'W', statue: '†', rack: '/', stalagmite: '^',
};
const LIGHT_COL = { sconce: '#ffb050', daylight: '#fff2b0', fire: '#ff5a1a', fungus: '#8af08a', glow: '#ff8a5a' };
const MON: Record<string, string> = { rats: 'r', orc: 'O', spider: 'S', cutpurse: 'C', berserker: 'B', dragon: 'D' };

function renderLevel(lv: LevelDef): string {
  const p: string[] = [];
  const on = (x: Pos) => x.level === lv.level;
  const tint = new Map(lv.rooms.map((r) => [r.id, r.tint ?? '#a89a84']));
  // Light reach, drawn as a soft wash under the marks.
  const glow: string[] = [];
  for (const L of castle.lights.filter(on)) {
    const { x, y } = xy(L);
    glow.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(SIZE * SQ3 * (L.radius + 0.5)).toFixed(1)}" fill="${LIGHT_COL[L.kind]}" opacity="0.10"/>`);
  }
  for (const [k, t] of Object.entries(lv.tiles)) {
    const { x, y } = xy(parseHexKey(k));
    switch (t.kind) {
      case 'pit':
        p.push(`<polygon points="${poly(x, y, SIZE)}" fill="${PIT}"/>`);
        break;
      case 'wall':
        p.push(`<polygon points="${poly(x, y, SIZE)}" fill="${WALL}" stroke="${WALL_EDGE}" stroke-width="0.6"/>`);
        break;
      case 'cracked':
        p.push(`<polygon points="${poly(x, y, SIZE)}" fill="${WALL}" stroke="${WALL_EDGE}" stroke-width="0.6"/><text x="${x}" y="${y + 3}" font-size="9" text-anchor="middle" fill="#3a2a1a">✖</text>`);
        break;
      case 'pillar':
        p.push(`<polygon points="${poly(x, y, SIZE * 0.96)}" fill="${tint.get(t.room ?? '') ?? '#a89a84'}"/><circle cx="${x}" cy="${y}" r="${SIZE * 0.6}" fill="${WALL}" stroke="${WALL_EDGE}"/>`);
        break;
      case 'brazier':
        p.push(`<polygon points="${poly(x, y, SIZE * 0.96)}" fill="#5a4a3a"/><circle cx="${x}" cy="${y}" r="${SIZE * 0.6}" fill="#ff9a30" stroke="#1a1208"/>`);
        break;
      default: {
        const fill = tint.get(t.room ?? '') ?? '#ff00ff';
        p.push(`<polygon points="${poly(x, y, SIZE * 0.96)}" fill="${fill}" stroke="#00000030" stroke-width="0.5"/>`);
        if (t.kind === 'door' || t.kind === 'sealed') {
          const col = t.kind === 'sealed' ? '#7a5ac8' : t.locked ? '#c8961e' : '#6b4a2a';
          p.push(`<polygon points="${poly(x, y, SIZE * 0.8)}" fill="${col}" stroke="#1a1208" stroke-width="1"/>`);
          if (t.kind !== 'door' || t.locked) p.push(`<text x="${x}" y="${y + 3}" font-size="8" text-anchor="middle" fill="#1a1208" font-weight="bold">${t.locked ? 'L' : '✦'}</text>`);
        }
        if (t.kind === 'prop' || t.kind === 'tallprop') {
          const tall = t.kind === 'tallprop';
          p.push(`<polygon points="${poly(x, y, SIZE * 0.7)}" fill="${tall ? '#3a2e24' : '#6a5440'}" stroke="#1a1208" stroke-width="0.8"/><text x="${x}" y="${y + 3}" font-size="8" text-anchor="middle" fill="#f4ead8" font-weight="bold">${esc(PROP_GLYPH[t.prop!] ?? '?')}</text>`);
        }
        if (t.kind === 'stairs' || t.kind === 'lift' || t.kind === 'exit') {
          const [col, ch] = t.kind === 'stairs' ? ['#5aa0d8', 'S'] : t.kind === 'lift' ? ['#d8b040', 'L'] : ['#5cc05c', 'E'];
          p.push(`<circle cx="${x}" cy="${y}" r="${SIZE * 0.8}" fill="${col}" stroke="#1a1208"/><text x="${x}" y="${y + 3.2}" font-size="9" text-anchor="middle" fill="#1a1208" font-weight="bold">${ch}</text>`);
        }
        if (t.railing) p.push(`<polygon points="${poly(x, y, SIZE * 0.92)}" fill="none" stroke="#f0d070" stroke-width="2"/>`);
      }
    }
  }
  const mark = (at: Pos, svg: (x: number, y: number) => string) => {
    if (!on(at)) return;
    const { x, y } = xy(at);
    p.push(svg(x, y));
  };
  for (const L of castle.lights) {
    mark(L.at, (x, y) => `<circle cx="${x}" cy="${y}" r="${L.kind === 'fire' && L.radius === 1 ? 4 : 3}" fill="${LIGHT_COL[L.kind]}" stroke="#1a1208" stroke-width="0.8"/>`);
  }
  for (const t of castle.traps) mark(t.at, (x, y) => `<path d="M${x - 5},${y - 5} L${x + 5},${y + 5} M${x + 5},${y - 5} L${x - 5},${y + 5}" stroke="#c03ac0" stroke-width="2.2"/>`);
  for (const c of castle.coins) mark(c.at, (x, y) => `<circle cx="${x}" cy="${y}" r="4.5" fill="#f2d24b" stroke="#8a6a10"/><text x="${x}" y="${y + 2.5}" text-anchor="middle" font-size="6" fill="#5a4400">$</text>`);
  for (const c of castle.chests) {
    mark(c.at, (x, y) => `<rect x="${x - 7}" y="${y - 5}" width="14" height="10" rx="2" fill="${c.locked ? '#5a2a14' : '#9a6a2e'}" stroke="#f2d24b" stroke-width="1.3"/><text x="${x}" y="${y + 3}" text-anchor="middle" font-size="8" font-weight="bold" fill="#fff">${c.tier}</text>`);
  }
  for (const s of castle.contractSites) {
    if (s.kind === 'slay') continue;
    const col = s.kind === 'rescue' ? '#2e7fd1' : '#1f9e8a';
    mark(s.at, (x, y) => `<polygon points="${x},${y - 8} ${x + 8},${y} ${x},${y + 8} ${x - 8},${y}" fill="${col}" stroke="#fff" stroke-width="1.2"/><text x="${x}" y="${y + 3}" text-anchor="middle" font-size="8" font-weight="bold" fill="#fff">${s.kind === 'rescue' ? 'P' : 'H'}</text>`);
  }
  for (const m of castle.spawns) {
    const awake = m.asleep === false;
    const r = m.kind === 'dragon' ? 10 : 7;
    mark(m.at, (x, y) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${m.name || m.kind === 'dragon' ? '#7a0f0f' : '#c0392b'}" stroke="${awake ? '#ffee00' : '#fff'}" stroke-width="${awake ? 2 : 1}"/><text x="${x}" y="${y + 3}" text-anchor="middle" font-size="9" font-weight="bold" fill="#fff">${MON[m.kind]}</text>`);
  }
  for (const e of castle.rivalEntrances) mark(e, (x, y) => `<circle cx="${x}" cy="${y}" r="${SIZE + 3}" fill="none" stroke="#b37cff" stroke-width="2" stroke-dasharray="3 2"/>`);
  for (const r of lv.rooms) {
    const { x, y } = xy(r.labelAt);
    p.push(`<text x="${x}" y="${y + 4}" font-size="12" text-anchor="middle" fill="#fff8ec" stroke="#1b1714" stroke-width="3" paint-order="stroke" font-family="Georgia, serif" font-weight="bold">${esc(r.name)}</text>`);
  }
  return glow.join('') + p.join('');
}

function legend(): string {
  const rows: [string, string][] = [
    [`<circle r="7" fill="#c0392b" stroke="#fff"/>`, 'Monster (dark = named; yellow ring = awake)'],
    [`<rect x="-7" y="-5" width="14" height="10" rx="2" fill="#9a6a2e" stroke="#f2d24b"/>`, 'Chest (tier; dark = locked)'],
    [`<circle r="4.5" fill="#f2d24b"/>`, 'Coins'],
    [`<path d="M-5,-5 L5,5 M5,-5 L-5,5" stroke="#c03ac0" stroke-width="2.2"/>`, 'Trap'],
    [`<polygon points="0,-8 8,0 0,8 -8,0" fill="#2e7fd1"/>`, 'Rescue site'],
    [`<polygon points="0,-8 8,0 0,8 -8,0" fill="#1f9e8a"/>`, 'Recover site'],
    [`<polygon points="${poly(0, 0, 7)}" fill="#3a2e24"/>`, 'Tall prop (blocks sight)'],
    [`<polygon points="${poly(0, 0, 7)}" fill="#6a5440"/>`, 'Prop (cover)'],
    [`<polygon points="${poly(0, 0, 7)}" fill="none" stroke="#f0d070" stroke-width="2"/>`, 'Railing'],
    [`<circle r="3" fill="#ffb050"/>`, 'Sconce'],
    [`<circle r="3" fill="#fff2b0"/>`, 'Daylight'],
    [`<circle r="4" fill="#ff5a1a"/>`, 'Fire / vent'],
    [`<circle r="3" fill="#8af08a"/>`, 'Fungus'],
    [`<circle r="10" fill="none" stroke="#b37cff" stroke-dasharray="3 2"/>`, 'Rival entrance'],
  ];
  const x = W - 180;
  return rows
    .map(([g, label], i) => `<g transform="translate(${x},${70 + i * 22})">${g}</g><text x="${x + 14}" y="${74 + i * 22}" font-size="11" fill="#e8dcc8" font-family="Helvetica, sans-serif">${esc(label)}</text>`)
    .join('');
}

mkdirSync(outDir, { recursive: true });
for (const lv of castle.levels) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${BG}"/><text x="20" y="32" font-size="20" fill="#f4ead8" font-family="Georgia, serif" font-weight="bold">Level ${lv.level} · ${esc(lv.name)}</text>${renderLevel(lv)}${legend()}</svg>`;
  const f = `${outDir}/level${lv.level}.svg`;
  writeFileSync(f, svg);
  console.log(`wrote ${f} (${W}x${H})`);
}
