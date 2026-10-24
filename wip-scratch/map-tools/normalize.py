# normalize.py file x0g "rock labels" : set cells to rock (others '.' if they were '#'), then force walls on rock edges + border
import sys
L='ABCDEFGHIJKLMNOPQRSTU'
f=sys.argv[1]; x0g=int(sys.argv[2]); rock=set(sys.argv[3].split()) if len(sys.argv)>3 else None
g=[list(s) for s in open(f).read().rstrip('\n').split('\n')]
H=(len(g)-1)//2; W=(len(g[0])-1)//2
def lab(c,r): return f'{L[x0g+c]}{r+1}'
if rock is not None:
    for r in range(H):
        for c in range(W):
            if lab(c,r) in rock: g[2*r+1][2*c+1]='#'
            elif g[2*r+1][2*c+1]=='#': g[2*r+1][2*c+1]='.'
def isrock(c,r): return 0<=c<W and 0<=r<H and g[2*r+1][2*c+1]=='#'
for r in range(H+1):
    for c in range(W):
        if r==0 or r==H or isrock(c,r-1) or isrock(c,r): g[2*r][2*c+1]='-'
for r in range(H):
    for c in range(W+1):
        if c==0 or c==W or isrock(c-1,r) or isrock(c,r): g[2*r+1][2*c]='|'
open(f,'w').write('\n'.join(''.join(x) for x in g)+'\n')
