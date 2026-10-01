"use client";

import type { ReactNode } from "react";
import { Search } from "lucide-react";
import type { RoadmapLevel } from "@/data/computer-vision-roadmap";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";

export type LevelFilter = RoadmapLevel | "All";

interface RoadmapHeaderProps {
  title: string;
  /** "Version 3 · Added a Rust topic": where this roadmap came from. */
  versionLine: string | null;
  done: number;
  total: number;
  percent: number;
  query: string;
  onQuery: (q: string) => void;
  level: LevelFilter;
  onLevel: (l: LevelFilter) => void;
  /** The roadmap actions: ask the coach, and the menu for generate / history / reset / remove. */
  actions: ReactNode;
}

const LEVELS: LevelFilter[] = ["All", "Beginner", "Intermediate", "Advanced"];

export function RoadmapHeader({ title, versionLine, done, total, percent, query, onQuery, level, onLevel, actions }: RoadmapHeaderProps) {
  const { t, fmt } = useI18n();
  return (
    <div className="shrink-0 border-b border-border bg-background px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-40">
          <h1 dir="auto" className="truncate text-lg font-semibold sm:text-xl">{title}</h1>
          <p className="truncate text-[13px] text-muted-foreground">
            {total ? <span className="font-medium text-foreground">{t("roadmap.header.progress", { done: fmt.number(done), total: fmt.number(total), percent: fmt.percent(percent / 100) })}</span> : null}
            {total && versionLine ? " · " : null}
            {versionLine ? <span dir="auto">{versionLine}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      {total ? (
        <>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={t("roadmap.header.progressLabel")}>
            <div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <label className="relative">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder={t("roadmap.header.searchPlaceholder")} aria-label={t("roadmap.header.searchLabel")} dir="auto" className="h-8 w-44 rounded-lg border border-border bg-background ps-8 pe-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring sm:w-52" />
            </label>
            <div className="flex items-center gap-1" role="group" aria-label={t("roadmap.header.filterLevel")}>
              {LEVELS.map((l) => (
                <button key={l} type="button" onClick={() => onLevel(l)} aria-pressed={level === l} className={cn("h-8 rounded-lg px-2.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", level === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                  {t(`roadmap.levels.${l}`)}
                </button>
              ))}
            </div>
            <ul className="ms-auto hidden flex-wrap sm:flex items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label={t("roadmap.header.legend")}>
              <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full border border-muted-foreground/40" aria-hidden="true" />{t("roadmap.status.not-started")}</li>
              <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-amber-500" aria-hidden="true" />{t("roadmap.status.in-progress")}</li>
              <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-emerald-500" aria-hidden="true" />{t("roadmap.status.done")}</li>
              <li className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-muted-foreground/50" aria-hidden="true" />{t("roadmap.header.optional")}</li>
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
