"use client"

import { Check, Compass, LoaderCircle } from "lucide-react"
import { RoadmapCanvas } from "@/components/roadmap/RoadmapCanvas"
import type { NodeStatus } from "@/data/computer-vision-roadmap"
import type { StagedPlan, StagedSnapshot } from "@/hooks/use-staged-generation"
import { stripStagePrefix } from "@/lib/roadmap-layout"
import { useI18n } from "@/lib/i18n/context"
import { cn } from "@/lib/utils"

interface GeneratingViewProps {
  plan: StagedPlan | null
  snapshot: StagedSnapshot | null
  doneStageIds: ReadonlySet<string>
  activeStageId: string | null
  statuses: Record<string, NodeStatus>
  selectedId: string | null
  onSelect: (id: string | null) => void
  onExplore: () => void
  onStop: () => void
}

/** Live view of the first roadmap being built: stage progress on top, the diagram filling in below. */
export function GeneratingView({ plan, snapshot, doneStageIds, activeStageId, statuses, selectedId, onSelect, onExplore, onStop }: GeneratingViewProps) {
  const { t, fmt } = useI18n()
  const total = plan?.stages.length ?? 0
  const done = doneStageIds.size
  const percent = total ? Math.round((done / total) * 100) : 0

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-8">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 rounded-full bg-primary/8 px-3 py-1 text-xs font-medium text-primary">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              {plan ? t("onboarding.chat.stagesDone", { done: fmt.number(done), total: fmt.number(total) }) : t("onboarding.chat.planning")}
            </p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-balance sm:text-4xl">
              {plan ? <bdi>{plan.title}</bdi> : t("onboarding.chat.buildingTitle")}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground text-pretty">{t("onboarding.chat.exploreHint")}</p>
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
            <button type="button" onClick={onExplore} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98]">
              <Compass className="size-4" aria-hidden="true" />{t("onboarding.chat.exploreCta")}
            </button>
            <button type="button" onClick={onStop} className="h-8 rounded-full px-3 text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
              {t("onboarding.chat.stopCta")}
            </button>
          </div>
        </header>

        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t("onboarding.chat.stageProgressLabel")} className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full bg-primary transition-[width] duration-700 ease-out", !plan && "w-1/4 animate-pulse")} style={plan ? { width: `${Math.max(percent, 4)}%` } : undefined} />
        </div>

        {plan ? (
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={t("onboarding.chat.stageProgressLabel")}>
            {plan.stages.map((stage, index) => {
              const finished = doneStageIds.has(stage.id)
              const active = stage.id === activeStageId
              return (
                <li key={stage.id} className={cn("flex items-start gap-3 rounded-2xl border p-4 transition-colors", finished ? "border-emerald-500/30 bg-emerald-500/5" : active ? "border-primary/40 bg-primary/5 shadow-sm" : "border-border bg-card text-muted-foreground")}>
                  <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold", finished ? "bg-emerald-500 text-white" : active ? "bg-primary text-primary-foreground" : "bg-muted")}>
                    {finished ? <Check className="size-3.5" aria-hidden="true" /> : active ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : fmt.number(index + 1)}
                  </span>
                  <div className="min-w-0">
                    <p className={cn("text-sm font-medium leading-snug", (finished || active) && "text-foreground")}><bdi>{stripStagePrefix(stage.title)}</bdi></p>
                    {stage.description ? <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground"><bdi>{stage.description}</bdi></p> : null}
                  </div>
                </li>
              )
            })}
          </ol>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
            {[0, 1, 2].map((slot) => <div key={slot} className="h-[76px] animate-pulse rounded-2xl border border-border bg-muted/50" style={{ animationDelay: `${slot * 150}ms` }} />)}
          </div>
        )}

        <section className="relative flex h-[min(62svh,560px)] min-h-[360px] flex-col overflow-hidden rounded-3xl border border-border bg-card" aria-live="polite">
          {snapshot ? (
            <RoadmapCanvas
              nodes={snapshot.nodes}
              stages={snapshot.stages}
              statuses={statuses}
              selectedId={selectedId}
              dimmedIds={new Set()}
              onSelect={onSelect}
              onToggleDone={() => undefined}
            />
          ) : (
            <div className="grid flex-1 place-items-center p-8 text-center">
              <div>
                <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><LoaderCircle className="size-5 animate-spin" aria-hidden="true" /></span>
                <p className="mt-4 text-sm font-medium">{t("onboarding.chat.buildingFirst")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("onboarding.chat.underMinute")}</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
