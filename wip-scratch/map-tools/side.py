# side.py n page x0g half(top|bottom) out : render half next to scan half
import sys, json
from PIL import Image
import numpy as np
S='/tmp/claude-0/-home-claude/3b2be1b5-7f59-5b84-a231-0097b7d3d398/scratchpad'
n,page,x0g,half,out=sys.argv[1],sys.argv[2],int(sys.argv[3]),sys.argv[4],sys.argv[5]
f=json.load(open(f'{S}/scan/{page}_fit.json')); X=np.array(f['X']); Y=np.array(f['Y'])
r0,r1=(0,6) if half=='top' else (6,12)
scan=Image.open(f'{S}/scan/{page}_up.png').convert('RGB')
sc=scan.crop((int(X[:,0].min())-50,int(Y[:,r0].min())-50,int(X[:,16].max())+50,int(Y[:,r1].max())+50))
ren=Image.open(f'{S}/maps/level-{n}.png').convert('RGB')
CELL=60;PAD=60
rc=ren.crop((PAD-50*CELL//180,PAD+r0*CELL-50*CELL//180,PAD+16*CELL+50*CELL//180,PAD+r1*CELL+50*CELL//180))
w=1400; s1=w/sc.size[0]; sc=sc.resize((w,int(sc.size[1]*s1)))
rc=rc.resize((w,int(rc.size[1]*w/rc.size[0])))
M=Image.new('RGB',(w,sc.size[1]+rc.size[1]+10),'white'); M.paste(sc,(0,0)); M.paste(rc,(0,sc.size[1]+10)); M.save(out)
