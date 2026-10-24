import sys, json
from PIL import Image
import numpy as np
S='/tmp/claude-0/-home-claude/3b2be1b5-7f59-5b84-a231-0097b7d3d398/scratchpad'
page=sys.argv[1]; W=16; H=12
f=json.load(open(f'{S}/scan/{page}_fit.json')); X=np.array(f['X']); Y=np.array(f['Y'])
a=np.asarray(Image.open(f'{S}/scan/{page}_up.png').convert('RGB')).astype(int)
R,G,B=a[...,0],a[...,1],a[...,2]
dark=(a.sum(2)<330)&(np.abs(R-B)<70)
doors={(d['k'],d['r'],d['c']):d['locked'] for d in json.load(open(f'{S}/scan/{page}_doors.json'))}
def cyx(c,r): return Y[min(max(c,0),W-1),r]
def cxy(r,c): return X[min(max(r,0),H-1),c]
cells=[[None]*W for _ in range(H)]
for r in range(H):
    for c in range(W):
        cx=(cxy(r,c)+cxy(r,c+1))/2; cy=(cyx(c,r)+cyx(c,r+1))/2
        reg=dark[int(cy-50):int(cy+50),int(cx-50):int(cx+50)]
        cells[r][c]='#' if reg.mean()>0.6 else '.'
def edge(k,r,c):
    if (k,r,c) in doors: return 'L' if doors[(k,r,c)] else 'd'
    if k=='v':
        x=cxy(r,c); ya=(cyx(c-1,r)+cyx(c,r))/2; yb=(cyx(c-1,r+1)+cyx(c,r+1))/2
        Lh=yb-ya; d=dark[int(ya+Lh*.3):int(ya+Lh*.7),int(x)-14:int(x)+15].T
    else:
        y=cyx(c,r); xa=(cxy(r-1,c)+cxy(r,c))/2; xb=(cxy(r-1,c+1)+cxy(r,c+1))/2
        Lw=xb-xa; d=dark[int(y)-14:int(y)+15,int(xa+Lw*.3):int(xa+Lw*.7)]
    cov=d.any(0).mean()
    return 'W' if cov>0.85 else ' '
lines=[]
for r in range(H+1):
    s='+'
    for c in range(W):
        e=edge('h',r,c); s+=('-' if e=='W' else e)+'+'
    lines.append(s)
    if r<H:
        s=''
        for c in range(W+1):
            e=edge('v',r,c); s+=('|' if e=='W' else e)
            if c<W: s+=cells[r][c]
        lines.append(s)
print('\n'.join(lines))
