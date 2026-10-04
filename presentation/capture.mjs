// Captures stills + clips of the running app for the pitch. Read-only browsing.
import { chromium } from 'playwright';
import fs from 'node:fs';
const OUT = (process.env.OUT || new URL('./raw/', import.meta.url).pathname);
const L = '2dcd6ddc-e478-441e-9ba2-7bd9b1972bc4', DEMO = 'demo-student';
const only = process.argv.slice(2);
const b = await chromium.launch();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function scene(name, student, fn) {
  if (only.length && !only.includes(name)) return;
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2,
    recordVideo: { dir: OUT + name, size: { width: 1440, height: 900 } } });
  await ctx.addInitScript(([s]) => { localStorage.setItem('waypoint.current-student', s); localStorage.setItem('waypoint-locale', 'ar'); }, [student]);
  const p = await ctx.newPage();
  const t0 = Date.now();
  await p.goto('http://localhost:5173/'); await sleep(1500); await p.keyboard.press('Escape'); await sleep(2000);
  const marks = {};
  const mark = (k) => marks[k] = (Date.now() - t0) / 1000;
  try { await fn(p, mark); } catch (e) { console.log(name, 'ERR', e.message); }
  const v = p.video(); await ctx.close();
  fs.renameSync(await v.path(), `${OUT}${name}.webm`);
  fs.writeFileSync(`${OUT}${name}.json`, JSON.stringify(marks));
  console.log(name, marks);
}
const nav = async (p, label) => { await p.locator('aside button').filter({ hasText: label }).first().click(); await sleep(2500); };
const shot = (p, n) => p.screenshot({ path: `${OUT}${n}.png` });
const wheel = async (p, dy, steps, x = 900, y = 500) => { await p.mouse.move(x, y); for (let i = 0; i < steps; i++) { await p.mouse.wheel(0, dy); await sleep(60); } };

await scene('home', L, async (p, mark) => { mark('start'); await sleep(1500); await shot(p, 'home'); mark('end'); });
await scene('roadmap', L, async (p, mark) => {
  await nav(p, 'خريطة التعلّم'); await sleep(1500); mark('start'); await shot(p, 'roadmap');
  await sleep(800); await wheel(p, 18, 40); await sleep(600); await wheel(p, -18, 40); await sleep(500);
  await p.locator('button').filter({ hasText: 'Tensor fundamentals' }).first().click(); await sleep(2500);
  await shot(p, 'roadmap-node'); await sleep(1500); mark('end');
});
await scene('coach', L, async (p, mark) => {
  await nav(p, 'مدرّب Hermes'); await sleep(1500); await wheel(p, -400, 10); await sleep(800); mark('start');
  await shot(p, 'coach-top'); await wheel(p, 15, 70); await sleep(1500); await shot(p, 'coach'); mark('end');
});
await scene('projects', L, async (p, mark) => { await nav(p, 'المشاريع'); mark('start'); await sleep(1000); await shot(p, 'projects'); mark('end'); });
await scene('coop', L, async (p, mark) => {
  await nav(p, 'التدريب التعاوني'); await sleep(1500); mark('start'); await shot(p, 'coop');
  await wheel(p, 15, 60); await sleep(1500); await shot(p, 'coop-cards'); mark('end');
});
await scene('cv', L, async (p, mark) => { await nav(p, 'السيرة الذاتية'); await sleep(4000); mark('start'); await shot(p, 'cv'); await sleep(500); mark('end'); });
await scene('slides', L, async (p, mark) => { await nav(p, 'العروض التقديمية'); await sleep(2000); mark('start'); await shot(p, 'slides'); mark('end'); });
await scene('mydata', L, async (p, mark) => {
  await nav(p, 'بياناتي'); mark('start'); await shot(p, 'mydata');
  await p.locator('button').filter({ hasText: 'مراجعة الاقتراحات' }).first().click(); await sleep(2500); await shot(p, 'review'); mark('end');
});
await scene('team', DEMO, async (p, mark) => {
  await nav(p, 'المشاريع الجماعية'); await sleep(1500); mark('start'); await shot(p, 'teams');
  await p.getByText('Group 1', { exact: true }).first().click(); await sleep(3500); await shot(p, 'team');
  await wheel(p, 15, 50); await sleep(1500); await shot(p, 'team-2'); mark('end');
});
await b.close();
