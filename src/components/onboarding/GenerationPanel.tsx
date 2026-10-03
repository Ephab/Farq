"use client"

import { Check, LoaderCircle, TriangleAlert } from "lucide-react"
import type { GenerationStatus } from "@/hooks/use-generation-status"
import { useI18n } from "@/lib/i18n/context"
import { cn } from "@/lib/utils"

/** Stands in for Home and Roadmap while the first roadmap is still being built (or waiting for review). */
export function GenerationPanel({ status, onOpen }: { status: GenerationStatus | null; onOpen: () => void }) {
  const { t, fmt } = useI18n()
  const state = status?.state ?? "running"
  const finished = state === "done"
  const stopped = state === "error" || state === "cancelled" || state === "idle"
  const total = status?.total_stages ?? 0
  const done = status?.completed_stage_ids.length ?? 0
  const percent = total ? Math.max(4, Math.round((done / total) * 100)) : 0

  return (
    <div className="grid flex-1 place-items-center p-6">
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <span className={cn("grid size-14 place-items-center rounded-2xl", finished ? "bg-emerald-500/15 text-emerald-600" : stopped ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")}>
          {finished ? <Check className="size-6" aria-hidden="true" /> : stopped ? <TriangleAlert className="size-6" aria-hidden="true" /> : <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />}
        </span>
        <h2 className="mt-5 text-2xl font-semibold tracking-tight text-balance">
          {finished ? t("onboarding.generation.ready") : stopped ? t("onboarding.generation.stopped") : t("onboarding.generation.building")}
        </h2>
        {status?.title && !stopped ? <p className="mt-1 text-sm font-medium"><bdi>{status.title}</bdi></p> : null}
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">
          {finished ? t("onboarding.generation.panelReady") : stopped ? t("onboarding.generation.panelStopped") : t("onboarding.generation.panelBuilding")}
        </p>
        {!finished && !stopped ? (
          <div className="mt-5 w-full">
            <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={total ? Math.round((done / total) * 100) : 0} className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full bg-primary transition-[width] duration-700 ease-out", !total && "w-1/4 animate-pulse")} style={total ? { width: `${percent}%` } : undefined} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{total ? t("onboarding.generation.progress", { done: fmt.number(done), total: fmt.number(total) }) : t("onboarding.generation.planning")}</p>
          </div>
        ) : null}
        <button type="button" onClick={onOpen} className="mt-6 h-10 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98]">
          {finished ? t("onboarding.generation.review") : stopped ? t("onboarding.generation.backToChat") : t("onboarding.generation.watch")}
        </button>
      </div>
    </div>
  )
}
