from PIL import Image,ImageOps,ImageDraw
from pathlib import Path
root=Path(r'C:/Users/x1Ras/Downloads/Waypoint-HTML/assets');canvas=Image.new('RGB',(1200,810),'#eee')
for n in range(9,18):
 im=Image.open(root/f'image{n}.png');im.thumbnail((390,220));x=((n-9)%3)*400;y=((n-9)//3)*270;canvas.paste(im,(x,y+30));ImageDraw.Draw(canvas).text((x+5,y+5),str(n),fill='black')
canvas.save(root.parent/'screens.png')
