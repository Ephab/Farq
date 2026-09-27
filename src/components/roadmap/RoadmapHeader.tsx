"use client";

import { RotateCcw, Search } from "lucide-react";
import type { RoadmapLevel } from "@/data/computer-vision-roadmap";
import type { RoadmapOrientation } from "@/lib/roadmap-layout";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";

export type LevelFilter = RoadmapLevel | "All";

interface RoadmapHeaderProps {
  title: string;
  done: number;
  total: number;
  percent: number;
  query: string;
  onQuery: (q: string) => void;
  level: LevelFilter;
  onLevel: (l: LevelFilter) => void;
  view: RoadmapOrientation;
  onView: (v: RoadmapOrientation) => void;
  onReset: () => void;
}

const LEVELS: LevelFilter[] = ["All", "Beginner", "Intermediate", "Advanced"];
const VIEWS: RoadmapOrientation[] = ["vertical", "horizontal"];

export function RoadmapHeader({
  title,
  done,
  total,
  percent,
  query,
  onQuery,
  level,
  onLevel,
  view,
  onView,
  onReset,
}: RoadmapHeaderProps) {
  const { t, fmt } = useI18n();
  return (
    <div className="shrink-0 border-b border-border bg-background px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 dir="auto" className="truncate text-lg font-semibold sm:text-xl">
            {title}
          </h1>
          <p className="truncate text-[13px] text-muted-foreground sm:text-sm">
            {t("roadmap.header.hint")}{" "}
            <span className="font-medium text-foreground">
              {t("roadmap.header.progress", { done: fmt.number(done), total: fmt.number(total), percent: fmt.percent(percent / 100) })}
            </span>
          </p>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search
              className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder={t("roadmap.header.searchPlaceholder")}
              aria-label={t("roadmap.header.searchLabel")}
              dir="auto"
              className="h-8 w-44 rounded-lg border border-border bg-background ps-8 pe-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring sm:w-52"
            />
          </label>
          <div className="flex items-center gap-1" role="group" aria-label={t("roadmap.header.filterLevel")}>
            {LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => onLevel(l)}
                aria-pressed={level === l}
                className={cn(
                  "h-8 rounded-lg px-2.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  level === l
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {t(`roadmap.levels.${l}`)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1" role="group" aria-label={t("roadmap.header.changeLayout")}>
            {VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onView(v)}
                aria-pressed={view === v}
                className={cn(
                  "h-8 rounded-lg px-2.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  view === v
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {t(`roadmap.header.${v}`)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onReset}
            title={t("roadmap.header.reset")}
            aria-label={t("roadmap.header.reset")}
            className="grid size-8 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("roadmap.header.progressLabel")}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-muted-foreground/40" /> {t("roadmap.status.not-started")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-amber-500" /> {t("roadmap.status.in-progress")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-emerald-500" /> {t("roadmap.status.done")}
        </span>
        <span>{t("roadmap.header.legendHint")}</span>
      </div>
    </div>
  );
}
