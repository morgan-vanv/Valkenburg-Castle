"""Castle map sketches (pass 2): three hex levels drawn from region shapes.

Each level is a list of regions in offset-ish (col, row) space. A hex belongs
to the first region that contains it. Walls are drawn around every walkable
hex. Output: one SVG per level plus a combined sheet.

    python3 mockup/sketch.py <outdir>
"""
import math
import random
import sys

SQ3 = math.sqrt(3)
COLS, ROWS = 46, 32
SIZE = 9  # px, hex center to corner


def center(c, r):
    return (SIZE * SQ3 * (c + 0.5 * (r & 1)), SIZE * 1.5 * r)


def to_world(c, r):
    # hex units: one column ~ 1 hex wide, one row ~ 0.866 hex tall
    return (c + 0.5 * (r & 1), r * 0.866)


# ---------------------------------------------------------------- shapes

def ellipse(cx, cy, rx, ry, jitter=0.0, seed=0):
    rnd = random.Random(seed)
    bumps = [rnd.uniform(-jitter, jitter) for _ in range(12)]

    def f(c, r):
        x, y = to_world(c, r)
        X, Y = to_world(cx, cy)
        dx, dy = (x - X) / rx, (y - Y) / (ry * 0.866)
        a = math.atan2(dy, dx)
        k = bumps[int(((a + math.pi) / (2 * math.pi)) * 12) % 12]
        return dx * dx + dy * dy <= (1 + k) ** 2
    return f


def rect(c0, r0, c1, r1):
    return lambda c, r: c0 <= c <= c1 and r0 <= r <= r1


def line(points, width=0):
    """Hexes near a polyline through (col,row) points."""
    segs = list(zip(points, points[1:]))

    def f(c, r):
        x, y = to_world(c, r)
        for (a, b) in segs:
            ax, ay = to_world(*a)
            bx, by = to_world(*b)
            vx, vy = bx - ax, by - ay
            L = vx * vx + vy * vy or 1
            t = max(0, min(1, ((x - ax) * vx + (y - ay) * vy) / L))
            px, py = ax + t * vx, ay + t * vy
            if (x - px) ** 2 + (y - py) ** 2 <= (0.55 + width) ** 2:
                return True
        return False
    return f


def union(*fs):
    return lambda c, r: any(f(c, r) for f in fs)


def minus(f, g):
    return lambda c, r: f(c, r) and not g(c, r)


# ---------------------------------------------------------------- palette

TINT = {
    'hall': '#a89a84', 'stone': '#9c9282', 'wood': '#9a7e5c', 'dark': '#7d7468', 'red': '#8e6a5a',
    'day': '#c8b98e', 'cave': '#6e5a48', 'fungus': '#6e8a6a', 'lair': '#8a4a32', 'bridge': '#b3a893',
    'ledge': '#8f8070', 'water': '#4e6a78', 'bone': '#9a8c78',
}
WALL = '#e4dccb'
WALL_EDGE = '#8a8170'
PIT = '#120c0c'
BG = '#1b1714'

# ---------------------------------------------------------------- levels
# Each level: regions = [(name, label, tint, shape)], plus marks.

PIT_L1 = ellipse(26, 15, 4.2, 3.4, 0.08, 1)
PIT_L2 = union(ellipse(24, 15, 8.5, 5.6, 0.06, 2), ellipse(29, 12, 5, 4.6, 0.05, 3))

L1 = dict(
    name='Level 1 · The Ruined Keep',
    pit=PIT_L1,
    regions=[
        ('hall', 'Great Hall', 'hall', minus(union(rect(15, 9, 33, 20), rect(18, 7, 30, 8)), union(rect(15, 9, 16, 10), rect(32, 19, 33, 20)))),
        ('gate', 'Gatehouse', 'day', rect(21, 24, 28, 29)),
        ('gate-pass', '', 'stone', rect(23, 21, 25, 23)),
        ('court', 'Courtyard', 'day', ellipse(9, 24, 7.5, 5.5, 0.12, 4)),
        ('court-gate', '', 'day', rect(16, 25, 20, 27)),
        ('court-hall', '', 'stone', line([(13, 21), (16, 19)], 0.3)),
        ('kitchen', 'Kitchens', 'wood', rect(3, 11, 11, 17)),
        ('kitchen-court', '', 'stone', rect(7, 18, 9, 19)),
        ('servants', "Servants' passage", 'dark', line([(6, 10), (6, 6)])),
        ('library', 'Library', 'wood', rect(3, 1, 12, 5)),
        ('lib-hall', '', 'stone', line([(12, 4), (14, 4), (16, 7), (17, 8)], 0.2)),
        ('tower', 'Tower stair', 'stone', rect(34, 1, 40, 6)),
        ('tower-hall', '', 'stone', line([(33, 7), (35, 6)], 0.2)),
        ('armory', 'Armory', 'red', rect(37, 10, 42, 14)),
        ('hall-armory', '', 'stone', line([(34, 12), (36, 12)])),
        ('chapel', 'Chapel', 'stone', ellipse(37, 21, 5, 4, 0.1, 5)),
        ('chapel-hall', '', 'stone', line([(33, 18), (34, 19)], 0.3)),
        ('chapel-gate', '', 'stone', line([(32, 24), (29, 26)], 0.2)),
        ('breach', '', 'stone', line([(41, 21), (44, 21)])),
        ('sally', '', 'stone', line([(3, 14), (1, 14)])),
        ('gate-out', '', 'stone', line([(24, 29), (24, 31)])),
    ],
    doors=[((6, 10), 'door'), ((6, 6), 'door'), ((36, 12), 'locked'), ((33, 7), 'door')],
    cracked=[(40, 16)],
    marks=[
        ((37, 3), 'S', 'Stairs down to Level 2'),
        ((24, 31), 'E', 'Main gate'), ((1, 14), 'E', 'Sally port'), ((44, 21), 'E', 'East breach'),
        ((37, 21), 'B', 'Brazier'), ((10, 23), 'D', 'Daylight'), ((24, 27), 'D', 'Daylight'),
        ((40, 12), 'C', 'Chest (locked)'),
    ],
)
L1['regions'].append(('armory-chapel', '', 'stone', line([(40, 15), (40, 17)])))

L2 = dict(
    name='Level 2 · The Crossing',
    pit=PIT_L2,
    regions=[
        ('crossing', 'The Crossing', 'bridge', ellipse(23, 16, 1.6, 1.4)),
        ('bridge-main', '', 'bridge', line([(15, 16), (34, 16)])),
        ('bridge-north', '', 'bridge', line([(23, 8), (23, 15)])),
        ('bridge-broken', '', 'bridge', line([(26, 22), (25, 19)])),
        ('arcade-n', 'Arcade', 'ledge', rect(14, 6, 33, 7)),
        ('arcade-w', '', 'ledge', rect(14, 7, 15, 19)),
        ('ledge-e', 'East ledge', 'ledge', line([(34, 8), (35, 12), (34, 17), (35, 21)])),
        ('ledge-s', 'South rim', 'ledge', rect(19, 21, 30, 21)),
        ('rim-winch', '', 'stone', rect(22, 22, 22, 22)),
        ('guard', 'Guard post', 'stone', rect(34, 2, 39, 7)),
        ('barracks', 'Barracks', 'wood', rect(16, 1, 31, 4)),
        ('barracks-arc', '', 'wood', union(rect(19, 5, 20, 5), rect(28, 5, 29, 5))),
        ('guard-barracks', '', 'stone', rect(32, 3, 33, 3)),
        ('officers', "Officers'", 'red', rect(6, 1, 11, 5)),
        ('off-barracks', '', 'stone', rect(12, 3, 15, 3)),
        ('archive', 'Archive', 'wood', ellipse(7, 13, 4.5, 5.2, 0.05, 6)),
        ('archive-arc', '', 'stone', rect(11, 12, 13, 13)),
        ('cells', 'Cellblock', 'dark', rect(3, 23, 15, 23)),
        ('cells-cells', '', 'dark', union(rect(8, 21, 9, 22), rect(12, 21, 13, 22), rect(4, 24, 5, 25), rect(8, 24, 9, 25), rect(12, 24, 13, 25))),
        ('archive-cells', '', 'stone', line([(5, 18), (5, 22)])),
        ('winch', 'Winch room', 'stone', rect(18, 23, 26, 28)),
        ('cells-winch', '', 'stone', rect(16, 23, 17, 23)),
        ('forge', 'Forge', 'red', ellipse(34, 26, 5.5, 3.4, 0.06, 7)),
        ('forge-ledge', '', 'stone', line([(35, 21), (35, 23)])),
        ('winch-forge', '', 'stone', rect(27, 24, 28, 26)),
    ],
    doors=[((13, 3), 'locked'), ((32, 3), 'door'), ((16, 23), 'door'), ((5, 20), 'door')],
    cracked=[(9, 7)],
    marks=[
        ((37, 3), 'S', 'Stairs up to Level 1'), ((24, 27), 'L', 'Lift down to Level 3 (winch)'),
        ((3, 23), 'F', 'Collapsed floor: drop to Level 3'), ((25, 19), 'X', 'Broken bridge end'),
        ((37, 28), 'B', 'Forge fire'), ((23, 16), 'T', 'Statue'), ((8, 3), 'C', 'Chest (locked)'),
    ],
)
# Officers' to archive: a cracked wall gap the charge opens (drawn as cracked).
L2['regions'].append(('off-archive', '', 'stone', rect(9, 6, 9, 6)))

L3 = dict(
    name='Level 3 · The Hollow',
    pit=None,
    regions=[
        ('bones', 'Bone pile', 'bone', ellipse(24, 15, 7, 5.5, 0.12, 8)),
        ('lair', 'The Lair', 'lair', ellipse(38, 12, 6.5, 7.5, 0.1, 9)),
        ('bones-lair', '', 'cave', line([(30, 15), (33, 14)], 0.3)),
        ('sealed', 'Sealed Stair', 'dark', line([(41, 5), (44, 2)], 0.2)),
        ('grove', 'Fungus grove', 'fungus', ellipse(11, 13, 5, 4, 0.12, 10)),
        ('grove-bones', '', 'cave', line([(15, 14), (17, 15)], 0.2)),
        ('nest', 'Spider nest', 'dark', ellipse(14, 4, 4, 3, 0.15, 11)),
        ('nest-grove', '', 'cave', line([(12, 7), (11, 9)])),
        ('nest-bones', '', 'cave', line([(17, 6), (20, 10)])),
        ('lift', 'Lift base', 'cave', ellipse(22, 25, 4, 3, 0.1, 12)),
        ('lift-bones', '', 'cave', line([(23, 20), (22, 22)], 0.3)),
        ('drain', 'The Drain', 'water', line([(9, 17), (8, 20), (5, 23), (4, 26), (1, 28)], 0.4)),
        ('lift-drain', '', 'cave', line([(18, 25), (14, 25), (8, 22)])),
        ('lair-lift', '', 'cave', line([(34, 19), (31, 23), (26, 25)])),
    ],
    doors=[((42, 4), 'sealed')],
    cracked=[],
    marks=[
        ((24, 27), 'L', 'Lift up to Level 2'), ((1, 28), 'E', 'Cave mouth exit'),
        ((5, 24), 'F', 'Landing from the collapsed cellblock'), ((39, 11), 'R', 'The Dragon on its hoard'),
        ((24, 13), 'P', 'Pit landing (falls from Levels 1 and 2)'),
        ((36, 9), 'V', 'Fire vent'), ((41, 15), 'V', 'Fire vent'), ((35, 15), 'V', 'Fire vent'),
        ((11, 13), 'G', 'Glowing fungus'),
    ],
)

LEVELS = [L1, L2, L3]

MARK_STYLE = {
    'S': ('#5aa0d8', 'Stairs'), 'E': ('#5cc05c', 'Exit'), 'L': ('#d8b040', 'Lift'), 'F': ('#e05a3a', 'Drop'),
    'B': ('#ff9a30', 'Fire / brazier'), 'D': ('#f0e0a0', 'Daylight'), 'C': ('#c8a040', 'Chest'),
    'X': ('#e05a3a', 'Broken bridge'), 'T': ('#d0c8b8', 'Statue'), 'R': ('#e04020', 'Dragon'),
    'P': ('#e05a3a', 'Pit landing'), 'V': ('#ff6a20', 'Fire vent'), 'G': ('#9ae09a', 'Fungus light'),
}


def hexpoly(cx, cy, s):
    pts = []
    for i in range(6):
        a = math.radians(60 * i - 30)
        pts.append(f'{cx + s * math.cos(a):.1f},{cy + s * math.sin(a):.1f}')
    return ' '.join(pts)


def render(level, ox=0, oy=0):
    owner = {}
    for r in range(ROWS):
        for c in range(COLS):
            pit = bool(level['pit'] and level['pit'](c, r))
            if pit:
                owner[(c, r)] = 'PIT'
            for (name, label, tint, f) in level['regions']:
                if pit and not (name.startswith('bridge') or name == 'crossing'):
                    continue
                if f(c, r):
                    owner[(c, r)] = (name, tint)
                    break
    for (c, r) in level['cracked']:
        owner[(c, r)] = ('cracked', 'stone')
    out = []
    walk = {k for k, v in owner.items() if v != 'PIT'}

    def nbrs(c, r):
        odd = r & 1
        dirs = [(1, 0), (-1, 0), (0 if not odd else 1, -1), (-1 if not odd else 0, -1), (0 if not odd else 1, 1), (-1 if not odd else 0, 1)]
        return [(c + dc, r + dr) for dc, dr in dirs]

    # Pit
    for (c, r), v in owner.items():
        if v == 'PIT':
            x, y = center(c, r)
            out.append(f'<polygon points="{hexpoly(ox + x, oy + y, SIZE)}" fill="{PIT}"/>')
    # Walls
    walls = set()
    for (c, r) in walk:
        for n in nbrs(c, r):
            if n not in owner:
                walls.add(n)
    for (c, r) in walls:
        if not (0 <= c < COLS + 2 and 0 <= r < ROWS + 2):
            continue
        x, y = center(c, r)
        out.append(f'<polygon points="{hexpoly(ox + x, oy + y, SIZE)}" fill="{WALL}" stroke="{WALL_EDGE}" stroke-width="0.6"/>')
    # Floors
    for (c, r), v in owner.items():
        if v == 'PIT' or not isinstance(v, tuple) or len(v) != 2:
            continue
        name, tint = v
        x, y = center(c, r)
        fill = TINT[tint]
        stroke = '#00000030'
        out.append(f'<polygon points="{hexpoly(ox + x, oy + y, SIZE * 0.96)}" fill="{fill}" stroke="{stroke}" stroke-width="0.5"/>')
        if name == 'cracked':
            out.append(f'<text x="{ox + x:.1f}" y="{oy + y + 3:.1f}" font-size="9" text-anchor="middle" fill="#3a2a1a">✖</text>')
    # Doors
    for ((c, r), kind) in level['doors']:
        x, y = center(c, r)
        col = {'door': '#6b4a2a', 'locked': '#c8961e', 'sealed': '#7a5ac8'}[kind]
        out.append(f'<polygon points="{hexpoly(ox + x, oy + y, SIZE * 0.8)}" fill="{col}" stroke="#1a1208" stroke-width="1"/>')
        if kind != 'door':
            out.append(f'<text x="{ox + x:.1f}" y="{oy + y + 3:.1f}" font-size="8" text-anchor="middle" fill="#1a1208" font-weight="bold">{"L" if kind == "locked" else "✦"}</text>')
    # Marks
    for ((c, r), m, _desc) in level['marks']:
        x, y = center(c, r)
        col = MARK_STYLE[m][0]
        out.append(f'<circle cx="{ox + x:.1f}" cy="{oy + y:.1f}" r="{SIZE * 0.8:.1f}" fill="{col}" stroke="#1a1208" stroke-width="1"/>')
        out.append(f'<text x="{ox + x:.1f}" y="{oy + y + 3.2:.1f}" font-size="9" text-anchor="middle" fill="#1a1208" font-weight="bold">{m}</text>')
    # Labels
    for (name, label, tint, f) in level['regions']:
        if not label:
            continue
        cells = [k for k, v in owner.items() if isinstance(v, tuple) and len(v) == 2 and v[0] == name]
        if not cells:
            continue
        xs = [center(c, r)[0] for c, r in cells]
        ys = [center(c, r)[1] for c, r in cells]
        x, y = sum(xs) / len(xs), sum(ys) / len(ys)
        out.append(f'<text x="{ox + x:.1f}" y="{oy + y + 4:.1f}" font-size="13" text-anchor="middle" fill="#fff8ec" stroke="#1b1714" stroke-width="3" paint-order="stroke" font-family="Georgia, serif" font-weight="bold">{label}</text>')
    return out


def legend(ox, oy, keys):
    out = []
    y = oy
    for k in keys:
        col, name = MARK_STYLE[k]
        out.append(f'<circle cx="{ox}" cy="{y}" r="7" fill="{col}" stroke="#1a1208"/>')
        out.append(f'<text x="{ox}" y="{y + 3}" font-size="9" text-anchor="middle" font-weight="bold" fill="#1a1208">{k}</text>')
        out.append(f'<text x="{ox + 14}" y="{y + 4}" font-size="12" fill="#e8dcc8" font-family="Helvetica, sans-serif">{name}</text>')
        y += 20
    for col, name in [('#6b4a2a', 'Door'), ('#c8961e', 'Locked door'), ('#7a5ac8', 'Sealed door'), (PIT, 'Pit (open drop)'), (WALL, 'Wall')]:
        out.append(f'<polygon points="{hexpoly(ox, y, 7)}" fill="{col}" stroke="#8a8170"/>')
        out.append(f'<text x="{ox + 14}" y="{y + 4}" font-size="12" fill="#e8dcc8" font-family="Helvetica, sans-serif">{name}</text>')
        y += 20
    return out


def page(level, w, h):
    body = render(level, 20, 50)
    keys = sorted({m for (_, m, _) in level['marks']}, key=list(MARK_STYLE).index)
    body += legend(w - 150, 70, keys)
    head = f'<text x="20" y="32" font-size="20" fill="#f4ead8" font-family="Georgia, serif" font-weight="bold">{level["name"]}</text>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><rect width="{w}" height="{h}" fill="{BG}"/>{head}{"".join(body)}</svg>'


if __name__ == '__main__':
    outdir = sys.argv[1]
    W = int(SIZE * SQ3 * (COLS + 1)) + 200
    H = int(SIZE * 1.5 * (ROWS + 1)) + 70
    for i, lv in enumerate(LEVELS, 1):
        open(f'{outdir}/level{i}.svg', 'w').write(page(lv, W, H))
    print(W, H)
