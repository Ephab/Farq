// Run with Vite available: node scripts/check-coach-scroll.mjs [url]
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
try {
  for (const [mode, width, height] of [['chat', 1280, 720], ['done', 1280, 720], ['chat', 390, 640]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
    await context.addInitScript(() => {
      localStorage.setItem('waypoint.current-student', 'fixture')
      sessionStorage.setItem('waypoint.active-view', 'Hermes Coach')
    })
    await context.route(/\/(api|v1)\//, async route => {
      const path = new URL(route.request().url()).pathname
      let body = {}
      if (path.endsWith('/profile')) body = { student_id: 'fixture', display_name: 'Student', discipline: 'cs', program: 'CS', onboarding_status: mode, thread_id: 't' }
      else if (path.endsWith('/messages')) body = Array.from({ length: 30 }, (_, i) => ({ id: String(i), role: i % 2 ? 'assistant' : 'user', content: `Message ${i} ` + 'History text. '.repeat(40), created_at: '2026-10-05T08:00:00Z' }))
      else if (path.endsWith('/runs/latest')) body = { run: null }
      else if (path.endsWith('/context')) body = { facts: [], student: { display_name: 'Student' } }
      else if (path.endsWith('/roadmap')) body = { snapshot: { title: 'Roadmap', nodes: [] } }
      else if (path.endsWith('/health')) body = { ok: true, agent: 'Hermes' }
      else if (path.endsWith('/settings/models')) body = { can_edit: false, selected: { provider: 'gemini', model: 'fixture' }, providers: [{ id: 'gemini', label: 'Gemini', models: [{ id: 'fixture', label: 'Fixture' }] }] }
      else if (path.endsWith('/opportunities/summary')) body = { unseen_count: 0, status: 'unavailable', stale: true }
      else if (/threads$|proposals$|sources$|evidence$|disciplines$|suggestions$/.test(path)) body = []
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(process.argv[2] || 'http://127.0.0.1:5173')
    const list = page.locator('.chat-messages:visible')
    try { await list.waitFor({ timeout: 10000 }) } catch (error) {
      console.log('Page errors:', errors, 'Page text:', await page.locator('body').innerText())
      throw error
    }
    await page.waitForFunction(() => {
      const e = document.querySelector('.chat-messages')
      return e && e.scrollHeight > e.clientHeight && e.scrollHeight - e.scrollTop - e.clientHeight < 3
    })
    const box = await list.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, -500)
    await page.waitForTimeout(300)
    assert(await list.evaluate(e => e.scrollHeight - e.scrollTop - e.clientHeight > 100), 'wheel over messages scrolls history')
    const before = await list.evaluate(e => e.scrollTop)
    // Emulate streamed text/card growth without replacing the React message list.
    await list.evaluate(e => { const d = document.createElement('div'); d.style.height = '300px'; e.firstElementChild.append(d) })
    await page.waitForTimeout(150)
    assert(Math.abs(await list.evaluate(e => e.scrollTop) - before) < 3, 'reading history stays put')
    await list.evaluate(e => { e.scrollTop = e.scrollHeight })
    await page.waitForTimeout(100)
    await list.evaluate(e => { const d = document.createElement('div'); d.style.height = '500px'; e.firstElementChild.append(d) })
    await page.waitForTimeout(150)
    assert(await list.evaluate(e => e.scrollHeight - e.scrollTop - e.clientHeight < 3), 'content growth follows bottom')
    assert.deepEqual(errors, [])
    console.log(`${mode} ${width}x${height}: initial pin, wheel, history and growth passed`)
    await context.close()
  }
} finally { await browser.close() }
