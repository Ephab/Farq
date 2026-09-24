"use client";

import { ArrowLeft, ArrowRight, Check, FileText, Presentation, Repeat } from "lucide-react";
import type { QuizDifficulty, QuizQuestionType } from "@/lib/quiz-ai";
import type { SlideDeck } from "@/lib/quiz-store";
import { cn } from "@/lib/utils";

export interface QuizShape {
  count: number;
  difficulty: QuizDifficulty;
  types: QuizQuestionType[];
}

interface QuizConfigureProps {
  decks: SlideDeck[];
  shape: QuizShape;
  onShape: (s: QuizShape) => void;
  modelLabel: string;
  error: string | null;
  onGenerate: () => void;
  onBack: () => void;
}

const COUNTS = [5, 10, 15];
const DIFFICULTIES: QuizDifficulty[] = ["Easy", "Medium", "Hard", "Mixed"];
const TYPE_META: { id: QuizQuestionType; label: string; hint: string }[] = [
  { id: "mcq", label: "Multiple choice", hint: "4 options" },
  { id: "true_false", label: "True / False", hint: "quick-fire" },
  { id: "short_answer", label: "Short answer", hint: "self-graded" },
];

export function QuizConfigure({
  decks,
  shape,
  onShape,
  modelLabel,
  error,
  onGenerate,
  onBack,
}: QuizConfigureProps) {
  const toggleType = (t: QuizQuestionType) => {
    const has = shape.types.includes(t);
    onShape({
      ...shape,
      types: has ? shape.types.filter((x) => x !== t) : [...shape.types, t],
    });
  };

  const canGenerate = shape.types.length > 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8">
      <button
        type="button"
        onClick={onBack}
        className="flex h-9 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> All slides
      </button>

      <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
        Generate quiz
      </h1>

      {/* Decks */}
      <div className="mt-6 flex flex-col gap-2">
        {decks.map((deck) => (
          <div
            key={deck.id}
            className="flex items-center gap-4 rounded-2xl border border-border bg-background p-4 sm:p-5"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted sm:size-12">
              {deck.kind === "pdf" ? (
                <FileText className="size-5 text-muted-foreground sm:size-6" aria-hidden="true" />
              ) : (
                <Presentation className="size-5 text-muted-foreground sm:size-6" aria-hidden="true" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold sm:text-base">{deck.fileName}</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {deck.units} {deck.kind === "pdf" ? "pages" : "slides"} ·{" "}
                {(deck.chars / 1000).toFixed(1)}k chars
              </p>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 px-1">
          <p className="text-[13px] text-muted-foreground">
            {decks.length} {decks.length === 1 ? "deck" : "decks"} · {modelLabel}
          </p>
          <button
            type="button"
            onClick={onBack}
            className="ml-auto flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-[13px] font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Repeat className="size-3.5" aria-hidden="true" /> Change selection
          </button>
        </div>
      </div>

      {/* Shape */}
      <div className="mt-4 rounded-2xl border border-border bg-background p-6">
        <div className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-sm text-muted-foreground">Questions</span>
          <div className="flex gap-1 rounded-xl bg-muted p-1" role="group" aria-label="Question count">
            {COUNTS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onShape({ ...shape, count: c })}
                aria-pressed={shape.count === c}
                className={cn(
                  "h-9 min-w-12 rounded-lg px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  shape.count === c
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="w-24 shrink-0 text-sm text-muted-foreground">Difficulty</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Difficulty">
            {DIFFICULTIES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onShape({ ...shape, difficulty: d })}
                aria-pressed={shape.difficulty === d}
                className={cn(
                  "h-9 rounded-xl px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  shape.difficulty === d
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {TYPE_META.map((t) => {
            const active = shape.types.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleType(t.id)}
                aria-pressed={active}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary/40 bg-muted"
                    : "border-border hover:bg-muted/50",
                )}
              >
                <span
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-md border",
                    active ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}
                  aria-hidden="true"
                >
                  {active ? <Check className="size-3.5" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{t.label}</span>
                  <span className="block text-xs text-muted-foreground">{t.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm leading-relaxed"
        >
          {error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onGenerate}
        disabled={!canGenerate}
        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
      >
        Generate quiz <ArrowRight className="size-5" aria-hidden="true" />
      </button>
      <p className="mt-2 text-center text-[13px] text-muted-foreground">
        Takes up to a minute on large decks. You will see live progress.
      </p>
    </div>
  );
}
