"use client"

/**
 * Personalized co-op Matches tab (Phase B). In production it calls the real per-student API
 * (/coop/matches, /coop/sources, /coop/refresh, /coop/postings/:id/status, /coop/postings/:id/
 * propose-gaps); with `?mock=coop&persona=cs|medicine` in dev it instead renders the fixtures in
 * ./fixtures.ts (see readMockCoopParams) so the design can be reviewed without live data.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Bookmark, BriefcaseBusiness, Building2, Check, CheckCircle2, ChevronDown, FileText, MapPin, RefreshCw, Sparkles, X } from "lucide-react"
import { ApiError, api } from "@/lib/waypoint-api"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n/context"
import { useModalFocus } from "@/lib/use-modal-focus"
import { COOP_PERSONA_FIXTURES, type CoopEligibilityItem, type CoopGap, type CoopMatch, type CoopPersona, type CoopSourceStatus } from "./fixtures"
import type { MessageKey } from "@/lib/i18n/context"

const KNOWN_DISCIPLINES = new Set(["cs", "engineering", "medicine", "law", "business", "sciences", "design"])
function disciplineKey(discipline: string): MessageKey {
  return `dashboard.coop.preview.discipline.${KNOWN_DISCIPLINES.has(discipline) ? discipline : "generic"}` as MessageKey
}

// Reuses the existing live-sources vocabulary (dashboard.coop.live.source.*) so the source
// name is translated the same way everywhere in the co-op view.
function sourceLabelKey(source: CoopSourceStatus["key"]): MessageKey {
  return `dashboard.coop.live.source.${source}` as MessageKey
}

// --- Real-mode API wiring (Phase B) ---------------------------------------------------------

interface ApiCoopGap {
  id: string; skill: string; why: string; importance: "high" | "medium" | "low"
  evidence_needed: string
  suggestion: { title: string; description: string; duration: string; kind: string }
}
interface ApiCoopMatch {
  id: string; company_id: string; company_name: string; title: string; location: string
  source: string; published_at: string | null; first_seen_at: string; closes_at: string | null
  detail_url: string; fit_score: number; fit_tier_code: "strong" | "good" | "explore"
  reasons: string[]; skills: string[]; state: "neutral" | "saved" | "dismissed"
  relevant: boolean; hidden_reason: string | null; matched_skills: string[]
  coop_gaps: ApiCoopGap[]; eligibility: { type: string; detail: string }[]; target_disciplines: string[]
}
interface ApiMatchesResponse { visible: ApiCoopMatch[]; hidden: ApiCoopMatch[]; demo: boolean; generated_at: string }
interface ApiSourceRow { key: string; status: CoopSourceStatus["status"]; hint: string | null; last_run_at: string | null; fetched: number; error: string | null }
interface ApiSourcesResponse { sources: ApiSourceRow[]; refresh: { status: "idle" | "running" | "done" } }

function apiSourceKey(key: string): CoopSourceStatus["key"] {
  return key === "feeds" || key === "official" || key === "telegram" || key === "linkedin" ? key : "feeds"
}

function postingSourceKey(source: string): CoopSourceStatus["key"] {
  if (source.startsWith("official")) return source === "official_feed" ? "feeds" : "official"
  if (source === "linkedin" || source === "telegram") return source
  return "feeds"
}

function gapFromApi(gap: ApiCoopGap): CoopGap {
  const kind = gap.suggestion.kind
  return {
    id: gap.id, skill: gap.skill, why: gap.why, importance: gap.importance, evidenceNeeded: gap.evidence_needed,
    suggestion: {
      title: gap.suggestion.title, description: gap.suggestion.description, duration: gap.suggestion.duration,
      kind: kind === "project" || kind === "certificate" || kind === "practice" ? kind : "course",
    },
  }
}

const ELIGIBILITY_TYPES: readonly CoopEligibilityItem["type"][] = ["gpa", "nationality", "language_test", "university_letter", "enrollment", "dates"]
function eligibilityTypeFromApi(value: string): CoopEligibilityItem["type"] {
  return (ELIGIBILITY_TYPES as readonly string[]).includes(value) ? (value as CoopEligibilityItem["type"]) : "other"
}

function matchFromApi(item: ApiCoopMatch): CoopMatch {
  return {
    id: item.id, title: item.title, company: item.company_name, location: item.location,
    source: postingSourceKey(item.source), sourceLabel: "", postedAt: item.published_at || item.first_seen_at,
    deadline: item.closes_at, detailUrl: item.detail_url, fitScore: item.fit_score, fitTier: item.fit_tier_code,
    reason: { text: item.reasons[0] || "", targetDiscipline: item.target_disciplines[0] || "other" },
    hiddenReason: item.hidden_reason ?? undefined, skills: item.skills, matched: item.matched_skills,
    gaps: item.coop_gaps.map(gapFromApi), state: item.state,
    eligibility: item.eligibility.map((entry) => ({ type: eligibilityTypeFromApi(entry.type), detail: entry.detail })),
  }
}

function sourcesFromApi(response: ApiSourcesResponse): CoopSourceStatus[] {
  return response.sources.map((row) => ({
    key: apiSourceKey(row.key), label: "", status: row.status, lastSyncedAt: row.last_run_at, count: row.fetched, error: row.error,
  }))
}

/** Real per-student co-op data: fetch, cache in state, and the write actions the UI needs. */
function useRealCoopData(studentId: string) {
  const { t } = useI18n()
  const [visible, setVisible] = useState<CoopMatch[]>([])
  const [hidden, setHidden] = useState<CoopMatch[]>([])
  const [sources, setSources] = useState<CoopSourceStatus[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  // Jev scores postings in a background pass; while any are still unscored, refetch quietly.
  const [pendingScores, setPendingScores] = useState(false)
  const loadMatches = useCallback(async () => {
    if (!studentId) { setLoading(false); return }
    try {
      const data = await api<ApiMatchesResponse>(`/api/students/${studentId}/coop/matches`)
      // The API sends "" when a post never names its employer.
      const named = (match: CoopMatch) => (match.company ? match : { ...match, company: t("dashboard.coop.preview.unnamedEmployer") })
      setVisible(data.visible.map(matchFromApi).map(named))
      setHidden(data.hidden.map(matchFromApi).map(named))
      setPendingScores([...data.visible, ...data.hidden].some((item) => (item as { engine?: string }).engine === "unscored"))
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("dashboard.coop.loadError"))
    } finally {
      setLoading(false)
    }
  }, [studentId, t])

  const loadSources = useCallback(async () => {
    if (!studentId) return
    try {
      setSources(sourcesFromApi(await api<ApiSourcesResponse>(`/api/students/${studentId}/coop/sources`)))
    } catch {
      // Status is advisory; cached matches stay usable without it.
    }
  }, [studentId])

  useEffect(() => { void loadMatches() }, [loadMatches])
  useEffect(() => { void loadSources() }, [loadSources])
  useEffect(() => {
    if (!pendingScores) return
    const timer = window.setTimeout(() => { void loadMatches() }, 8000)
    return () => window.clearTimeout(timer)
  }, [pendingScores, visible, loadMatches])

  const setStatus = useCallback(async (postingId: string, status: "saved" | "dismissed" | "neutral") => {
    await api(`/api/students/${studentId}/coop/postings/${encodeURIComponent(postingId)}/status`, { method: "POST", body: JSON.stringify({ status }) })
    await loadMatches()
  }, [studentId, loadMatches])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setRefreshError(null)
    try {
      await api(`/api/students/${studentId}/coop/refresh`, { method: "POST" })
      await Promise.all([loadMatches(), loadSources()])
    } catch (reason) {
      setRefreshError(reason instanceof ApiError && reason.status === 429 ? t("dashboard.coop.live.refreshWait") : reason instanceof Error ? reason.message : t("dashboard.coop.live.refreshError"))
    } finally {
      setRefreshing(false)
    }
  }, [studentId, loadMatches, loadSources, t])

  const proposeGaps = useCallback(async (postingId: string, gapIds: string[]): Promise<number> => {
    const result = await api<{ node_count: number }>(`/api/students/${studentId}/coop/postings/${encodeURIComponent(postingId)}/propose-gaps`, {
      method: "POST", body: JSON.stringify({ gap_ids: gapIds }),
    })
    return result.node_count
  }, [studentId])

  return { visible, hidden, sources, loading, error, refreshing, refreshError, refresh, setStatus, proposeGaps }
}

type ItemState = "neutral" | "saved" | "dismissed"
type ViewTab = "matches" | "companies"

function fitTone(tier: CoopMatch["fitTier"]): string {
  if (tier === "strong") return "bg-emerald-500"
  if (tier === "good") return "bg-primary"
  return "bg-amber-500"
}

function sourceDotTone(status: CoopSourceStatus["status"]): string {
  if (status === "ok") return "bg-emerald-500"
  if (status === "partial" || status === "running") return "bg-amber-500"
  if (status === "failed") return "bg-red-500"
  return "bg-muted-foreground/40"
}

function importanceTone(importance: CoopGap["importance"]): string {
  if (importance === "high") return "bg-red-500/10 text-red-700 dark:text-red-300"
  if (importance === "medium") return "bg-amber-500/10 text-amber-700 dark:text-amber-300"
  return "bg-muted text-muted-foreground"
}

function FitBar({ score, tier }: { score: number; tier: CoopMatch["fitTier"] }) {
  const { t } = useI18n()
  return (
    <div className="flex w-full items-center gap-2" aria-label={`${t("dashboard.coop.preview.fit.label")}: ${score}`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <motion.div
          className={cn("h-full rounded-full", fitTone(tier))}
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>
      <span className="text-xs font-semibold tabular-nums">{score}</span>
    </div>
  )
}

function SourceStrip({ sources, refreshing, onRefresh }: { sources: CoopSourceStatus[]; refreshing: boolean; onRefresh: () => void }) {
  const { t, fmt } = useI18n()
  return (
    <section aria-label={t("dashboard.coop.preview.sources.title")} className="mb-5 rounded-2xl border border-border p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold">{t("dashboard.coop.preview.sources.title")}</p>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-border px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} aria-hidden="true" />
          {refreshing ? t("dashboard.coop.preview.sources.refreshing") : t("dashboard.coop.preview.sources.refresh")}
        </button>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {sources.map((row) => (
          <li
            key={row.key}
            title={[row.lastSyncedAt ? t("dashboard.coop.preview.sources.lastSynced", { time: fmt.relative(row.lastSyncedAt) }) : t("dashboard.coop.preview.sources.neverSynced"), row.error ?? ""].filter(Boolean).join(" · ")}
            className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs"
          >
            <span aria-hidden="true" className={cn("size-2 rounded-full", sourceDotTone(row.status), row.status === "running" && "animate-pulse")} />
            <span className="font-medium">{t(sourceLabelKey(row.key))}</span>
            <span className="text-muted-foreground">{t("dashboard.coop.preview.sources.count", { count: row.count })}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function MatchCard({ match, state, onSave, onDismiss, onOpen }: { match: CoopMatch; state: ItemState; onSave: () => void; onDismiss: () => void; onOpen: () => void }) {
  const { t, fmt } = useI18n()
  const topGap = match.gaps?.[0]
  const stop = (handler: () => void) => (event: MouseEvent | KeyboardEvent) => {
    event.stopPropagation()
    handler()
  }
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, transition: { duration: 0.18 } }}
      transition={{ duration: 0.32, ease: "easeOut" }}
      role="button"
      tabIndex={0}
      aria-label={t("dashboard.coop.preview.gapDetail.viewDetails")}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onOpen()
        }
      }}
      className={cn(
        "relative flex min-h-64 cursor-pointer flex-col rounded-3xl border border-border bg-background p-5 outline-none transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring",
        topGap ? "pb-9" : "",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-muted">
          <BriefcaseBusiness className="size-5" aria-hidden="true" />
        </span>
        <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">{t(sourceLabelKey(match.source))}</span>
      </div>

      <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <bdi>{match.company}</bdi>
      </p>
      <h3 dir="auto" className="mt-1 text-start text-xl font-semibold">
        {match.title}
      </h3>
      <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
        <MapPin className="size-3.5" aria-hidden="true" />
        <bdi>{match.location}</bdi>
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>{t("dashboard.coop.preview.posted", { time: fmt.relative(match.postedAt) })}</span>
        <span aria-hidden="true">·</span>
        <span className={cn(match.deadline ? "font-medium text-amber-700 dark:text-amber-300" : "")}>
          {match.deadline ? t("dashboard.coop.preview.deadline", { date: fmt.date(match.deadline, { dateStyle: "medium", timeZone: "UTC" }) }) : t("dashboard.coop.preview.noDeadline")}
        </span>
      </div>

      <div className="mt-4 border-t border-border pt-4">
        <p className="text-xs font-semibold text-muted-foreground">{t("dashboard.coop.preview.fit.label")}</p>
        <div className="mt-1.5">
          <FitBar score={match.fitScore} tier={match.fitTier} />
        </div>
        <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
          <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <bdi>{match.reason.text}</bdi>
        </p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t("dashboard.coop.preview.fit.targets", { discipline: t(disciplineKey(match.reason.targetDiscipline)) })}
        </p>
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 pt-5">
        <div className="flex flex-wrap gap-1.5">
          {match.skills.slice(0, 2).map((skill) => (
            <span key={skill} className="rounded-full bg-muted px-2.5 py-1 text-[11px]">
              <bdi>{skill}</bdi>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={stop(onDismiss)}
            aria-pressed={state === "dismissed"}
            title={state === "dismissed" ? t("dashboard.coop.preview.actions.dismissed") : t("dashboard.coop.preview.actions.dismiss")}
            className={cn("grid size-9 place-items-center rounded-full border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring", state === "dismissed" && "bg-muted")}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={stop(onSave)}
            aria-pressed={state === "saved"}
            title={state === "saved" ? t("dashboard.coop.preview.actions.saved") : t("dashboard.coop.preview.actions.save")}
            className={cn("grid size-9 place-items-center rounded-full border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring", state === "saved" && "bg-primary text-primary-foreground")}
          >
            <Bookmark className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {topGap ? (
        <span className="absolute -bottom-2.5 start-4 z-10 rounded-md bg-foreground px-2 py-1 text-[11px] font-semibold text-background shadow-sm">
          <bdi>{topGap.skill}</bdi>
        </span>
      ) : null}
    </motion.article>
  )
}

const ELIGIBILITY_TYPE_KEYS = new Set(["gpa", "nationality", "language_test", "university_letter", "enrollment", "dates"])
function eligibilityTypeMessageKey(type: string): MessageKey {
  return `dashboard.coop.preview.eligibility.types.${ELIGIBILITY_TYPE_KEYS.has(type) ? type : "generic"}` as MessageKey
}

function GapDetailSheet({
  match, onClose, onProposeGaps, onReviewRoadmap, onTailorCv,
}: {
  match: CoopMatch
  onClose: () => void
  /** Real mode: posts the selected gap ids and resolves with how many nodes were proposed.
   * Omitted in the fixture preview, which fakes the same success state locally. */
  onProposeGaps?: (gapIds: string[]) => Promise<number>
  onReviewRoadmap?: () => void
  /** Stashes this posting for the CV Builder and navigates there. Omitted in the fixture preview
   * (no real posting id to tailor against there). */
  onTailorCv?: () => void
}) {
  const { t, fmt } = useI18n()
  const sheetRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useModalFocus(sheetRef, onClose, closeRef)

  const gaps = match.gaps ?? []
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())
  const [proposedCount, setProposedCount] = useState<number | null>(null)
  const [proposing, setProposing] = useState(false)
  const [proposeError, setProposeError] = useState<string | null>(null)

  const propose = async (ids: string[]) => {
    setProposeError(null)
    if (!onProposeGaps) {
      // Fixture preview: no backend, so the UI's own optimistic state is the whole story.
      setAddedIds((previous) => new Set([...previous, ...ids]))
      return
    }
    setProposing(true)
    try {
      const count = await onProposeGaps(ids)
      setAddedIds((previous) => new Set([...previous, ...ids]))
      setProposedCount((previous) => (previous ?? 0) + count)
    } catch (reason) {
      setProposeError(reason instanceof Error ? reason.message : t("dashboard.coop.saveError"))
    } finally {
      setProposing(false)
    }
  }
  const addOne = (id: string) => { if (!addedIds.has(id)) void propose([id]) }
  const addAll = () => { const remaining = gaps.filter((gap) => !addedIds.has(gap.id)).map((gap) => gap.id); if (remaining.length) void propose(remaining) }
  const addedCount = onProposeGaps ? (proposedCount ?? 0) : addedIds.size

  return (
    <div className="wp-overlay fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label={match.title} onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <aside ref={sheetRef} className="wp-sheet h-full w-full overflow-y-auto bg-background p-5 shadow-2xl sm:max-w-lg sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"><bdi>{match.company}</bdi></p>
            <h2 dir="auto" className="mt-2 text-start text-2xl font-semibold tracking-tight sm:text-3xl">{match.title}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t("dashboard.coop.preview.gapDetail.close")} className="grid size-9 shrink-0 place-items-center rounded-full border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">{t(sourceLabelKey(match.source))}</span>
          <FitBar score={match.fitScore} tier={match.fitTier} />
        </div>

        {onTailorCv ? (
          <button
            type="button"
            onClick={onTailorCv}
            className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 text-sm font-semibold text-primary outline-none transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
          >
            <FileText className="size-4" aria-hidden="true" />
            {t("dashboard.coop.preview.gapDetail.tailorCv")}
          </button>
        ) : null}

        {match.matched?.length ? (
          <section className="mt-7 border-t border-border pt-6">
            <h3 className="font-semibold">{t("dashboard.coop.preview.gapDetail.matched")}</h3>
            <ul className="mt-3 flex flex-wrap gap-2">
              {match.matched.map((item) => (
                <li key={item} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  <Check className="size-3.5" aria-hidden="true" />
                  <bdi>{item}</bdi>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-7 border-t border-border pt-6">
          <h3 className="font-semibold">{t("dashboard.coop.preview.gapDetail.gaps")}</h3>
          {gaps.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t("dashboard.coop.preview.gapDetail.noGaps")}</p>
          ) : (
            <ul className="mt-3 grid gap-3">
              {gaps.map((gap) => {
                const added = addedIds.has(gap.id)
                return (
                  <li key={gap.id} className="rounded-2xl border border-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-semibold"><bdi>{gap.skill}</bdi></p>
                      <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", importanceTone(gap.importance))}>
                        {t(`dashboard.coop.preview.gapDetail.importance.${gap.importance}`)}
                      </span>
                    </div>
                    <p dir="auto" className="mt-2 text-start text-sm text-muted-foreground"><bdi>{gap.why}</bdi></p>
                    <div className="mt-3 rounded-xl bg-muted/60 p-3 text-sm">
                      <p className="text-xs font-semibold text-muted-foreground">{t("dashboard.coop.preview.gapDetail.suggestionLabel")}</p>
                      <p className="mt-1"><bdi>{gap.suggestion.title}</bdi> · <span className="text-muted-foreground">{gap.suggestion.duration}</span></p>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{gap.evidenceNeeded}</p>
                    <button
                      type="button"
                      onClick={() => addOne(gap.id)}
                      disabled={added || proposing}
                      aria-pressed={added}
                      className={cn(
                        "mt-3 inline-flex h-9 items-center gap-2 rounded-xl border border-border px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-80",
                        added && "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                      )}
                    >
                      {added ? <CheckCircle2 className="size-4" aria-hidden="true" /> : null}
                      {added ? t("dashboard.coop.preview.gapDetail.addedOne") : t("dashboard.coop.preview.gapDetail.addOne")}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {match.eligibility?.length ? (
          <section className="mt-7 border-t border-border pt-6">
            <h3 className="font-semibold">{t("dashboard.coop.preview.eligibility.title")}</h3>
            <ul className="mt-3 grid gap-2">
              {match.eligibility.map((item, index) => (
                <li key={`${item.type}-${index}`} className="flex gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span><span className="font-medium text-foreground">{t(eligibilityTypeMessageKey(item.type))}: </span><bdi>{item.detail}</bdi></span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {gaps.length > 0 ? (
          <div className="mt-7 border-t border-border pt-6">
            <button type="button" onClick={addAll} disabled={proposing || addedIds.size === gaps.length} className="h-11 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
              {t("dashboard.coop.preview.gapDetail.addAll", { count: gaps.length })}
            </button>
            {proposeError ? <p role="alert" className="mt-2 text-xs text-red-600">{proposeError}</p> : null}
            <AnimatePresence>
              {addedCount > 0 ? (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  className="overflow-hidden"
                >
                  <div className="mt-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                    <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                      {t("dashboard.coop.preview.gapDetail.successTitle", { count: addedCount })}
                    </p>
                    <p className="mt-1.5 text-xs text-muted-foreground">{t("dashboard.coop.preview.gapDetail.successNote")}</p>
                    <button type="button" onClick={onReviewRoadmap} className="mt-2 text-xs font-semibold underline-offset-4 hover:underline">
                      {t("dashboard.coop.preview.gapDetail.reviewInRoadmap")}
                    </button>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        ) : null}

        <p className="mt-6 text-xs text-muted-foreground">{t("dashboard.coop.preview.posted", { time: fmt.relative(match.postedAt) })}</p>
      </aside>
    </div>
  )
}

function HiddenSection({ hidden }: { hidden: CoopMatch[] }) {
  const { t, fmt } = useI18n()
  const [open, setOpen] = useState(false)
  return (
    <section className="mt-6">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-dashed border-border px-4 py-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span>{t("dashboard.coop.preview.hidden.toggleShow", { count: hidden.length })}</span>
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="hidden-list"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {hidden.length === 0 ? (
              <p className="mt-3 rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">{t("dashboard.coop.preview.hidden.empty")}</p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {hidden.map((match) => (
                  <li key={match.id} className="rounded-2xl border border-border bg-muted/40 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        <bdi>{match.title}</bdi> · <bdi className="text-muted-foreground">{match.company}</bdi>
                      </p>
                      <span className="text-[11px] text-muted-foreground">{t("dashboard.coop.preview.posted", { time: fmt.relative(match.postedAt) })}</span>
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{t("dashboard.coop.preview.hidden.reasonLabel")}: </span>
                      <bdi>{match.hiddenReason}</bdi>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  )
}

function CompaniesTab({ matches }: { matches: CoopMatch[] }) {
  const { t } = useI18n()
  const companies = useMemo(() => {
    const seen = new Map<string, { name: string; locations: Set<string>; count: number }>()
    for (const match of matches) {
      const entry = seen.get(match.company) ?? { name: match.company, locations: new Set<string>(), count: 0 }
      entry.locations.add(match.location)
      entry.count += 1
      seen.set(match.company, entry)
    }
    return Array.from(seen.values())
  }, [matches])

  if (companies.length === 0) {
    return <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">{t("dashboard.coop.preview.companies.empty")}</p>
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {companies.map((company) => (
        <div key={company.name} className="flex items-center gap-3 rounded-2xl border border-border bg-background p-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-muted">
            <Building2 className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold">
              <bdi>{company.name}</bdi>
            </p>
            <p className="text-xs text-muted-foreground">
              <bdi>{Array.from(company.locations).join(" · ")}</bdi>
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

interface CoopMatchesPreviewProps {
  /** Dev-only fixture preview (?mock=coop&persona=...). Omit for the real, per-student view. */
  persona?: CoopPersona
  /** Required when `persona` is omitted: whose real co-op matches to load. */
  studentId?: string
  /** True when mounted inside CoopView's own header/stats/tabs (skips this component's header). */
  embedded?: boolean
  /** "Review in Roadmap" navigates the app shell to the Roadmap tab. */
  onNavigate?: (tab: string) => void
}

export function CoopMatchesPreview({ persona, studentId, embedded = false, onNavigate }: CoopMatchesPreviewProps) {
  const { t } = useI18n()
  const [tab, setTab] = useState<ViewTab>("matches")
  const [selected, setSelected] = useState<CoopMatch | null>(null)

  // --- Fixture (mock) mode: local-only state, nothing ever leaves the browser. ------------------
  const fixture = persona ? COOP_PERSONA_FIXTURES[persona] : null
  const [mockStates, setMockStates] = useState<Record<string, ItemState>>({})
  const [mockRefreshing, setMockRefreshing] = useState(false)
  const mockStateOf = (id: string): ItemState => mockStates[id] ?? "neutral"
  const mockToggle = (id: string, next: ItemState) => setMockStates((previous) => ({ ...previous, [id]: previous[id] === next ? "neutral" : next }))
  const mockRefresh = () => { setMockRefreshing(true); window.setTimeout(() => setMockRefreshing(false), 1100) }

  // --- Real mode: the student's actual co-op data. ------------------------------------------------
  const real = useRealCoopData(studentId ?? "")

  const visible = fixture ? fixture.visible.filter((match) => mockStateOf(match.id) !== "dismissed") : real.visible
  const hidden = fixture ? fixture.hidden : real.hidden
  const sources = fixture ? fixture.sources : real.sources
  const refreshing = fixture ? mockRefreshing : real.refreshing
  const refresh = fixture ? mockRefresh : () => void real.refresh()
  const refreshError = fixture ? null : real.refreshError
  const stateOf = (match: CoopMatch): ItemState => (fixture ? mockStateOf(match.id) : match.state ?? "neutral")
  const onSave = (id: string, current: ItemState) => (fixture ? mockToggle(id, "saved") : void real.setStatus(id, current === "saved" ? "neutral" : "saved"))
  const onDismiss = (id: string, current: ItemState) => (fixture ? mockToggle(id, "dismissed") : void real.setStatus(id, current === "dismissed" ? "neutral" : "dismissed"))
  const onProposeGaps = fixture ? undefined : (postingId: string, gapIds: string[]) => real.proposeGaps(postingId, gapIds)
  const onReviewRoadmap = () => { setSelected(null); onNavigate?.("Roadmap") }
  // Real mode only: a fixture match id isn't a real CoopPosting, so there's nothing for the CV
  // Builder to tailor against in the dev preview. CvView reads and clears this key once on mount.
  const onTailorCv = fixture ? undefined : (postingId: string) => {
    try { window.sessionStorage.setItem("waypoint.cv.tailor-posting", postingId) } catch { /* storage blocked: the student just won't see the preselection */ }
    setSelected(null)
    onNavigate?.("CV")
  }

  if (!fixture && !studentId) return null
  if (!fixture && real.loading) {
    return <div className={embedded ? "" : "mx-auto w-full max-w-6xl p-4 sm:p-8"}><div className="h-32 animate-pulse rounded-3xl bg-muted" /><div className="mt-4 h-80 animate-pulse rounded-3xl bg-muted" /></div>
  }

  return (
    <div className={embedded ? "" : "mx-auto w-full max-w-6xl p-4 sm:p-8"}>
      {!embedded ? (
        <header className="mb-7 grid gap-4 border-b border-border pb-7 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            {persona ? (
              <p className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">{t("dashboard.coop.preview.badge")}</span>
                {t(`dashboard.coop.preview.persona.${persona}`)}
              </p>
            ) : null}
            <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">{t("dashboard.coop.preview.title")}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">{t("dashboard.coop.preview.intro")}</p>
          </div>
        </header>
      ) : null}

      {!fixture && real.error ? <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-600">{real.error}</div> : null}
      {refreshError ? <p role="alert" className="mb-3 text-xs text-amber-700 dark:text-amber-300">{refreshError}</p> : null}

      {sources ? <SourceStrip sources={sources} refreshing={refreshing} onRefresh={refresh} /> : null}

      <div className="mb-5 flex flex-wrap gap-1 rounded-xl bg-muted p-1" role="tablist" aria-label={t("dashboard.coop.preview.title")}>
        {(["matches", "companies"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn("rounded-lg px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring", tab === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
          >
            {t(`dashboard.coop.preview.tabs.${id}`)}
          </button>
        ))}
      </div>

      {tab === "matches" ? (
        <>
          <motion.div layout className="grid gap-4 md:grid-cols-2">
            <AnimatePresence initial={false}>
              {visible.map((match) => (
                <MatchCard
                  key={match.id}
                  match={match}
                  state={stateOf(match)}
                  onSave={() => onSave(match.id, stateOf(match))}
                  onDismiss={() => onDismiss(match.id, stateOf(match))}
                  onOpen={() => setSelected(match)}
                />
              ))}
            </AnimatePresence>
          </motion.div>
          {visible.length === 0 && !refreshing ? (
            <p className="rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">{t("dashboard.coop.emptyBody")}</p>
          ) : null}
          <HiddenSection hidden={hidden} />
        </>
      ) : (
        <CompaniesTab matches={[...visible, ...hidden]} />
      )}

      {selected ? (
        <GapDetailSheet
          match={selected}
          onClose={() => setSelected(null)}
          onProposeGaps={onProposeGaps ? (gapIds) => onProposeGaps(selected.id, gapIds) : undefined}
          onReviewRoadmap={onReviewRoadmap}
          onTailorCv={onTailorCv ? () => onTailorCv(selected.id) : undefined}
        />
      ) : null}
    </div>
  )
}
