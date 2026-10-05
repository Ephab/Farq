// Combine the current quiz creation UI with the Blackboard slide workbench.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=path.dirname(fileURLToPath(import.meta.url));
const probe=file=>Number(spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',file],{encoding:'utf8'}).stdout.trim());
export async function composeStudy(){
  const videos=path.join(root,'assets/video'),raw=path.resolve(root,'../../.cache/presentation-5/recordings');
  const quiz=path.join(videos,'quiz-create.mp4'),slides=path.join(videos,'study-slides.mp4');
  // Give the small live progress tube room to read inside the presentation's demo.
  // Ease into the generation card, hold, then return to the full UI for the quiz.
  const quizSource=path.join(raw,'quiz-create-encoded.mp4');
  try{
    await fs.access(quizSource);
    const zoom='if(lt(it,2),1,if(lt(it,3),1+1.1*(1-cos(PI*(it-2)))/2,if(lt(it,6.2),2.1,if(lt(it,7.2),1+1.1*(1+cos(PI*(it-6.2)))/2,1))))';
    const focused=path.join(raw,'quiz-create-focused.mp4');
    const focus=spawnSync('ffmpeg',['-y','-loglevel','error','-i',quizSource,'-vf',`zoompan=z='${zoom}':x=0:y='(ih-ih/zoom)*.83':d=1:s=1440x900:fps=60`,'-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-an','-movflags','+faststart',focused],{encoding:'utf8'});
    if(focus.status!==0)throw new Error(focus.stderr);
    await fs.copyFile(focused,quiz);
  }catch(e){if(e.code!=='ENOENT')throw e;}
  // Preserve the original slide capture before replacing the presentation clip.
  try{await fs.access(slides);}catch{await fs.copyFile(path.join(videos,'study.mp4'),slides);}
  const q=probe(quiz),s=probe(slides),tail=4.8,fade=.35,encoded=path.join(raw,'study-composite.mp4');
  const graph=`[0:v]settb=AVTB,setpts=PTS-STARTPTS[a];[1:v]trim=start=${Math.max(0,s-tail)},settb=AVTB,setpts=PTS-STARTPTS[b];[a][b]xfade=transition=fade:duration=${fade}:offset=${q-fade},format=yuv420p[v]`;
  const ff=spawnSync('ffmpeg',['-y','-loglevel','error','-i',quiz,'-i',slides,'-filter_complex',graph,'-map','[v]','-c:v','libx264','-preset','fast','-crf','19','-r','60','-an','-movflags','+faststart',encoded],{encoding:'utf8'});
  if(ff.status!==0)throw new Error(ff.stderr);
  await fs.copyFile(encoded,path.join(videos,'study.mp4'));
  const still=spawnSync('ffmpeg',['-y','-loglevel','error','-i',path.join(raw,'quiz-create-tube.png'),'-vf','scale=1440:900','-quality','88',path.join(root,'assets/img/study.webp')],{encoding:'utf8'});
  if(still.status!==0)throw new Error(still.stderr);
  return{name:'study',view:'Quizzes and Slides',captured_at:new Date().toISOString(),seconds:probe(encoded),fps:60,account:'demo-student',browser_fixture:true,parts:['quiz-create.mp4','study-slides.mp4 (last 4.8 seconds)'],fixture_detail:'Current React quiz configuration, animated creation tube, question feedback and Blackboard slide workbench. Fictional lecture PDF and local generation replies; accelerated illustrative waiting stage, no live model call or generation-speed claim.',errors:[]};
}
