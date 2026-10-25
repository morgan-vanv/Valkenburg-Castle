# Compose the three scale-study panels into mockup/shots/scale-options.png.
# python3 mockup/scale-compose.py <dir with panel-A.png panel-B.png panel-C.png> <out.png>
import sys
from PIL import Image, ImageDraw

src, out_path = sys.argv[1], sys.argv[2]
ims = [Image.open(f"{src}/panel-{p}.png").convert("RGB") for p in "ABC"]
w, h = ims[0].size
out = Image.new("RGB", (w * len(ims), h), (5, 4, 4))
for i, im in enumerate(ims):
    out.paste(im, (i * w, 0))
d = ImageDraw.Draw(out)
for i in range(1, len(ims)):
    d.line([(i * w, 0), (i * w, h)], fill=(60, 54, 48), width=2)
out.save(out_path)
print(out.size, out_path)
