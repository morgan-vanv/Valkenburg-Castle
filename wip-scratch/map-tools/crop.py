# crop.py page x0g c0 c1 r0 r1 out  (cols/rows 0-based inclusive local indices) -> labelled crop
import sys, json
from PIL import Image, ImageDraw, ImageFont
import numpy as np
S='/tmp/claude-0/-home-claude/3b2be1b5-7f59-5b84-a231-0097b7d3d398/scratchpad'
page=sys.argv[1]; x0g=int(sys.argv[2]); c0,c1,r0,r1=map(int,sys.argv[3:7]); out=sys.argv[7]
L='ABCDEFGHIJKLMNOPQRSTU'
f=json.load(open(f'{S}/scan/{page}_fit.json')); X=np.array(f['X']); Y=np.array(f['Y'])
im=Image.open(f'{S}/scan/{page}_up.png').convert('RGB')
d=ImageDraw.Draw(im); font=ImageFont.load_default(size=22)
for r in range(12):
    for c in range(16):
        cx=(X[r,c]+X[r,c+1])/2; cy=(Y[c,r]+Y[c,r+1])/2
        d.text((cx-60,cy-75),f'{L[x0g+c]}{r+1}',fill=(0,0,255),font=font)
xa=X[:,c0].min()-60; xb=X[:,c1+1].max()+60; ya=Y[:,r0].min()-60; yb=Y[:,r1+1].max()+60
cr=im.crop((int(xa),int(ya),int(xb),int(yb)))
s=min(1.0,1400/max(cr.size)); cr=cr.resize((int(cr.size[0]*s),int(cr.size[1]*s)))
cr.save(out)
