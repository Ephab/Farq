// Refresh the deck from the current React app. Only the fictional demo account is used.
// Backend writes are blocked. Coach replies are fixtures rendered by the real chat UI.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { studyLibrary, studyFiles, lecturePdf, filename, creationQuestions } from './demo-study.mjs';
import { composeStudy } from './compose-study.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const raw = path.resolve(root, '../../.cache/presentation-5/recordings');
const base = process.env.WAYPOINT_CAPTURE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true, channel: process.env.WAYPOINT_BROWSER || 'msedge' });
const only = process.argv.slice(2);
await fs.mkdir(raw, { recursive: true });
const records = [];
const pause = (page, ms) => page.waitForTimeout(ms);

async function smoothScroll(page, delta, selector) {
  await page.evaluate(async ({ delta, selector }) => {
    const candidates = selector ? [...document.querySelectorAll(selector)] : [...document.querySelectorAll('main, main *, .fq *')];
    const el = candidates.find(e => e.scrollHeight > e.clientHeight + 100 && e.clientHeight > 200 && /auto|scroll/.test(getComputedStyle(e).overflowY));
    if (!el) return;
    const from = el.scrollTop, to = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, from + delta));
    await new Promise(resolve => {
      const start = performance.now();
      function frame(now) {
        const t = Math.min(1, (now - start) / 1800), eased = (1 - Math.cos(Math.PI * t)) / 2;
        el.scrollTop = from + (to - from) * eased;
        if (t < 1) requestAnimationFrame(frame); else resolve();
      }
      requestAnimationFrame(frame);
    });
  }, { delta, selector });
}

async function capture(name, view, action) {
  if (only.length && !only.includes(name)) return;
  const viewport=name==='quiz-create'?{width:1152,height:720}:{width:1440,height:900};
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1,
    recordVideo: { dir: raw, size: viewport } });
  await context.addInitScript(view => {
    localStorage.setItem('waypoint.current-student', 'demo-student');
    localStorage.setItem('waypoint-locale', 'ar');
    localStorage.setItem('waypoint-theme', 'white');
    sessionStorage.setItem('waypoint.active-view', view);
  }, view);
  await context.route('**/api/**', async route => {
    if (!['GET', 'HEAD'].includes(route.request().method())) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    } else await route.continue();
  });
  const page = await context.newPage();
  if (name === 'study' || name === 'quiz-create') {
    const library=name==='quiz-create'?{...studyLibrary,quizzes:[]}:studyLibrary;
    await context.addInitScript(library => localStorage.setItem('waypoint-quiz-library-v1', JSON.stringify(library)), library);
    await context.route('**/api/students/demo-student/blackboard/slides', route => route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify({files:studyFiles}) }));
    await context.route('**/api/students/demo-student/blackboard/files/*/download', route => route.fulfill({status:200,contentType:'application/pdf',body:lecturePdf()}));
    await context.route('**/api/slides/suggest', route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({output:JSON.stringify({topics:[{title:'الاحتمالات من الفكرة إلى التطبيق',reason:'تطبيق مفهوم فضاء العينة',source:'deck'}]}),model:'demo-fixture',provider:'browser-fixture'})}));
    await context.route('**/api/slides/extend', route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({output:JSON.stringify({slides:studyLibrary.extensions[0].slides}),model:'demo-fixture',provider:'browser-fixture'})}));
    await context.route('**/api/quiz/generate', async route => {
      // Hold a local reply while the real generation job and liquid tube animate.
      await new Promise(resolve=>setTimeout(resolve,6500));
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({output:JSON.stringify({questions:creationQuestions}),model:'demo-fixture',provider:'browser-fixture'})});
    });
  }
  // Keep concurrent source edits from hot-reloading a take halfway through.
  await page.routeWebSocket('**/*', socket => socket.close());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (name === 'onboarding') {
    // Fictional imported suggestions, confined to this recording's browser.
    await context.route('**/api/students/demo-student/evidence', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { id: 'pitch-course', source_id: 'pitch-transcript', kind: 'course', title: 'Data Structures', data: { code: 'CS201', grade: 'A', term: '2026' }, source_ref: 'Demo transcript', status: 'suggested' },
      { id: 'pitch-project', source_id: 'pitch-github', kind: 'project', title: 'Campus Compass', data: { summary: 'نموذج تجريبي لخريطة الحرم الجامعي', languages: ['TypeScript'], frameworks: ['React', 'FastAPI'] }, source_ref: 'Demo repository', status: 'suggested' },
      { id: 'pitch-skill', source_id: 'pitch-github', kind: 'skill', title: 'Python', data: { context: 'مشروع تجريبي لتحليل البيانات' }, source_ref: 'Demo repository', status: 'suggested' },
    ]) }));
    await context.route('**/api/students/demo-student/sources', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { id: 'pitch-transcript', kind: 'transcript_pdf', label: 'سجل أكاديمي تجريبي', config: {}, status: 'ready', error: null },
      { id: 'pitch-github', kind: 'github', label: 'مشاريع تجريبية', config: {}, status: 'ready', error: null },
    ]) }));
  }
  // Populate a teaching exchange locally, without sending a prompt to an agent.
  if (name === 'coach') {
    await context.route('**/api/chat/threads/*/messages', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify([
        { id: 'pitch-user', role: 'user', content: 'أبي أتدرّب على الاحتمالات. اسألني قبل ما تعطيني الحل.', created_at: '2026-10-04T09:00:00Z' },
        { id: 'pitch-coach', role: 'assistant', content: 'خلّنا نبدأ بتجربة بسيطة. نرمي عملة مرتين. كم نتيجة ممكنة عندنا؟ جرّب السؤال، وبعدها نناقش السبب.', created_at: '2026-10-04T09:00:01Z', metadata: { elements: [{ kind: 'quiz', id: 'pitch-probability', title: 'تدريب على الاحتمالات', questions: [{ id: 'coin', type: 'mcq', stem: 'عند رمي عملة عادلة مرتين، ما احتمال ظهور الصورة مرة واحدة فقط؟', options: ['1/4', '1/2', '3/4', '1'], answer: '1/2', explanation: 'النتائج الأربع متساوية الاحتمال. اثنتان منها تحتويان على صورة واحدة، فيكون الاحتمال 2/4 = 1/2.', difficulty: 'easy' }] }] } },
      ])
    }));
  }
  await page.goto(base);
  await pause(page, 2600);
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.fonts.ready);
  if (name === 'coach') await page.locator('.chat-messages').evaluate(el => { el.scrollTop = 0; });
  const start = Date.now();
  await page.screenshot({ path: path.join(raw, `${name}-start.png`) });
  try { await action(page, context); } catch (error) {
    await page.screenshot({path:path.join(raw,`${name}-error.png`)});
    console.log('Capture error UI:',await page.locator('h1,h2,main button').allTextContents());
    throw error;
  }
  await pause(page, 1000);
  await page.screenshot({ path: path.join(raw, `${name}-poster.png`) });
  const duration = (Date.now() - start) / 1000;
  const video = page.video();
  await context.close();
  const source = await video.path();
  // Native browser captures are 25 fps. Optical-flow interpolation yields a smooth
  // 60 fps local MP4, with no skipped wheel bursts and no startup/loading footage.
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', source], { encoding: 'utf8' });
  const trim = Math.max(0, Number(probe.stdout.trim()) - duration);
  const output = path.join(root, 'assets/video', `${name==='study'?'study-slides':name}.mp4`);
  const encoded = path.join(raw, `${name}-encoded.mp4`);
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(trim), '-i', source, '-t', String(duration), '-vf', 'minterpolate=fps=60:mi_mode=mci:mc_mode=obmc:me_mode=bidir:me=hexbs:search_param=8:vsbmc=0,scale=1440:900', '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', encoded], { encoding: 'utf8' });
  if (ff.status !== 0) throw new Error(ff.stderr);
  await fs.copyFile(encoded, output);
  // Result frames keep the review/quiz/board readable even with reduced motion.
  const poster = ['onboarding', 'coach', 'projects', 'team', 'study', 'quiz-create'].includes(name) ? 'poster' : 'start';
  const still = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(raw, `${name}-${poster}.png`), '-quality', '88', path.join(root, 'assets/img', `${name === 'team' ? 'teams' : name}.webp`)], { encoding: 'utf8' });
  if (still.status !== 0) throw new Error(still.stderr);
  records.push({ name, view, captured_at:new Date().toISOString(), seconds: duration, fps: 60, account: 'demo-student', browser_fixture: ['coach', 'onboarding', 'study', 'quiz-create'].includes(name),
    ...(name==='quiz-create'?{fixture_detail:'Actual QuizConfigure, generation job, animated liquid tube and quiz runner; delayed local reply. Browser clock accelerates the illustrative waiting stage; no live model call or generation-speed claim.'}:{}),
    ...(name==='study'?{fixture_detail:'Fictional Blackboard catalog and in-memory lecture PDF; saved quiz and local slide suggestion/extension responses, rendered by current React components.'}:{}), errors });
  console.log(name, duration.toFixed(1) + 's', errors);
}

try {
  await capture('quiz-create','Quizzes',async page=>{
    await page.clock.install();
    await page.getByRole('button',{name:/STAT 201/}).click();
    await page.getByRole('checkbox',{name:`استخدام ${filename} للاختبار`,exact:true}).click();
    await pause(page,500);
    await page.getByRole('button',{name:'إنشاء اختبار',exact:true}).click();
    await page.getByRole('group',{name:'عدد الأسئلة'}).getByRole('button',{name:/^٥$|^5$/}).click();
    await pause(page,650);
    await page.getByRole('button',{name:'إنشاء اختبار',exact:true}).click();
    await page.getByRole('progressbar').first().evaluate(e=>e.scrollIntoView({block:'center',behavior:'instant'}));
    await pause(page,1100);await page.clock.fastForward(60000);
    await pause(page,1200);await page.clock.fastForward(90000);
    await page.screenshot({path:path.join(raw,'quiz-create-tube.png')});
    await pause(page,1600);
    await page.getByRole('button',{name:'ابدأ',exact:true}).waitFor();
    await pause(page,500);await page.getByRole('button',{name:'ابدأ',exact:true}).click();
    await pause(page,800);await page.keyboard.press('2');
    await page.getByRole('button',{name:'تحقق',exact:true}).click();
    await pause(page,1500);
  });
  await capture('study', 'Quizzes', async page => {
    await pause(page, 1100);
    await page.getByRole('button', { name: /STAT 201/ }).click();
    await page.getByRole('checkbox', { name: `استخدام ${filename} للاختبار`, exact:true }).click();
    await pause(page, 1300);
    await page.getByRole('button', { name:'ابدأ',exact:true }).click();
    await pause(page, 1500);
    await page.keyboard.press('2');
    await page.getByRole('button', { name:'تحقق',exact:true }).click();
    await pause(page, 1900);
    await page.locator('aside button').filter({hasText:'العروض التقديمية'}).first().click();
    await pause(page, 1200);
    await page.getByRole('button', {name:/STAT 201/}).click();
    await pause(page, 900);
    await page.locator('[data-blackboard-file="pitch-probability"]').click();
    await page.getByRole('button', {name:'الشريحة التالية',exact:true}).first().waitFor();
    await pause(page, 1300);
    await page.getByRole('button', {name:/استخدام في مساحة/}).click();
    await pause(page, 1500);
    await page.getByRole('button',{name:'وسّع الشرائح',exact:true}).click();
    await page.getByRole('button',{name:'حفظ التوسيع',exact:true}).waitFor();
    await page.getByRole('button',{name:'حفظ التوسيع',exact:true}).click();
    await page.getByRole('button',{name:'الشريحة التالية',exact:true}).last().scrollIntoViewIfNeeded();
    await pause(page, 1200);
    await page.getByRole('button',{name:'الشريحة التالية',exact:true}).last().click();
    await pause(page, 1300);
  });
  await capture('onboarding', 'My data', async page => {
    await pause(page, 1800); await smoothScroll(page, 340); await pause(page, 1500);
    await page.getByRole('button', { name: 'مراجعة العناصر الجديدة', exact: true }).click();
    await pause(page, 1500);
    await page.locator('input[type=checkbox]').last().uncheck();
    await pause(page, 1600);
  });
  await capture('roadmap', 'Roadmap', async page => {
    await pause(page, 1600); await smoothScroll(page, 260); await pause(page, 1300);
    await smoothScroll(page, -260); await pause(page, 700);
    await page.locator('.rm-node').filter({ hasText: 'Python & NumPy for Images' }).first().click();
    await pause(page, 2200);
  });
  await capture('coach', 'Hermes Coach', async page => {
    await pause(page, 1800);
    await page.locator('button').filter({ hasText: '1/2' }).first().click();
    await pause(page, 1600); await smoothScroll(page, 180, '.chat-messages'); await pause(page, 1800);
  });
  await capture('projects', 'Projects', async page => {
    await pause(page, 1800);
    await page.getByRole('button', { name: 'فتح مساحة العمل', exact: true }).first().click();
    await pause(page, 2200); await smoothScroll(page, 230); await pause(page, 2200);
  });
  await capture('team', 'Group Projects', async page => {
    await pause(page, 1300);
    await page.locator('.gp-project-row, .gp-project-card, button').filter({ hasText: 'Campus Compass' }).last().click();
    await pause(page, 2000);
    // Show the conversation, then give the board and documents the full width.
    await page.getByRole('button', { name: 'محادثة الفريق', exact: true }).first().click();
    await pause(page, 900);
    await page.getByRole('button', { name: 'إعداد المشروع', exact: true }).click();
    await pause(page, 1900);
    await page.getByRole('button', { name: 'المستندات', exact: true }).click();
    await pause(page, 1900);
    await page.getByRole('button', { name: 'اللوحة', exact: true }).click();
    await pause(page, 1400);
  });
  await capture('coop', 'Co-op', async page => {
    await pause(page, 1800); await smoothScroll(page, 280); await pause(page, 2000);
    await smoothScroll(page, -280); await pause(page, 1000);
    await page.locator('aside button').filter({ hasText: 'السيرة الذاتية' }).first().click();
    await pause(page, 2800);
    await page.screenshot({ path: path.join(raw, 'cv-start.png') });
  });
} finally { await browser.close(); }
if(records.some(r=>['study','quiz-create'].includes(r.name))) records.push(await composeStudy());
const manifestPath = path.join(root, 'assets/media-manifest.json');
let prior = [];
try { prior = JSON.parse(await fs.readFile(manifestPath, 'utf8')).records || []; } catch { /* first capture */ }
await fs.writeFile(manifestPath, JSON.stringify({ captured_at: new Date().toISOString(), source: base, design: 'current React source', data_mode: 'fictional demo student; local team, coach, evidence and study fixtures; cached opportunity listings',
  records: [...prior.filter(r => !records.some(n => n.name === r.name)), ...records.filter((r,i)=>!records.slice(i+1).some(n=>n.name===r.name))] }, null, 2));
