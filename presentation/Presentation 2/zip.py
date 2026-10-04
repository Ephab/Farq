from zipfile import ZipFile,ZIP_DEFLATED
from pathlib import Path
root=Path(r'C:/Users/x1Ras/Downloads/Waypoint-HTML')
with ZipFile(root/'Waypoint-HTML-Package.zip','w',ZIP_DEFLATED) as z:
 for n in ['Waypoint-Presentation.html','README.txt','index.html','styles.css','app.js','package.py']:z.write(root/n,n)
 for n in ['image1.png','image2.png','image3.png','image9.png','image10.png','image11.png','image12.png','image13.png','image17.png','Cairo-Regular.ttf','Cairo-Bold.ttf']:z.write(root/'assets'/n,'assets/'+n)
print('Presentation and editable source packaged.')
