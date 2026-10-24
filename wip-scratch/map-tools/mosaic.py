import sys, json
from PIL import Image, ImageDraw, ImageFont
import numpy as np
S='/tmp/claude-0/-home-claude/3b2be1b5-7f59-5b84-a231-0097b7d3d398/scratchpad'
page=sys.argv[1]; x0g=int(sys.argv[2]) if len(sys.argv)>2 else 0
W=16;H=12;L='ABCDEFGHIJKLMNOPQRSTU'
f=json.load(open(f'{S}/scan/{page}_fit.json')); X=np.array(f['X']); Y=np.array(f['Y'])
im=Image.open(f'{S}/scan/{page}_up.png').convert('RGB')
doors=json.load(open(f'{S}/scan/{page}_doors.json'))
tiles=[]
for d in doors:
    r,c=d['r'],d['c']
    if d['k']=='v': cx=X[r,c]; cy=(Y[min(c,W-1),r]+Y[min(c,W-1),r+1])/2; desc=f'{L[x0g+c-1]}{r+1}|{L[x0g+c] if c<W else ">"}{r+1}'
    else: cy=Y[c,r]; cx=(X[min(r,H-1),c]+X[min(r,H-1),c+1])/2; desc=f'{L[x0g+c]}{r}/{L[x0g+c]}{r+1}'
    o=d.get('stars',0)
    if d['k']=='v': cy+=o
    else: cx+=o
    t=im.crop((int(cx-75),int(cy-75),int(cx+75),int(cy+75))).resize((150,150))
    canvas=Image.new('RGB',(150,175),'white'); canvas.paste(t,(0,25))
    ImageDraw.Draw(canvas).text((4,4),f"{d['k']}{r},{c} {desc}",fill='black',font=ImageFont.load_default(size=16))
    tiles.append(canvas)
cols=8; rows=(len(tiles)+cols-1)//cols
M=Image.new('RGB',(cols*155,rows*180),'grey')
for i,t in enumerate(tiles): M.paste(t,((i%cols)*155,(i//cols)*180))
M.save(f'{S}/scan/{page}_doormosaic.png')
