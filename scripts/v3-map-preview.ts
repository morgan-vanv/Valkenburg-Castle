// Writes docs/castle-preview.svg: both V3 castle levels side by side, hexes
// colored by kind, room names, and markers for spawns, chests, coins, traps,
// contract sites, exits, stairs and the pit link.
// Run: npx tsx scripts/v3-map-preview.ts [out.svg]

import { writeFileSync } from 'node:fs';
import { castle } from '../src/data/castle/index';
import { hexToWorld, parseHexKey, posKey, type Hex, type Pos } from '../src/game/hex';
import type { LevelDef, TileDef } from '../src/game/types';

const out = process.argv[2] ?? 'docs/castle-preview.svg';
const S = 15; // hex size, center to corner
const PAD = 40;
const TOP = 70;
const LEVEL_W = Math.sqrt(3) * S * 34.5 + PAD;

const FILL: Record<TileDef['kind'], string> = {
  floor: '#d9cbb0',
  wall: '#3b3632',
  cracked: '#7a5b45',
  pillar: '#56504a',
  rubble: '#b5a68a',
  door: '#a8662f',
  pit: '#0d0b0a',
  stairs: '#6aa0c8',
  exit: '#5fb36a',
  brazier: '#e0782a',
};

// Soft tint per room so rooms read as areas.
const TINTS = ['#e8d9b8', '#d6c8a6', '#e3d0c0', '#cfd3b5', '#d9c3a8', '#c9c9b6', '#e6cfa4', '#d3bfae', '#cfc6a0', '#e0d6c2', '#c8bfa8', '#dccab0'];

function corners(cx: number, cy: number, s: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(cx + s * Math.cos(a)).toFixed(1)},${(cy + s * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function renderLevel(lv: LevelDef, ox: number): string {
  const xy = (h: Hex) => {
    const w = hexToWorld(h, S);
    return { x: ox + PAD + w.x + S, y: TOP + w.z + S };
  };
  const parts: string[] = [];
  const tint = new Map(lv.rooms.map((r, i) => [r.id, TINTS[i % TINTS.length]!]));
  parts.push(`<text x="${ox + PAD}" y="40" font-family="Georgia,serif" font-size="22" font-weight="bold" fill="#f0e2c4">Level ${lv.level}: ${esc(lv.name)}</text>`);

  for (const [k, t] of Object.entries(lv.tiles)) {
    const { x, y } = xy(parseHexKey(k));
    let fill = FILL[t.kind];
    if (t.kind === 'floor' && t.room) fill = tint.get(t.room) ?? fill;
    if (t.raised) fill = '#f3e9cf';
    const stroke = t.kind === 'wall' ? '#2a2623' : '#8f826c';
    parts.push(`<polygon points="${corners(x, y, S)}" fill="${fill}" stroke="${stroke}" stroke-width="0.6"/>`);
    if (t.raised) parts.push(`<polygon points="${corners(x, y, S * 0.6)}" fill="none" stroke="#a89670" stroke-width="1"/>`);
    if (t.kind === 'pillar') parts.push(`<circle cx="${x}" cy="${y}" r="${S * 0.55}" fill="#8a8178" stroke="#2a2623"/>`);
    if (t.kind === 'door') {
      parts.push(`<rect x="${x - 5}" y="${y - 7}" width="10" height="14" fill="${t.locked ? '#5a2a14' : '#c98a4a'}" stroke="#2a1608"/>`);
      if (t.locked) parts.push(`<circle cx="${x}" cy="${y}" r="2.5" fill="#f2d24b"/>`);
    }
    if (t.kind === 'cracked') parts.push(`<path d="M${x - 6},${y - 7} L${x},${y} L${x - 3},${y + 2} L${x + 5},${y + 8}" stroke="#f0e2c4" stroke-width="1.5" fill="none"/>`);
    if (t.kind === 'rubble') parts.push(`<circle cx="${x - 4}" cy="${y + 2}" r="3" fill="#7d705a"/><circle cx="${x + 3}" cy="${y - 2}" r="2.5" fill="#7d705a"/><circle cx="${x + 3}" cy="${y + 5}" r="2" fill="#7d705a"/>`);
    if (t.kind === 'stairs') parts.push(`<path d="M${x - 7},${y + 5} h4 v-4 h4 v-4 h4 v-4" stroke="#fff" stroke-width="1.6" fill="none"/>`);
    if (t.kind === 'exit') parts.push(`<text x="${x}" y="${y + 4}" text-anchor="middle" font-family="sans-serif" font-size="11" font-weight="bold" fill="#fff">E</text>`);
    if (t.kind === 'brazier') parts.push(`<circle cx="${x}" cy="${y}" r="6" fill="#ffd25e" stroke="#7a2e0a" stroke-width="1.5"/>`);
  }

  const on = (p: Pos) => p.level === lv.level;
  const mark = (p: Pos, svg: (x: number, y: number) => string) => {
    if (!on(p)) return;
    const { x, y } = xy(p);
    parts.push(svg(x, y));
  };

  // Pit link: edges (upper) and landings (lower).
  for (const link of castle.links) {
    if (link.kind === 'pit') {
      for (const e of link.edge) mark(e, (x, y) => `<circle cx="${x}" cy="${y}" r="2" fill="#333"/>`);
      for (const l of link.landing) mark(l, (x, y) => `<polygon points="${corners(x, y, S * 0.8)}" fill="none" stroke="#000" stroke-dasharray="3 2" stroke-width="1.4"/>`);
    }
  }
  for (const t of castle.traps) mark(t.at, (x, y) => `<path d="M${x - 6},${y - 6} L${x + 6},${y + 6} M${x + 6},${y - 6} L${x - 6},${y + 6}" stroke="#8b1d8b" stroke-width="2.4"/>`);
  for (const c of castle.coins) mark(c.at, (x, y) => `<circle cx="${x}" cy="${y}" r="5" fill="#f2d24b" stroke="#8a6a10"/><text x="${x}" y="${y + 3}" text-anchor="middle" font-size="7" font-family="sans-serif" fill="#5a4400">$</text>`);
  for (const c of castle.chests) {
    mark(c.at, (x, y) => `<rect x="${x - 8}" y="${y - 6}" width="16" height="12" rx="2" fill="${c.locked ? '#5a2a14' : '#9a6a2e'}" stroke="#f2d24b" stroke-width="1.5"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="10" font-weight="bold" font-family="sans-serif" fill="#fff">${c.tier}</text>`);
  }
  for (const s of castle.contractSites) {
    const col = s.kind === 'rescue' ? '#2e7fd1' : '#1f9e8a';
    mark(s.at, (x, y) => `<polygon points="${x},${y - 9} ${x + 9},${y} ${x},${y + 9} ${x - 9},${y}" fill="${col}" stroke="#fff" stroke-width="1.5"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="10" font-weight="bold" font-family="sans-serif" fill="#fff">${s.kind === 'rescue' ? 'P' : 'H'}</text>`);
  }
  const LETTER: Record<string, string> = { rats: 'r', orc: 'O', spider: 'S', cutpurse: 'C', berserker: 'B' };
  for (const m of castle.spawns) {
    mark(m.at, (x, y) => `<circle cx="${x}" cy="${y}" r="8" fill="${m.name ? '#7a0f0f' : '#c0392b'}" stroke="#fff" stroke-width="1.2"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="10" font-weight="bold" font-family="sans-serif" fill="#fff">${LETTER[m.kind]}</text>`);
  }
  const entrances = new Set(castle.entrances.map(posKey));
  const rivals = new Set(castle.rivalEntrances.map(posKey));
  for (const e of [...castle.entrances, ...castle.rivalEntrances]) {
    mark(e, (x, y) => `<circle cx="${x}" cy="${y}" r="${S - 2}" fill="none" stroke="${rivals.has(posKey(e)) && !entrances.has(posKey(e)) ? '#b37cff' : '#ffffff'}" stroke-width="2.5"/>`);
  }

  // Room labels last, on top.
  for (const r of lv.rooms) {
    const { x, y } = xy(r.labelAt);
    parts.push(`<text x="${x}" y="${y + 4}" text-anchor="middle" font-family="Georgia,serif" font-size="13" font-weight="bold" fill="#1a1410" stroke="#f6ecd6" stroke-width="3.5" paint-order="stroke">${esc(r.name)}</text>`);
  }
  return parts.join('\n');
}

function legend(y: number): string {
  const items: [string, string][] = [
    ['<circle cx="0" cy="0" r="8" fill="#c0392b" stroke="#fff"/>', 'Monster (r rats, O orc, S spider, C cutpurse, B berserker; dark = named)'],
    ['<rect x="-8" y="-6" width="16" height="12" rx="2" fill="#9a6a2e" stroke="#f2d24b"/>', 'Chest (tier; dark = locked)'],
    ['<circle cx="0" cy="0" r="5" fill="#f2d24b"/>', 'Coins'],
    ['<path d="M-6,-6 L6,6 M6,-6 L-6,6" stroke="#8b1d8b" stroke-width="2.4"/>', 'Trap'],
    ['<polygon points="0,-9 9,0 0,9 -9,0" fill="#2e7fd1"/>', 'Rescue site (P)'],
    ['<polygon points="0,-9 9,0 0,9 -9,0" fill="#1f9e8a"/>', 'Recover site (H)'],
    ['<circle cx="0" cy="0" r="12" fill="none" stroke="#fff" stroke-width="2.5"/>', 'Entrance'],
    ['<circle cx="0" cy="0" r="12" fill="none" stroke="#b37cff" stroke-width="2.5"/>', 'Rival-only entrance'],
    ['<polygon points="-12,0 -6,-10 6,-10 12,0 6,10 -6,10" fill="none" stroke="#fff" stroke-dasharray="3 2"/>', 'Pit landing'],
  ];
  return items
    .map(([svg, label], i) => {
      const x = PAD + (i % 3) * 600;
      const yy = y + Math.floor(i / 3) * 28;
      return `<g transform="translate(${x + 10},${yy})">${svg}</g><text x="${x + 30}" y="${yy + 4}" font-family="sans-serif" font-size="13" fill="#f0e2c4">${esc(label)}</text>`;
    })
    .join('\n');
}

const levelH = 1.5 * S * 26 + S * 2;
const W = Math.ceil(LEVEL_W * castle.levels.length + PAD);
const H = Math.ceil(TOP + levelH + 120);
const body = castle.levels.map((lv, i) => renderLevel(lv, i * LEVEL_W)).join('\n');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#1c1916"/>
${body}
${legend(TOP + levelH + 30)}
</svg>
`;
writeFileSync(out, svg);
console.log(`wrote ${out} (${W}x${H})`);
