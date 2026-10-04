from pathlib import Path
p=Path(r'C:/Users/x1Ras/Downloads/Waypoint-HTML/app.js');s=p.read_text(encoding='utf-8-sig')
s=s.replace("function apply(){", "const routeLength=$('road').getTotalLength();\nfunction roadPoint(y){let lo=0,hi=routeLength;for(let i=0;i<16;i++){const m=(lo+hi)/2;if($('road').getPointAtLength(m).y<y)lo=m;else hi=m}return $('road').getPointAtLength((lo+hi)/2)}\nfunction placeTraveler(y){const p=roadPoint(y);$('traveler').style.top=p.y+'px';$('traveler').style.left=p.x+'px'}\nfunction apply(){")
s=s.replace("const from={...camera};if(reduced)","const from={...camera},travelerFrom=parseFloat($('traveler').style.top)||715;if(reduced)")
s=s.replace("if(follow&&p>0&&p<1){camera.x+=42*Math.sin(Math.PI*p)*Math.sin(camera.y/270)}apply();", "if(follow){const r=roadPoint(camera.y);camera.x=r.x+(from.x-roadPoint(from.y).x)*(1-e);placeTraveler(travelerFrom+(target.y-travelerFrom)*e)}apply();")
s=s.replace("$('traveler').style.top=`${next===0?715:y}px`;$('traveler').style.left='800px'", "placeTraveler(next===0?715:y)")
p.write_text(s,encoding='utf-8')
p=Path(r'C:/Users/x1Ras/Downloads/Waypoint-HTML/styles.css');s=p.read_text(encoding='utf-8-sig');s+='\n.arrival h1,.arrival p{display:table;margin-left:auto;margin-right:auto;background:#fff;padding:0 24px}.hero-partners{top:765px}\n';p.write_text(s,encoding='utf-8')
