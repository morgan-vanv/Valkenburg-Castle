import sys, json
from PIL import Image
import numpy as np
S='/tmp/claude-0/-home-claude/3b2be1b5-7f59-5b84-a231-0097b7d3d398/scratchpad'
page=sys.argv[1]; W=16; H=12
g=json.load(open(f'{S}/scan/{page}_grid.json'))
xs=np.array(g['xs']); ys=np.array(g['ys'])  # xs[r][c], ys[c][r]
def robust(v):
    idx=np.arange(len(v)); m=np.ones(len(v),bool)
    for _ in range(4):
        p=np.polyfit(idx[m],v[m],1); res=np.abs(np.polyval(p,idx)-v)
        thr=max(8,np.median(res[m])*3); m=res<thr
    return np.polyval(p,idx)
X=np.zeros_like(xs); Y=np.zeros_like(ys)
for c in range(W+1): X[:,c]=robust(xs[:,c])
for r in range(H+1): Y[:,r]=robust(ys[:,r])
json.dump({'X':X.tolist(),'Y':Y.tolist()},open(f'{S}/scan/{page}_fit.json','w'))
im=Image.open(f'{S}/scan/{page}_up.png').convert('RGB')
a=np.asarray(im).astype(int)
R,G,B=a[...,0],a[...,1],a[...,2]
dark=(a.sum(2)<330)&(np.abs(R-B)<60)
red=(R>150)&(G<120)&(B<120)
def vx(r,c): return X[r,c]
# vertical edge left of cell (c,r): x=X[r,c], y from Y[c?] use avg of neighbours
def cy(c,r):  # y of horizontal line r near column c (c may be W)
    cc=min(c,W-1); return Y[cc,r]
out={'v':[],'h':[],'cell':[]}
def classify(sl_dark, sl_red, along):
    # sl_*: 2D arrays, axis0 across line (thickness), axis1 along
    cov=sl_dark.any(0)  # coverage along
    frac=cov.mean()
    redfrac=sl_red.any(0).mean()
    # thickness: count dark per column-of-along
    thick=np.median(sl_dark.sum(0)[cov]) if cov.any() else 0
    return frac,redfrac,thick
rows=[]
for r in range(H):
    line=[]
    for c in range(W+1):
        x=X[r,c]; ya=(cy(c-1 if c>0 else 0,r)+cy(min(c,W-1),r))/2; yb=(cy(max(c-1,0),r+1)+cy(min(c,W-1),r+1))/2
        L=yb-ya; s0=int(ya+L*0.3); s1=int(ya+L*0.7)
        d=dark[s0:s1,int(x)-14:int(x)+15].T; rd=red[s0:s1,int(x)-14:int(x)+15].T
        line.append(classify(d,rd,None))
    rows.append(line)
hrows=[]
for r in range(H+1):
    line=[]
    for c in range(W):
        y=Y[c,r]; xa=(X[max(r-1,0) if r>0 else 0,c]+X[min(r,H-1),c])/2; xb=(X[max(r-1,0),c+1]+X[min(r,H-1),c+1])/2
        L=xb-xa; s0=int(xa+L*0.3); s1=int(xa+L*0.7)
        d=dark[int(y)-14:int(y)+15,s0:s1]; rd=red[int(y)-14:int(y)+15,s0:s1]
        line.append(classify(d,rd,None))
    hrows.append(line)
def sym(f,rf,t,vert):
    if rf>0.3: return 'd'
    if f>0.85 and t>=14: return '|' if vert else '-'
    if f<0.15: return '?'
    if f>0.85: return '|' if vert else '-'
    return ' '
lines=[]
for r in range(H+1):
    s='+'
    for c in range(W): s+=sym(*hrows[r][c],False)+'+'
    lines.append(s)
    if r<H:
        s=''
        for c in range(W+1):
            s+=sym(*rows[r][c],True)
            if c<W: s+='.'
        lines.append(s)
print('\n'.join(lines))
if len(sys.argv)>2:
  for r in range(H+1):
    print(r,' '.join(f'{f:.2f}/{rf:.2f}/{t:.0f}' for f,rf,t in hrows[r]))
  for r in range(H):
    print(r,' '.join(f'{f:.2f}/{rf:.2f}/{t:.0f}' for f,rf,t in rows[r]))
