# overlay.py page x0g grid.txt c0 c1 r0 r1 out : draw ASCII grid on scan
import sys, json
from PIL import Image, ImageDraw, ImageFont
import numpy as np
S='/tmp/claude-0/-home-claude/3b2be1b5-7f59-5b84-a231-0097b7d3d398/scratchpad'
page=sys.argv[1]; x0g=int(sys.argv[2]); g=open(sys.argv[3]).read().rstrip('\n').split('\n')
c0,c1,r0,r1=map(int,sys.argv[4:8]); out=sys.argv[8]
W=16;H=12;L='ABCDEFGHIJKLMNOPQRSTU'
f=json.load(open(f'{S}/scan/{page}_fit.json')); X=np.array(f['X']); Y=np.array(f['Y'])
im=Image.open(f'{S}/scan/{page}_up.png').convert('RGB')
ov=Image.new('RGBA',im.size,(0,0,0,0)); d=ImageDraw.Draw(ov)
font=ImageFont.load_default(size=26)
def px(c,r):
    cc=min(max(c,0),W); rr=min(max(r,0),H)
    x=X[min(rr,H-1),cc]; y=Y[min(cc,W-1),rr]; return x,y
col={'-':(0,90,255,200),'|':(0,90,255,200),'d':(255,0,255,230),'L':(255,140,0,230),' ':(0,200,0,160)}
for r in range(H+1):
    for c in range(W):
        ch=g[2*r][2*c+1]; (xa,ya)=px(c,r); (xb,yb)=px(c+1,r)
        w=10 if ch in '-dL' else 3
        d.line([(xa+12,ya),(xb-12,yb)],fill=col[ch],width=w)
for r in range(H):
    for c in range(W+1):
        ch=g[2*r+1][2*c]; (xa,ya)=px(c,r); (xb,yb)=px(c,r+1)
        w=10 if ch in '|dL' else 3
        d.line([(xa,ya+12),(xb,yb-12)],fill=col[ch],width=w)
for r in range(H):
    for c in range(W):
        ch=g[2*r+1][2*c+1]; (xa,ya)=px(c,r); (xb,yb)=px(c+1,r+1)
        if ch=='#': d.rectangle([xa+30,ya+30,xb-30,yb-30],outline=(0,90,255,220),width=8)
        elif ch=='p': d.line([(xa+30,ya+30),(xb-30,yb-30)],fill=(0,160,0,220),width=6); d.line([(xa+30,yb-30),(xb-30,ya+30)],fill=(0,160,0,220),width=6)
        elif ch!='.': d.text(((xa+xb)/2-8,(ya+yb)/2+20),ch,fill=(0,0,255,255),font=font)
        d.text((xa+20,ya+16),f'{L[x0g+c]}{r+1}',fill=(0,0,200,200),font=ImageFont.load_default(size=18))
im=Image.alpha_composite(im.convert('RGBA'),ov).convert('RGB')
xa=X[:,c0].min()-50; xb=X[:,c1+1].max()+50; ya=Y[:,r0].min()-50; yb=Y[:,r1+1].max()+50
cr=im.crop((int(xa),int(ya),int(xb),int(yb)))
s=min(1.0,1400/max(cr.size)); cr=cr.resize((int(cr.size[0]*s),int(cr.size[1]*s)))
cr.save(out)
