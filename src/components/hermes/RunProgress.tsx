"use client"

import { useEffect, useState } from "react"
import { Check, Cpu, Gauge, Timer, TriangleAlert, X } from "lucide-react"
import { CoachActivityIcon, type CoachActivity } from "@/components/hermes/CoachActivityIcon"
import { MarkdownText } from "@/components/hermes/markdown"
import { useI18n, type MessageKey } from "@/lib/i18n/context"
import { modelLabel, useModelCatalog } from "@/lib/models"
import { cn } from "@/lib/utils"

/** Live state of a chat run, from the API's run-status stream (see app.hermes.RunProgress). */
export interface RunProgress {
  phase: "starting" | "queued" | "thinking" | "tool" | "writing"
  tool: string | null
  model: string | null
  started_at: number
  phase_since: number
  tokens: number
  tps: number | null
  preview: string
  steps: { tool: string; seconds: number; ok: boolean }[]
  notice: string | null
  attempt: number
  server_now: number
}

/** A run that has said nothing for this long gets a reassuring note (the server switches model at 45 s). */
const SLOW_SECONDS = 15

const TOOL_KEYS: Record<string, MessageKey> = {
  waypoint_get_student_profile: "coach.progress.tools.profile",
  waypoint_get_student_context: "coach.progress.tools.profile",
  waypoint_get_active_roadmap: "coach.progress.tools.roadmap",
  waypoint_record_explicit_fact: "coach.progress.tools.fact",
  waypoint_remember: "coach.progress.tools.remember",
  waypoint_forget: "coach.progress.tools.remember",
  waypoint_ask_question: "coach.progress.tools.question",
  waypoint_ready_to_generate: "coach.progress.tools.ready",
  waypoint_submit_roadmap_proposal: "coach.progress.tools.proposal",
  waypoint_find_hackathons: "coach.progress.tools.hackathons",
  waypoint_find_coop_companies: "coach.progress.tools.coop",
  waypoint_find_coop_postings: "coach.progress.tools.coop",
  waypoint_get_coop_target: "coach.progress.tools.coop",
  waypoint_search_mail: "coach.progress.tools.mail",
  waypoint_read_mail: "coach.progress.tools.mail",
  waypoint_get_project: "coach.progress.tools.project",
  waypoint_submit_project_refinement: "coach.progress.tools.project",
  waypoint_index_folder: "coach.progress.tools.folder",
  waypoint_scan_folder: "coach.progress.tools.folder",
  waypoint_read_project_file: "coach.progress.tools.folder",
  skill_view: "coach.progress.tools.skill",
}

function useToolLabel() {
  const { t } = useI18n()
  return (tool: string) => {
    const key = TOOL_KEYS[tool] ?? (tool.startsWith("waypoint_blackboard") ? "coach.progress.tools.courses" : null)
    return key ? t(key) : t("coach.progress.tools.generic", { tool: tool.replace(/^waypoint_/, "").replaceAll("_", " ") })
  }
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

const seconds = (value: number) => (value < 10 ? value.toFixed(1) : Math.round(value).toString())

/** What Hermes is doing right now, shown in place of a bare "Thinking…" while a run is live. */
export function RunProgressCard({ progress, receivedAt }: { progress: RunProgress; receivedAt: number }) {
  const { t } = useI18n()
  const toolLabel = useToolLabel()
  useModelCatalog()
  const now = useNow(true)
  // Server clock at this moment: the last report's server time plus what passed here since.
  const serverNow = progress.server_now + (now - receivedAt) / 1000
  const total = Math.max(0, serverNow - progress.started_at)
  const inPhase = Math.max(0, serverNow - progress.phase_since)
  const activity: CoachActivity = progress.phase === "tool" ? "tool" : progress.phase === "writing" ? "writing" : "thinking"
  const label = progress.phase === "tool" && progress.tool
    ? toolLabel(progress.tool)
    : t(`coach.progress.phase.${progress.phase}`)
  const silent = (progress.phase === "thinking" || progress.phase === "starting") && inPhase >= SLOW_SECONDS

  return (
    <div className="run-progress" aria-live="polite">
      <div className="activity-row" role="status">
        <CoachActivityIcon activity={activity} size={20} />
        <span className="font-medium">{label}</span>
        <span className="ms-auto inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground" title={t("coach.progress.elapsed")}>
          <Timer className="size-3.5" aria-hidden="true" />{t("coach.progress.seconds", { value: seconds(total) })}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {progress.model ? (
          <span className="inline-flex items-center gap-1"><Cpu className="size-3.5" aria-hidden="true" />{modelLabel(progress.model)}</span>
        ) : null}
        {progress.phase === "writing" && progress.tps ? (
          <span className="inline-flex items-center gap-1 tabular-nums"><Gauge className="size-3.5" aria-hidden="true" />{t("coach.progress.tps", { value: progress.tps.toFixed(0) })}</span>
        ) : null}
        {progress.tokens ? <span className="tabular-nums">{t("coach.progress.tokens", { count: progress.tokens })}</span> : null}
        {progress.phase !== "writing" && progress.phase !== "starting" && inPhase >= 3 ? (
          <span className="tabular-nums">{t("coach.progress.phaseFor", { value: seconds(inPhase) })}</span>
        ) : null}
      </div>

      {progress.notice ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {t("coach.progress.switched", { model: modelLabel(progress.model) })}
        </p>
      ) : null}

      {progress.steps.length ? (
        <ol className="mt-2 space-y-1 text-xs" aria-label={t("coach.progress.stepsLabel")}>
          {progress.steps.map((step, index) => (
            <li key={`${step.tool}-${index}`} className="flex items-center gap-1.5 text-muted-foreground">
              {step.ok ? <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> : <X className="size-3.5 text-destructive" aria-hidden="true" />}
              <span>{toolLabel(step.tool)}</span>
              <span className="tabular-nums opacity-70">{t("coach.progress.seconds", { value: seconds(step.seconds) })}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {silent ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("coach.progress.slow")}</p>
      ) : null}

      {progress.preview ? (
        <div className={cn("run-progress-preview mt-2 border-t border-border pt-2")}>
          <MarkdownText text={progress.preview} />
          <span className="run-progress-caret" aria-hidden="true" />
        </div>
      ) : null}
    </div>
  )
}
