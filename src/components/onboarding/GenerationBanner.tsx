"use client"

import { Check, LoaderCircle, TriangleAlert } from "lucide-react"
import type { GenerationStatus } from "@/hooks/use-generation-status"
import { useI18n } from "@/lib/i18n/context"
import { cn } from "@/lib/utils"

/** Shown across the app while the first roadmap generates in the background; the one way back to it. */
export function GenerationBanner({ status, onOpen }: { status: GenerationStatus | null; onOpen: () => void }) {
  const { t, fmt } = useI18n()
  const state = status?.state ?? "running"
  const total = status?.total_stages ?? 0
  const done = status?.completed_stage_ids.length ?? 0
  const finished = state === "done"
  const stopped = state === "error" || state === "cancelled" || state === "idle"

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5 text-sm",
        finished ? "border-emerald-500/30 bg-emerald-500/10" : stopped ? "border-destructive/30 bg-destructive/5" : "border-primary/20 bg-primary/5",
      )}
    >
      <span className={cn("grid size-6 shrink-0 place-items-center rounded-full", finished ? "bg-emerald-500 text-white" : stopped ? "bg-destructive/15 text-destructive" : "bg-primary/15 text-primary")}>
        {finished ? <Check className="size-3.5" aria-hidden="true" /> : stopped ? <TriangleAlert className="size-3.5" aria-hidden="true" /> : <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />}
      </span>
      <p className="min-w-0 flex-1 font-medium">
        {finished ? t("onboarding.generation.ready") : stopped ? t("onboarding.generation.stopped") : t("onboarding.generation.building")}
        {!finished && !stopped ? (
          <span className="ms-2 font-normal text-muted-foreground">
            {total ? t("onboarding.generation.progress", { done: fmt.number(done), total: fmt.number(total) }) : t("onboarding.generation.planning")}
          </span>
        ) : null}
      </p>
      <button type="button" onClick={onOpen} className={cn("h-8 rounded-full px-4 text-xs font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]", finished ? "bg-emerald-600 text-white hover:bg-emerald-600/90" : "border border-border bg-background hover:bg-muted")}>
        {finished ? t("onboarding.generation.review") : stopped ? t("onboarding.generation.backToChat") : t("onboarding.generation.watch")}
      </button>
    </div>
  )
}
