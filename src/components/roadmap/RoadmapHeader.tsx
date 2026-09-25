"use client";

import { RotateCcw, Search } from "lucide-react";
import type { RoadmapLevel } from "@/data/computer-vision-roadmap";
import { cn } from "@/lib/utils";

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
  onReset: () => void;
}

const LEVELS: LevelFilter[] = ["All", "Beginner", "Intermediate", "Advanced"];

export function RoadmapHeader({
  title,
  done,
  total,
  percent,
  query,
  onQuery,
  level,
  onLevel,
  onReset,
}: RoadmapHeaderProps) {
  return (
    <div className="shrink-0 border-b border-border bg-background px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold sm:text-xl">
            {title}
          </h1>
          <p className="truncate text-[13px] text-muted-foreground sm:text-sm">
            Click any node for details.{" "}
            <span className="font-medium text-foreground">
              {done}/{total} done · {percent}%
            </span>
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Search topics…"
              aria-label="Search roadmap topics"
              className="h-8 w-44 rounded-lg border border-border bg-background pl-8 pr-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring sm:w-52"
            />
          </label>
          <div className="flex items-center gap-1" role="group" aria-label="Filter by level">
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
                {l}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onReset}
            title="Reset all progress"
            aria-label="Reset all progress"
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
        aria-label="Overall roadmap progress"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-muted-foreground/40" /> To do
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-amber-500" /> In progress
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-emerald-500" /> Done
        </span>
        <span className="hidden sm:inline">Drag the canvas to pan · scroll to move · use controls to zoom</span>
      </div>
    </div>
  );
}
