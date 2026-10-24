import sys, json
from PIL import Image
import numpy as np
S='/tmp/claude-0/-home-claude/3b2be1b5-7f59-5b84-a231-0097b7d3d398/scratchpad'
page=sys.argv[1]; x0g=int(sys.argv[2]) if len(sys.argv)>2 else 0
W=16;H=12
L='ABCDEFGHIJKLMNOPQRSTU'
f=json.load(open(f'{S}/scan/{page}_fit.json')); X=np.array(f['X']); Y=np.array(f['Y'])
a=np.asarray(Image.open(f'{S}/scan/{page}_up.png').convert('RGB')).astype(int)
R,G,B=a[...,0],a[...,1],a[...,2]
red=(R>140)&(R-G>70)&(R-B>60)
dark=(a.sum(2)<330)&(np.abs(R-B)<70)
cw=np.median(np.diff(X,axis=1)); hs=cw*0.31  # half side of door square
def score(cx,cy):
    sides=0
    for (dx,dy,vert) in [(-hs,0,True),(hs,0,True),(0,-hs,False),(0,hs,False)]:
        x=int(cx+dx); y=int(cy+dy)
        if vert: reg=red[y-30:y+30,x-14:x+15]; v=reg.any(1).mean()
        else: reg=red[y-14:y+15,x-30:x+30]; v=reg.any(0).mean()
        if v>0.35: sides+=1
    return sides
def stars(cx,cy,vert):
    x0=int(cx-hs+12); x1=int(cx+hs-12); y0=int(cy-hs+12); y1=int(cy+hs-12)
    reg=dark[y0:y1,x0:x1].copy()
    if vert: m=reg.shape[1]//2; reg[:,max(0,m-18):m+18]=False
    else: m=reg.shape[0]//2; reg[max(0,m-18):m+18,:]=False
    return int(reg.sum())
out=[]
for r in range(H):
    for c in range(W+1):
        cx=X[r,c]; cy=(Y[min(c,W-1),r]+Y[min(c,W-1),r+1])/2 if c<W else (Y[W-1,r]+Y[W-1,r+1])/2
        best=max((score(cx,cy+o),o) for o in range(-60,61,10))
        s=best[0]
        if s>=3: out.append(('v',r,c,s,best[1]))
for r in range(H+1):
    for c in range(W):
        cy=Y[c,r]; cx=(X[min(r,H-1),c]+X[min(r,H-1),c+1])/2
        best=max((score(cx+o,cy),o) for o in range(-60,61,10))
        s=best[0]
        if s>=3: out.append(('h',r,c,s,best[1]))
res=[]
for k,r,c,s,st in out:
    lk=False
    if k=='v': desc=f'{L[x0g+c-1] if c>0 else "<"}{r+1}|{L[x0g+c] if c<W else ">"}{r+1}'
    else: desc=f'{L[x0g+c]}{r}/{L[x0g+c]}{r+1}'
    print(k,r,c,'sides',s,'off',st,'LOCK' if lk else '', desc)
    res.append({'k':k,'r':r,'c':c,'locked':lk,'stars':st})
json.dump(res,open(f'{S}/scan/{page}_doors.json','w'))
print(len(res),'doors')
