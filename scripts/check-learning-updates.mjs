// Browser smoke test with synthetic public posts and mocked API; never runs Apify.
// Start Vite, then: node scripts/check-learning-updates.mjs [http://127.0.0.1:5179]
import assert from "node:assert/strict"
import { chromium } from "playwright"

const browser = await chromium.launch({ headless: true })
try {
  for (const locale of ["en", "ar"]) {
    const context = await browser.newContext({ viewport: { width: locale === "en" ? 1280 : 390, height: 900 }, reducedMotion: "reduce" })
    await context.addInitScript(({ locale }) => {
      localStorage.setItem("waypoint.current-student", "smoke-student")
      localStorage.setItem("waypoint-locale", locale)
      sessionStorage.setItem("waypoint.active-view", "Learning updates")
    }, { locale })
    let followed = []
    let dismissed = false
    const page = await context.newPage()
    const errors = []
    page.on("pageerror", error => { errors.push(error.message); console.log("PAGE ERROR", error.message) })
    await page.route("**/api/**", async route => {
      const req = route.request()
      const url = new URL(req.url())
      const path = url.pathname
      let body = {}
      const topicData = { topics: [{ id: "ai", label: "AI", related_nodes: ["PyTorch"] }], suggested: ["ai"], subscriptions: followed, roadmap_covered: true }
      const status = { sources: followed.map(topic_id => ({ topic_id, platform: "reddit", state: "not_configured", last_successful_at: null, error: null })), enabled_platforms: ["reddit", "x"], configured: { reddit: false, x: false } }
      if (path.endsWith("/profile")) body = { student_id: "smoke-student", display_name: "Smoke student", onboarding_status: "done", thread_id: "smoke-thread", discipline: "computing", program: "CS" }
      else if (path.endsWith("/context")) body = { facts: [] }
      else if (path.endsWith("/roadmap/proposals")) body = []
      else if (path.endsWith("/roadmap")) body = { snapshot: { title: "Smoke roadmap", nodes: [], stages: [] } }
      else if (path.endsWith("/summary")) body = { unread_count: 0, recent: [], count: 0 }
      else if (path.endsWith("/teams-home")) body = { teams: [] }
      else if (path.endsWith("/topics")) body = topicData
      else if (path.endsWith("/subscriptions")) { followed = req.postDataJSON().topics; body = { ...topicData, subscriptions: followed } }
      else if (path.endsWith("/dismiss")) { dismissed = true; body = { dismissed: true } }
      else if (path.endsWith("/learning-updates")) body = { status, updates: followed.length && !dismissed && url.searchParams.get("platform") !== "x" ? [{ id: "post1", platform: "reddit", source: "MachineLearning", url: "https://www.reddit.com/r/MachineLearning/comments/abc123/", title: "PyTorch release fixture", excerpt: "<script>window.injected = true</script> Public report.", published_at: "2026-10-03T12:00:00Z", fetched_at: "2026-10-04T12:00:00Z", topics: ["ai"], related_nodes: ["PyTorch"] }] : [] }
      else if (path.endsWith("/status")) body = status
      else if (path.endsWith("/messages")) body = []
      else if (path.endsWith("/runs/latest")) body = { run: null }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) })
    })
    await page.goto(process.argv[2] || "http://127.0.0.1:5179")
    const confirm = locale === "en" ? "Confirm topics" : "تأكيد المواضيع"
    await page.getByRole("button", { name: confirm, exact: true }).click({ timeout: 10000 })
    await page.getByRole("heading", { name: "PyTorch release fixture" }).waitFor()
    assert.equal(await page.evaluate(() => window.injected), undefined)
    const card = page.locator("article").filter({ hasText: "PyTorch release fixture" })
    assert.match(await card.innerText(), /<script>/)
    assert.match(await card.innerText(), /PyTorch/)
    await page.getByRole("button", { name: "X", exact: true }).click()
    await page.getByRole("heading", { name: "PyTorch release fixture" }).waitFor({ state: "hidden" })
    await page.getByRole("button", { name: "Reddit", exact: true }).click()
    await page.getByRole("heading", { name: "PyTorch release fixture" }).waitFor()
    await page.getByRole("button", { name: locale === "en" ? "Dismiss" : "إخفاء", exact: true }).click()
    await page.getByRole("heading", { name: "PyTorch release fixture" }).waitFor({ state: "hidden" })
    assert.equal(dismissed, true)
    dismissed = false
    await page.reload()
    await page.getByRole("heading", { name: "PyTorch release fixture" }).waitFor()
    await page.getByRole("button", { name: locale === "en" ? "Ask Hermes" : "اسأل Hermes", exact: true }).click()
    await page.locator("textarea").waitFor()
    const draft = await page.locator("textarea").inputValue()
    assert.match(draft, /post1/)
    assert.match(draft, /waypoint_get_learning_update/)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.deepEqual(errors, [])
    console.log(`Learning updates browser smoke passed: ${locale}`)
    await context.close()
  }
} finally { await browser.close() }
