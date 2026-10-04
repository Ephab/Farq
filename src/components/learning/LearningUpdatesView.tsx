import { useCallback, useEffect, useState } from "react"
import { ExternalLink, RefreshCw, Rss } from "lucide-react"
import { api, getCurrentStudentId } from "@/lib/waypoint-api"
import { useI18n, type MessageKey } from "@/lib/i18n/context"

type Platform = "reddit" | "x"
interface Topic { id: string; label: string; related_nodes: string[] }
interface TopicData { topics: Topic[]; suggested: string[]; subscriptions: string[]; roadmap_covered: boolean }
interface Update { id: string; platform: Platform; url: string; title: string; excerpt: string; source: string; published_at: string; fetched_at: string; topics: string[]; related_nodes: string[] }
interface SourceStatus { topic_id: string; platform: Platform; state: string; last_successful_at: string | null; error: string | null }
interface Feed { updates: Update[]; status: { sources: SourceStatus[]; enabled_platforms: Platform[]; configured: Record<Platform, boolean> } }

const button = "rounded-lg border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"

export function LearningUpdatesView({ onAskHermes }: { onAskHermes: (draft: string) => void }) {
  const { t, locale } = useI18n()
  const base = `/api/students/${encodeURIComponent(getCurrentStudentId())}/learning-updates`
  const [topics, setTopics] = useState<TopicData | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [data, setData] = useState<Feed | null>(null)
  const [platform, setPlatform] = useState<Platform | "">("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  const load = useCallback(async () => {
    setData(await api<Feed>(base + (platform ? `?platform=${platform}` : "")))
  }, [base, platform])
  useEffect(() => {
    let stopped = false
    api<TopicData>(`${base}/topics`).then(next => {
      if (stopped) return
      setTopics(next)
      setSelected(next.subscriptions.length ? next.subscriptions : next.suggested)
    }).catch(reason => { if (!stopped) setError(String(reason.message ?? reason)) })
    return () => { stopped = true }
  }, [base])
  useEffect(() => { void load().catch(reason => setError(String(reason.message ?? reason))) }, [load])
  const running = data?.status.sources.some(source => source.state === "running") ?? false
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => { void load().catch(reason => setError(String(reason.message ?? reason))) }, 15000)
    return () => window.clearInterval(timer)
  }, [running, load])
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("")
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const topicName = (id: string) => t(`learning.topics.${id}` as MessageKey)
  const date = (value: string) => new Date(value).toLocaleString(locale)
  return <section className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="flex items-center gap-2 text-2xl font-semibold"><Rss className="size-6" />{t("learning.title")}</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">{t("learning.intro")}</p></div>
      <button className={button} disabled={busy || running || !topics?.subscriptions.length} onClick={() => void perform(async () => {
        const result = await api<{ sources: { state: string }[] }>(`${base}/refresh`, { method: "POST" })
        if (result.sources.some(source => source.state === "cooldown")) setNotice(t("learning.cooldown"))
        await load()
      })}><RefreshCw className={`me-2 inline size-4 ${running ? "animate-spin" : ""}`} />{t("learning.refresh")}</button>
    </header>
    {error && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    {!topics || !data ? <p role="status">{t("learning.loading")}</p> : <>
      <div className="space-y-3 rounded-xl border bg-card p-5">
        <h2 className="font-medium">{t("learning.choose")}</h2>
        <p className="text-sm text-muted-foreground">{t("learning.confirmHelp")}</p>
        {!topics.roadmap_covered && <p className="text-sm text-muted-foreground">{t("learning.coverage")}</p>}
        <div className="flex flex-wrap gap-3">{topics.topics.map(topic => <label key={topic.id} className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <input type="checkbox" checked={selected.includes(topic.id)} disabled={busy || (!selected.includes(topic.id) && selected.length >= 5)} onChange={event => setSelected(old => event.target.checked ? [...old, topic.id] : old.filter(id => id !== topic.id))} />
          {topicName(topic.id)}{topics.suggested.includes(topic.id) && <span className="text-xs text-muted-foreground">{t("learning.suggested")}</span>}
        </label>)}</div>
        <button className={button} disabled={busy} onClick={() => void perform(async () => {
          const next = await api<TopicData>(`${base}/subscriptions`, { method: "PUT", body: JSON.stringify({ topics: selected }) })
          setTopics(next); setSelected(next.subscriptions); setNotice(t("learning.saved")); await load()
        })}>{t("learning.confirm")}</button>
      </div>
      <div className="flex flex-wrap gap-2" aria-label={t("learning.platforms")}>{(["", ...data.status.enabled_platforms] as const).map(value => <button key={value} className={`${button} ${platform === value ? "bg-muted font-medium" : ""}`} aria-pressed={platform === value} onClick={() => setPlatform(value)}>{value === "" ? t("learning.all") : value === "x" ? "X" : "Reddit"}</button>)}</div>
      {!data.status.enabled_platforms.length && <p className="text-sm text-muted-foreground">{t("learning.disabled")}</p>}
      <div className="flex flex-wrap gap-3" aria-live="polite">{data.status.sources.map(source => <div key={`${source.topic_id}:${source.platform}`} className="rounded-lg border px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium">{topicName(source.topic_id)} · {source.platform === "x" ? "X" : "Reddit"}</span>: {t(`learning.states.${source.state}` as MessageKey)}
        {source.last_successful_at && <span className="mt-1 block">{t("learning.lastSuccess", { date: date(source.last_successful_at) })}</span>}
      </div>)}</div>
      {data.status.enabled_platforms.some(p => !data.status.configured[p]) && <p className="text-sm text-muted-foreground">{t("learning.notConfigured")}</p>}
      {!topics.subscriptions.length ? <p className="text-sm text-muted-foreground">{t("learning.noTopics")}</p> : !data.updates.length ? <p className="rounded-xl border p-6 text-sm text-muted-foreground">{t("learning.empty")}</p> : <div className="grid gap-4 md:grid-cols-2">{data.updates.map(item => <article key={item.id} className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <p className="text-xs text-muted-foreground">{item.platform === "x" ? t("learning.announcement") : t("learning.report")} · {item.platform === "x" ? `@${item.source}` : `r/${item.source}`}</p>
        <h2 className="font-semibold"><a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{item.title}<ExternalLink className="ms-2 inline size-3" /></a></h2>
        <p className="text-xs text-muted-foreground">{t("learning.published", { date: date(item.published_at) })}<br />{t("learning.fetched", { date: date(item.fetched_at) })}</p>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.excerpt}</p>
        <p className="text-xs text-muted-foreground">{item.topics.map(topicName).join(" · ")}{item.related_nodes.length > 0 && ` — ${item.related_nodes.join(", ")}`}</p>
        <div className="mt-auto flex gap-2"><button className={button} disabled={busy} onClick={() => void perform(async () => { await api(`${base}/${encodeURIComponent(item.id)}/dismiss`, { method: "POST" }); await load() })}>{t("learning.dismiss")}</button>
          <button className={button} onClick={() => onAskHermes(t("learning.askPrompt", { id: item.id }))}>{t("learning.ask")}</button></div>
      </article>)}</div>}
    </>}
  </section>
}
