import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const [planFile, resultFile] = process.argv.slice(2);
const plan = JSON.parse(await fs.readFile(planFile, 'utf8'));
const origin = new URL(plan.origin);
if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:' || ['8000','8642','5173'].includes(origin.port)) throw Error('Only the evaluator app origin is allowed');
const target = new URL(plan.path, origin);
if (target.origin !== origin.origin) throw Error('Cross-origin navigation is forbidden');
const result = { screens: [], screenshots: [], blocked_requests: [], errors: [] };
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const [name, viewport] of [['desktop', {width:1365,height:900}], ['mobile', {width:390,height:844}]]) {
    const context = await browser.newContext({ viewport, serviceWorkers:'block', acceptDownloads:false });
    const errors = [], responses = [], assertions = [];
    await context.route('**/*', async route => {
      if (new URL(route.request().url()).origin !== origin.origin) {
        result.blocked_requests.push(route.request().url().slice(0,300));
        await route.abort();
      } else await route.continue();
    });
    await context.routeWebSocket('**/*', ws => {
      if (new URL(ws.url()).host === origin.host) ws.connectToServer();
      else ws.close();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(String(error).slice(0,1000)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text().slice(0,1000)); });
    page.on('response', response => responses.push({url:response.url().slice(0,300),status:response.status()}));
    page.on('dialog', dialog => dialog.dismiss());
    let failure = null;
    try {
      const response = await page.goto(target.href, {waitUntil:'domcontentloaded',timeout:15000});
      if (response && response.status() >= 400) throw Error(`Page returned HTTP ${response.status()}`);
      for (const step of plan.steps.slice(0,15)) {
        if (step.kind === 'click' && typeof step.selector === 'string') await page.locator(step.selector).first().click();
        else if (step.kind === 'fill' && typeof step.selector === 'string' && typeof step.value === 'string') await page.locator(step.selector).first().fill(step.value);
        else if (step.kind === 'press' && typeof step.selector === 'string' && typeof step.key === 'string') await page.locator(step.selector).first().press(step.key);
        else if (step.kind === 'assert_text' && typeof step.text === 'string') {
          await page.getByText(step.text,{exact:false}).first().waitFor({state:'visible'});
          assertions.push(`Visible: ${step.text}`);
        } else throw Error('Invalid browser step');
      }
    } catch (error) { failure = String(error).slice(0,2000); result.errors.push(failure); }
    const text = await page.locator('body').innerText().catch(()=>'');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2).catch(()=>false);
    if (overflow) errors.push('Horizontal overflow at '+viewport.width+'px');
    const screenshot = await page.screenshot({type:'png',fullPage:false,timeout:10000}).catch(()=>null);
    if (screenshot && screenshot.length <= 2000000) result.screenshots.push({title:`${plan.title} - ${name}`,png_base64:screenshot.toString('base64')});
    result.screens.push({viewport:name,url:page.url(),text:text.slice(0,10000),assertions,errors:errors.slice(0,20),responses:responses.slice(-40),failure});
    await context.close();
  }
} catch (error) { result.errors.push(String(error).slice(0,2000)); }
finally { if (browser) await browser.close(); }
await fs.writeFile(resultFile, JSON.stringify(result));
if (result.errors.length || result.screens.some(screen => screen.errors.length)) process.exitCode=1;
console.log(JSON.stringify({screens:result.screens.length,screenshots:result.screenshots.length,errors:result.errors}));
