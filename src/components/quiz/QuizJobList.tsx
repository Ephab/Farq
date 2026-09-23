"use client";

import { RotateCcw, X, Zap } from "lucide-react";
import type { QuizDifficulty, QuizLiveStage, QuizQuestionType } from "@/lib/quiz-ai";

/** A quiz generation running (or failed) in the background on home. */
export interface GenJob {
  id: string;
  deckIds: string[];
  label: string;
  count: number;
  difficulty: QuizDifficulty;
  types: QuizQuestionType[];
  model: string;
  modelLabel: string;
  apiKey: string;
  status: "generating" | "failed";
  /** Real transfer progress (0–100), driven by streamed bytes + parsed questions. */
  progress: number;
  /** Complete questions parsed from the stream so far. */
  parsed: number;
  /** Questions requested. */
  total: number;
  /** Genuine stage of the stream. */
  liveStage: QuizLiveStage;
  error: string | null;
  /** Transient failure (e.g. 503) — offer the small fast model. */
  showFallback: boolean;
  startedAt: number;
}

function stageLabel(stage: QuizLiveStage): string {
  if (stage === "waiting") return "Waiting for model";
  if (stage === "receiving") return "Receiving questions";
  if (stage === "validating") return "Validating";
  return "Done";
}

function MiniTube({ progress }: { progress: number }) {
  const pct = Math.round(progress);
  const hue = Math.round((progress / 100) * 125); // red → amber → green
  const top = `hsl(${hue} 85% 58%)`;
  const bottom = `hsl(${hue} 80% 42%)`;
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Generation ${pct} percent`}
      className="relative h-20 w-9 shrink-0 overflow-hidden rounded-b-full rounded-t-xl border-2 border-border bg-muted/40"
    >
      <div
        className="absolute inset-x-0 bottom-0 transition-[height] duration-300 ease-out"
        style={{ height: `${progress}%` }}
      >
        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(180deg, ${top}, ${bottom})` }}
        />
        <svg
          className="quiz-wave absolute -top-2 left-0 h-3 w-[200%]"
          viewBox="0 0 240 12"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M0,7 Q15,1 30,7 T60,7 T90,7 T120,7 V12 H0 Z" fill={top} />
          <path d="M0,7 Q15,1 30,7 T60,7 T90,7 T120,7 V12 H0 Z" transform="translate(120,0)" fill={top} />
        </svg>
        <span
          className="quiz-bubble absolute bottom-1 left-[30%] size-1.5 rounded-full bg-white/60"
          aria-hidden="true"
        />
        <span
          className="quiz-bubble absolute bottom-1 left-[62%] size-1 rounded-full bg-white/60"
          style={{ animationDelay: "1.2s" }}
          aria-hidden="true"
        />
      </div>
      <div
        className="pointer-events-none absolute inset-y-1.5 left-1 w-1 rounded-full bg-white/25"
        aria-hidden="true"
      />
    </div>
  );
}

interface ActiveJobListProps {
  jobs: GenJob[];
  onCancel: (id: string) => void;
  onRetry: (job: GenJob) => void;
  onFallback: (job: GenJob) => void;
  onDismiss: (id: string) => void;
}

export function ActiveJobList({ jobs, onCancel, onRetry, onFallback, onDismiss }: ActiveJobListProps) {
  if (jobs.length === 0) return null;
  const active = jobs.filter((j) => j.status === "generating").length;

  return (
    <section aria-label="Generating now" className="mx-auto mt-10 w-full max-w-7xl">
      <h2 className="text-lg font-semibold tracking-tight">
        Generating now{" "}
        <span className="text-sm font-medium tabular-nums text-muted-foreground">
          {active > 0 ? `${active} running` : "done"}
        </span>
      </h2>
      <div className="mt-4 flex flex-col gap-2">
        {jobs.map((job) => {
          const pct = Math.round(job.progress);
          const elapsed = Math.max(0, Math.floor((Date.now() - job.startedAt) / 1000));
          return (
            <div
              key={job.id}
              className={
                job.status === "failed"
                  ? "flex items-center gap-4 rounded-2xl border border-red-500/30 bg-red-500/5 px-4 py-3.5 sm:px-5"
                  : "flex items-center gap-4 rounded-2xl border border-border bg-background px-4 py-3.5 sm:px-5"
              }
            >
              {job.status === "generating" ? <MiniTube progress={job.progress} /> : null}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold">{job.label}</p>
                {job.status === "generating" ? (
                  <>
                    <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                      {stageLabel(job.liveStage)}
                      {job.liveStage === "receiving" && job.total > 0
                        ? ` · ${Math.min(job.parsed, job.total)}/${job.total} questions`
                        : ""}
                      {" · "}{job.difficulty}
                    </p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {pct}% · {elapsed}s
                    </p>
                  </>
                ) : (
                  <p className="mt-0.5 text-[13px] leading-relaxed text-red-600 dark:text-red-400">
                    {job.error ?? "Generation failed."}
                  </p>
                )}
              </div>
              {job.status === "generating" ? (
                <button
                  type="button"
                  onClick={() => onCancel(job.id)}
                  aria-label={`Cancel quiz from ${job.label}`}
                  className="grid size-9 shrink-0 place-items-center rounded-xl text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              ) : (
                <div className="flex shrink-0 items-center gap-2">
                  {job.showFallback ? (
                    <button
                      type="button"
                      onClick={() => onFallback(job)}
                      className="flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-[13px] font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Zap className="size-3.5" aria-hidden="true" /> Lightning 30B
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onRetry(job)}
                    className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-[13px] font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <RotateCcw className="size-3.5" aria-hidden="true" /> Retry
                  </button>
                  <button
                    type="button"
                    onClick={() => onDismiss(job.id)}
                    aria-label={`Dismiss failed quiz from ${job.label}`}
                    className="grid size-9 place-items-center rounded-xl text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
