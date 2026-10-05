// Start Vite, then: node scripts/check-sidebar-navigation.mjs [http://127.0.0.1:5173]
// All API responses are fixtures. Normal motion is essential to this regression.
import assert from "node:assert/strict"
import { chromium } from "playwright"

const browser = await chromium.launch({ headless: true })
try {
  for (const [locale, height] of [["en", 720], ["en", 900], ["ar", 600]]) {
    const context = await browser.newContext({ viewport: { width: 1280, height }, reducedMotion: "no-preference" })
    await context.addInitScript(locale => {
      localStorage.setItem("waypoint.current-student", "demo-student")
      localStorage.setItem("waypoint-locale", locale)
      sessionStorage.setItem("waypoint.active-view", "Slides")
    }, locale)
    await context.route(/\/(api|v1)\//, async route => {
      const path = new URL(route.request().url()).pathname
      let body = {}
      if (path.endsWith("/profile")) body = { student_id: "demo-student", display_name: "Demo Student", discipline: "cs", program: "CS", onboarding_status: "done", thread_id: null }
      else if (path.endsWith("/threads") || path.endsWith("/roadmap/proposals") || path.endsWith("/sources") || path.endsWith("/evidence")) body = []
      else if (path.endsWith("/context")) body = { facts: [], student: { display_name: "Demo Student" } }
      else if (path.endsWith("/roadmap")) body = { snapshot: { title: "Demo roadmap", nodes: [] } }
      else if (path.endsWith("/health")) body = { ok: true, hermes: { status: "ready" } }
      else if (path.endsWith("/opportunities/summary")) body = { unseen_count: 0, status: "unavailable", stale: true }
      else if (path.endsWith("/blackboard/slides")) body = { files: [] }
      else if (path.endsWith("/settings/models")) body = { can_edit: false, selected: { provider: "gemini", model: "fixture" }, providers: [] }
      else if (path.endsWith("/disciplines")) body = [{ id: "cs", label: "Computer Science", coming_soon: [], sources: ["github", "cv_pdf", "transcript_pdf", "linkedin_zip", "portfolio_url", "folder", "orcid"] }]
      else if (path.endsWith("/outlook/status")) body = { configured: false, connected: false, classifiers: [] }
      else if (path.endsWith("/blackboard/sync")) body = { connected: false, status: "idle", summary: {} }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) })
    })
    const page = await context.newPage()
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    await page.goto(process.argv[2] || "http://127.0.0.1:5173")
    const content = page.locator('[data-slot="sidebar-content"]')
    await content.waitFor()
    await page.waitForTimeout(1800)
    const names = locale === "en" ? { slides: "Slides", data: "My data" } : { slides: "العروض التقديمية", data: "بياناتي" }
    const metrics = () => content.evaluate(container => {
      const panel = container.parentElement.getBoundingClientRect()
      const pill = container.querySelector(':scope > [aria-hidden="true"]')
      const active = container.querySelector('[aria-current="page"]')
      return {
        panelTop: panel.top, panelHeight: panel.height,
        scrollHeight: container.scrollHeight, scrollTop: container.scrollTop, clientHeight: container.clientHeight,
        transforms: [...container.querySelectorAll('[data-slot="sidebar-menu-item"]')].map(node => getComputedStyle(node).transform),
        pillTop: pill?.getBoundingClientRect().top, activeTop: active?.getBoundingClientRect().top,
      }
    })
    const initial = await metrics()
    // Let the tall page scroll first, then navigate. Layout projection used to
    // interpret the document/rail scroll delta as movement of every menu row.
    for (let cycle = 0; cycle < 2; cycle++) {
      for (const name of [names.data, names.slides]) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await page.waitForTimeout(150)
        await content.getByRole("button", { name, exact: true }).click()
        for (let frame = 0; frame < 12; frame++) {
          await page.waitForTimeout(50)
          const state = await metrics()
          assert.ok(Math.abs(state.panelTop) < 1, `Sidebar moved: ${JSON.stringify(state)}`)
          assert.equal(state.panelHeight, height)
          assert.ok(state.transforms.every(value => value === "none"), `Menu rows jumped: ${JSON.stringify(state)}`)
          assert.ok(state.scrollHeight <= initial.scrollHeight + 1, `Phantom scroll space: ${JSON.stringify(state)}`)
        }
        await page.waitForTimeout(800)
        const settled = await metrics()
        assert.ok(Math.abs(settled.pillTop - settled.activeTop) < 1, `Highlight lost active row: ${JSON.stringify(settled)}`)
        if (name === names.data) {
          const tail = await page.evaluate(() => {
            const records = document.querySelector(".wp-view > div > div")
            return { documentHeight: document.documentElement.scrollHeight, contentBottom: records.getBoundingClientRect().bottom + scrollY }
          })
          assert.ok(tail.documentHeight <= Math.max(height, tail.contentBottom) + 1, `Blank space below My data: ${JSON.stringify(tail)}`)
        }
      }
    }
    // Real wheel input must move the sidebar independently of the document.
    await content.evaluate(node => { node.scrollTop = 0 })
    const box = await content.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    const documentY = await page.evaluate(() => scrollY)
    await page.mouse.wheel(0, 400)
    await page.waitForTimeout(300)
    if (initial.scrollHeight > initial.clientHeight) assert.ok((await metrics()).scrollTop > 0, "Sidebar wheel scrolling stopped")
    assert.equal(await page.evaluate(() => scrollY), documentY, "Sidebar wheel scrolled the document")
    await page.locator('[data-slot="sidebar-trigger"]').click()
    await page.waitForTimeout(1000)
    await content.getByRole("button", { name: names.data, exact: true }).click()
    await page.waitForTimeout(1000)
    const collapsed = await metrics()
    assert.ok(Math.abs(collapsed.pillTop - collapsed.activeTop) < 1)
    assert.ok(Math.abs(collapsed.panelTop) < 1)
    assert.deepEqual(errors, [])
    console.log(`Sidebar navigation, highlight and scrolling passed: ${locale}, ${height}px`)
    await context.close()
  }
} finally {
  await browser.close()
}
