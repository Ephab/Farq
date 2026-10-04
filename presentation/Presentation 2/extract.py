from zipfile import ZipFile
from pathlib import Path
from xml.etree import ElementTree as E
import re,json
out=Path(r'C:/Users/x1Ras/Downloads/Waypoint-HTML/assets')
with ZipFile(r'C:/Users/x1Ras/Downloads/Waypoint-pitch.pptx') as z:
 for n in z.namelist():
  if n.startswith('ppt/media/'):(out/Path(n).name).write_bytes(z.read(n))
 for n in sorted((x for x in z.namelist() if re.fullmatch(r'ppt/slides/slide\d+.xml',x)),key=lambda s:int(re.search(r'(\d+)\.xml',s)[1])):
  root=E.fromstring(z.read(n));print(n,' | '.join(t.text or '' for t in root.findall('.//{http://schemas.openxmlformats.org/drawingml/2006/main}t'))[:650])
  if n.endswith('/slide1.xml'):
   print(z.read('ppt/slides/_rels/slide1.xml.rels').decode())
