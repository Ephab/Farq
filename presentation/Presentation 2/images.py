from PIL import Image
from pathlib import Path
for p in Path(r'C:/Users/x1Ras/Downloads/Waypoint-HTML/assets').glob('*.png'):
 i=Image.open(p);print(p.name,i.size,i.mode)
