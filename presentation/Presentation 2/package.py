from pathlib import Path
import base64,re,mimetypes,json
root=Path(r'C:/Users/x1Ras/Downloads/Waypoint-HTML')
def data(asset):
 p=root/asset
 return 'data:'+('font/ttf' if p.suffix=='.ttf' else mimetypes.guess_type(p.name)[0])+';base64,'+base64.b64encode(p.read_bytes()).decode()
html=(root/'index.html').read_text(encoding='utf-8-sig');css=(root/'styles.css').read_text(encoding='utf-8');js=(root/'app.js').read_text(encoding='utf-8')
css=re.sub(r"url\('([^']+)'\)",lambda m:"url('"+data(m[1])+"')",css)
html=re.sub(r'src="(assets/[^\"]+)"',lambda m:'src="'+data(m[1])+'"',html)
images={str(n):data(f'assets/image{n}.png') for n in [9,10,11,12,13,17]}
js=js.replace('src="assets/image${f.image}.png"','src="${offlineImages[f.image]}"')
js='const offlineImages='+json.dumps(images)+';\n'+js
html=html.replace('<link rel="stylesheet" href="styles.css">','<style>'+css+'</style>').replace('<script src="app.js"></script>','<script>'+js+'</script>')
(root/'Waypoint-Presentation.html').write_text(html,encoding='utf-8')
print('Self-contained HTML bytes',len(html.encode()))
