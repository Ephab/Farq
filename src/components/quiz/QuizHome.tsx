"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  FileText,
  ListChecks,
  Loader2,
  Play,
  Presentation,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { QuizQuestion } from "@/lib/quiz-ai";
import {
  formatDeckDate,
  sortDecks,
  type DeckSort,
  type SavedQuiz,
  type SlideDeck,
} from "@/lib/quiz-store";
import { ActiveJobList, type GenJob } from "./QuizJobList";
import { cn } from "@/lib/utils";

interface QuizHomeProps {
  /** Read-only label of the server's Hermes model. */
  modelLabel: string;
  decks: SlideDeck[];
  selectedDeckIds: string[];
  onToggleDeck: (id: string) => void;
  onClearSelection: () => void;
  onDeleteDeck: (id: string) => void;
  uploading: boolean;
  onUpload: (file: File) => void;
  onGenerate: () => void;
  onDemo: () => void;
  error: string | null;
  jobs: GenJob[];
  newQuizIds: string[];
  onCancelJob: (id: string) => void;
  onRetryJob: (job: GenJob) => void;
  onFallbackJob: (job: GenJob) => void;
  onDismissJob: (id: string) => void;
  quizzes: SavedQuiz[];
  onStartQuiz: (quiz: SavedQuiz) => void;
  onDeleteQuiz: (id: string) => void;
  onDeleteQuizzes: (ids: string[]) => void;
}

const SORT_OPTIONS: { id: DeckSort; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "name", label: "Name" },
];

function quizBreakdown(questions: QuizQuestion[]): string {
  const mcq = questions.filter((q) => q.type === "mcq").length;
  const tf = questions.filter((q) => q.type === "true_false").length;
  const sa = questions.filter((q) => q.type === "short_answer").length;
  return [
    mcq ? `${mcq} multiple-choice` : "",
    tf ? `${tf} true/false` : "",
    sa ? `${sa} short-answer` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function QuizHome({
  modelLabel,
  decks,
  selectedDeckIds,
  onToggleDeck,
  onClearSelection,
  onDeleteDeck,
  uploading,
  onUpload,
  onGenerate,
  onDemo,
  error,
  jobs,
  newQuizIds,
  onCancelJob,
  onRetryJob,
  onFallbackJob,
  onDismissJob,
  quizzes,
  onStartQuiz,
  onDeleteQuiz,
  onDeleteQuizzes,
}: QuizHomeProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [sort, setSort] = useState<DeckSort>("newest");
  const visibleDecks = sortDecks(decks, sort);
  const selectedDecks = decks.filter((d) => selectedDeckIds.includes(d.id));
  const selectedChars = selectedDecks.reduce((sum, d) => sum + d.chars, 0);

  // Two-step delete confirmation ("Trash" → "Sure?"), auto-reverts.
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const confirmTimer = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    };
  }, []);
  const askConfirm = (key: string, action: () => void) => {
    if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    if (confirmKey === key) {
      setConfirmKey(null);
      action();
      return;
    }
    setConfirmKey(key);
    confirmTimer.current = window.setTimeout(() => setConfirmKey(null), 4000);
  };

  // Bulk quiz selection for deleting several at once.
  const [pickedQuizIds, setPickedQuizIds] = useState<string[]>([]);
  const togglePickedQuiz = (id: string) => {
    setPickedQuizIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  // Drop picked ids whose quizzes no longer exist.
  useEffect(() => {
    setPickedQuizIds((prev) => prev.filter((id) => quizzes.some((q) => q.id === id)));
  }, [quizzes]);

  return (
    <div className="w-full px-4 py-8 sm:px-8 lg:px-10">
      {/* Header: title left, Hermes model readout top-right */}
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-end justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3.5" aria-hidden="true" />
            AI quizzes from your slides
          </span>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Turn slides into a quiz
          </h1>
        </div>
        <div
          className="flex items-center gap-2 rounded-2xl border border-border bg-background px-3 py-2"
          aria-label="Hermes quiz model"
          title="Quizzes use the server's Hermes model"
        >
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            Hermes
          </span>
          <span className="max-w-40 truncate text-[13px] font-medium sm:max-w-56">{modelLabel}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="mx-auto mt-6 flex w-full max-w-7xl flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[15px] font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          {uploading ? (
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            <Upload className="size-5" aria-hidden="true" />
          )}
          {uploading ? "Reading slides…" : "Upload slides"}
        </button>
        <button
          type="button"
          onClick={onDemo}
          className="flex h-12 items-center justify-center rounded-xl border border-border px-6 text-[15px] font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Try demo
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.pptx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
      </div>

      {error ? (
        <div
          role="alert"
          className="mx-auto mt-3 w-full max-w-7xl rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[13px] leading-relaxed"
        >
          {error}
        </div>
      ) : null}

      {/* Decks */}
      <section aria-label="Your slides" className="mx-auto mt-10 w-full max-w-7xl">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Your slides{" "}
            <span className="text-sm font-medium tabular-nums text-muted-foreground">
              {decks.length}
            </span>
          </h2>
          <span className="hidden text-[13px] text-muted-foreground sm:inline">
            Select one or more decks to quiz on
          </span>
          <div className="relative ml-auto">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as DeckSort)}
              aria-label="Sort slides"
              className="h-9 appearance-none rounded-xl border border-border bg-background pl-3 pr-9 text-[13px] font-medium outline-none focus:ring-2 focus:ring-ring"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
        </div>

        {visibleDecks.length === 0 ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-4 flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border px-6 py-14 text-center outline-none transition-colors hover:border-muted-foreground/50 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="grid size-12 place-items-center rounded-2xl bg-muted">
              <Upload className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <span className="mt-3 text-[15px] font-medium">No slides yet — upload your first deck</span>
            <span className="mt-1 text-[13px] text-muted-foreground">
              PDF or PPTX · up to 25MB · parsed in your browser
            </span>
          </button>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleDecks.map((deck) => {
              const order = selectedDeckIds.indexOf(deck.id);
              const selected = order >= 0;
              return (
                <div
                  key={deck.id}
                  role="checkbox"
                  tabIndex={0}
                  aria-checked={selected}
                  aria-label={`Select ${deck.fileName}`}
                  onClick={() => onToggleDeck(deck.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onToggleDeck(deck.id);
                    }
                  }}
                  className={cn(
                    "group cursor-pointer rounded-2xl border-2 bg-background p-5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    selected
                      ? "border-primary"
                      : "border-border hover:border-muted-foreground/50",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className="relative grid size-11 shrink-0 place-items-center rounded-xl bg-muted">
                      {deck.kind === "pdf" ? (
                        <FileText className="size-5 text-muted-foreground" aria-hidden="true" />
                      ) : (
                        <Presentation className="size-5 text-muted-foreground" aria-hidden="true" />
                      )}
                      {selected ? (
                        <span
                          className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-primary text-[11px] font-bold tabular-nums text-primary-foreground"
                          aria-hidden="true"
                        >
                          {order + 1}
                        </span>
                      ) : null}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold">{deck.fileName}</p>
                      <p className="mt-0.5 text-[13px] text-muted-foreground">
                        {deck.units} {deck.kind === "pdf" ? "pages" : "slides"} ·{" "}
                        {(deck.chars / 1000).toFixed(1)}k chars
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        askConfirm(`deck:${deck.id}`, () => onDeleteDeck(deck.id));
                      }}
                      aria-label={
                        confirmKey === `deck:${deck.id}`
                          ? `Confirm delete ${deck.fileName}`
                          : `Delete ${deck.fileName}`
                      }
                      className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                    >
                      {confirmKey === `deck:${deck.id}` ? (
                        <span className="rounded-md bg-red-500 px-1.5 py-0.5 text-[11px] font-bold text-white">
                          Sure?
                        </span>
                      ) : (
                        <Trash2 className="size-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatDeckDate(deck.uploadedAt)}
                    </span>
                    {selected ? (
                      <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">
                        Selected
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                        Click to select
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Selection bar — only appears once decks are picked */}
        {selectedDecks.length > 0 ? (
          <div className="sticky bottom-4 z-10 mt-5 flex flex-col gap-2 rounded-2xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 truncate px-2 text-sm">
              <span className="font-semibold tabular-nums">{selectedDecks.length}</span>{" "}
              {selectedDecks.length === 1 ? "deck" : "decks"} selected ·{" "}
              <span className="tabular-nums text-muted-foreground">
                ~{(selectedChars / 1000).toFixed(1)}k chars
              </span>
            </p>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={onClearSelection}
                className="flex h-10 items-center rounded-xl px-3 text-sm font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={onGenerate}
                className="flex h-10 items-center gap-1.5 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Generate quiz <ArrowRight className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {/* Generating jobs */}
      <ActiveJobList
        jobs={jobs}
        onCancel={onCancelJob}
        onRetry={onRetryJob}
        onFallback={onFallbackJob}
        onDismiss={onDismissJob}
      />

      {/* Saved quizzes */}
      <section aria-label="Generated quizzes" className="mx-auto mt-10 w-full max-w-7xl">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Generated quizzes{" "}
            <span className="text-sm font-medium tabular-nums text-muted-foreground">
              {quizzes.length}
            </span>
          </h2>
          {pickedQuizIds.length > 0 ? (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[13px] tabular-nums text-muted-foreground">
                {pickedQuizIds.length} picked
              </span>
              <button
                type="button"
                onClick={() => setPickedQuizIds([])}
                className="flex h-9 items-center rounded-xl px-3 text-[13px] font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() =>
                  askConfirm("bulk-quizzes", () => {
                    onDeleteQuizzes(pickedQuizIds);
                    setPickedQuizIds([]);
                  })
                }
                className={
                  confirmKey === "bulk-quizzes"
                    ? "flex h-9 items-center gap-1.5 rounded-xl bg-red-500 px-3.5 text-[13px] font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    : "flex h-9 items-center gap-1.5 rounded-xl border border-red-500/40 px-3.5 text-[13px] font-medium text-red-600 outline-none hover:bg-red-500/10 focus-visible:ring-2 focus-visible:ring-ring dark:text-red-400"
                }
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                {confirmKey === "bulk-quizzes"
                  ? `Delete ${pickedQuizIds.length}? Tap again`
                  : `Delete ${pickedQuizIds.length}`}
              </button>
            </div>
          ) : null}
        </div>
        {quizzes.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-border bg-background px-5 py-6 text-center text-sm text-muted-foreground">
            Nothing here yet — your generated quizzes will show up here to retake anytime.
          </p>
        ) : (
          <p className="mt-1 text-[13px] text-muted-foreground">
            Tick quizzes to delete several at once.
          </p>
        )}
        {quizzes.length > 0 ? (
          <div className="mt-3 flex flex-col gap-2">
            {quizzes.map((quiz) => {
              const picked = pickedQuizIds.includes(quiz.id);
              const confirming = confirmKey === `quiz:${quiz.id}`;
              return (
              <div
                key={quiz.id}
                className={
                  picked
                    ? "flex items-center gap-3 rounded-2xl border-2 border-primary/60 bg-background px-3 py-3.5 sm:gap-4 sm:px-5"
                    : "flex items-center gap-3 rounded-2xl border border-border bg-background px-3 py-3.5 sm:gap-4 sm:px-5"
                }
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={picked}
                  aria-label={`Pick quiz from ${quiz.deckName} for bulk delete`}
                  onClick={() => togglePickedQuiz(quiz.id)}
                  className="grid size-6 shrink-0 place-items-center rounded-md border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    className={
                      picked
                        ? "grid size-6 place-items-center rounded-md bg-primary text-primary-foreground"
                        : "grid size-6 place-items-center rounded-md border border-border text-transparent hover:border-muted-foreground/60"
                    }
                    aria-hidden="true"
                  >
                    <Check className="size-4" />
                  </span>
                </button>
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted">
                  <ListChecks className="size-5 text-muted-foreground" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-[15px] font-semibold">
                    <span className="truncate">{quiz.deckName}</span>
                    {newQuizIds.includes(quiz.id) ? (
                      <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                        New
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                    {quiz.questions.length} questions · {quiz.difficulty} ·{" "}
                    {quizBreakdown(quiz.questions)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDeckDate(quiz.createdAt)}
                  </p>
                </div>
                {confirming ? (
                  <button
                    type="button"
                    onClick={() => askConfirm(`quiz:${quiz.id}`, () => onDeleteQuiz(quiz.id))}
                    aria-label={`Confirm delete quiz from ${quiz.deckName}`}
                    className="flex h-9 shrink-0 items-center rounded-xl bg-red-500 px-3.5 text-[13px] font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Sure?
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => askConfirm(`quiz:${quiz.id}`, () => onDeleteQuiz(quiz.id))}
                    aria-label={`Delete quiz from ${quiz.deckName}`}
                    className="grid size-9 shrink-0 place-items-center rounded-xl text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onStartQuiz(quiz)}
                  className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Play className="size-4" aria-hidden="true" /> Start
                </button>
              </div>
              );
            })}
          </div>
        ) : null}
      </section>
    </div>
  );
}
