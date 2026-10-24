# setedge.py file x0g spec...   spec: "v:M12=open" (edge left of M12), "h:K4=wall" (edge above K4), "c:K4=p" (cell)
import sys
L='ABCDEFGHIJKLMNOPQRSTU'
f=sys.argv[1]; x0g=int(sys.argv[2]); g=[list(s) for s in open(f).read().rstrip('\n').split('\n')]
m={'open':' ','wall':None,'door':'d','locked':'L'}
for sp in sys.argv[3:]:
    k,rest=sp.split(':'); sq,val=rest.split('=')
    c=L.index(sq[0])-x0g; r=int(sq[1:])-1
    if k=='v': g[2*r+1][2*c]= '|' if val=='wall' else m[val]
    elif k=='h': g[2*r][2*c+1]= '-' if val=='wall' else m[val]
    else: g[2*r+1][2*c+1]=val
open(f,'w').write('\n'.join(''.join(x) for x in g)+'\n')
