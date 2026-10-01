"use client";

import { Eye, History, RotateCcw, X } from "lucide-react";
import type { RoadmapVersionSummary } from "@/components/roadmap/roadmap-types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";

interface RoadmapHistoryProps {
  versions: RoadmapVersionSummary[];
  onView: (version: RoadmapVersionSummary) => void;
  onRestore: (version: RoadmapVersionSummary) => void;
  onClose: () => void;
}

/** Every version the student has had. Older versions are read-only; restoring one makes a new version. */
export function RoadmapHistory({ versions, onView, onRestore, onClose }: RoadmapHistoryProps) {
  const { t, fmt } = useI18n();
  return (
    <section aria-label={t("roadmap.history.title")} className="shrink-0 border-b border-border bg-muted/30 px-4 py-3 sm:px-6">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><History className="size-4" aria-hidden="true" />{t("roadmap.history.title")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("roadmap.history.hint")}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t("common.close")} className="grid size-7 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><X className="size-4" aria-hidden="true" /></button>
      </div>
      <ul className="mt-3 max-h-56 divide-y divide-border overflow-y-auto rounded-xl border border-border bg-background">
        {versions.map((item) => {
          const empty = item.nodes === 0;
          return (
            <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="w-16 shrink-0 text-sm font-medium tabular-nums">{t("roadmap.history.version", { version: fmt.number(item.version) })}</span>
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                <span dir="auto" className="block truncate">{item.reason}</span>
                <span>{fmt.date(item.created_at)}{empty ? ` · ${t("roadmap.history.empty")}` : ` · ${t("roadmap.history.counts", { done: fmt.number(item.done), total: fmt.number(item.nodes) })}`}</span>
              </span>
              {item.active ? <span className={cn("rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400")}>{t("roadmap.history.current")}</span> : null}
              {!empty ? (
                <span className="flex items-center gap-1">
                  {!item.active ? <button type="button" onClick={() => onView(item)} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><Eye className="size-3.5" aria-hidden="true" />{t("roadmap.history.view")}</button> : null}
                  {!item.active ? <button type="button" onClick={() => onRestore(item)} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><RotateCcw className="size-3.5" aria-hidden="true" />{t("roadmap.history.restore")}</button> : null}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
