import sys, json
from PIL import Image
import numpy as np
S='/tmp/claude-0/-home-claude/3b2be1b5-7f59-5b84-a231-0097b7d3d398/scratchpad'
page=sys.argv[1]; W=16; H=12
im=Image.open(f'{S}/scan/{page}_up.png').convert('RGB')
a=np.asarray(im).astype(int)
dark=(a.sum(2)<360)
# outer border approx: find from projection
def peaks(p,thr,minw=1):
    out=[];i=0
    while i<len(p):
        if p[i]>thr:
            j=i
            while j<len(p) and p[j]>thr: j+=1
            out.append(((i+j-1)/2, j-i, int(p[i:j].max()))); i=j
        else: i+=1
    return out
x0,x1,y0,y1=[float(v) for v in sys.argv[2:6]]
def smooth(p,k=9):
    return np.convolve(p,np.ones(k)/k,mode='same')
# refine vertical lines per row band
xs=np.zeros((H,W+1)); ys=np.zeros((W,H+1))
cw=(x1-x0)/W; ch=(y1-y0)/H
for r in range(H):
    ya=int(y0+ch*r+ch*0.2); yb=int(y0+ch*(r+1)-ch*0.2)
    p=smooth(dark[ya:yb].sum(0).astype(float))
    for c in range(W+1):
        e=x0+cw*c; lo=int(e-35); hi=int(e+35)
        xs[r,c]=lo+np.argmax(p[lo:hi])
for c in range(W):
    xa=int(x0+cw*c+cw*0.2); xb=int(x0+cw*(c+1)-cw*0.2)
    p=smooth(dark[:,xa:xb].sum(1).astype(float))
    for r in range(H+1):
        e=y0+ch*r; lo=int(e-35); hi=int(e+35)
        ys[c,r]=lo+np.argmax(p[lo:hi])
np.set_printoptions(linewidth=250)
print(xs.astype(int)); print(ys.astype(int).T)
json.dump({'xs':xs.tolist(),'ys':ys.tolist()},open(f'{S}/scan/{page}_grid.json','w'))
