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
import { MAX_FILE_MB } from "@/lib/quiz-extract";
import { useI18n, type MessageKey } from "@/lib/i18n/context";
import {
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
  onDismissJob: (id: string) => void;
  quizzes: SavedQuiz[];
  onStartQuiz: (quiz: SavedQuiz) => void;
  onDeleteQuiz: (id: string) => void;
  onDeleteQuizzes: (ids: string[]) => void;
}

const SORT_OPTIONS: DeckSort[] = ["newest", "oldest", "name"];
const QUESTION_TYPES = ["mcq", "true_false", "short_answer"] as const;

type I18n = ReturnType<typeof useI18n>;

function quizBreakdown(questions: QuizQuestion[], { t, fmt }: I18n): string {
  const parts = QUESTION_TYPES.map((type) => {
    const count = questions.filter((q) => q.type === type).length;
    return count ? t(`quiz.home.breakdown.${type}`, { count }) : "";
  }).filter(Boolean);
  return fmt.list(parts);
}

/** "Today, 3:04 PM" or "Sep 27, 3:04 PM", in the active locale. */
function deckDate(ts: number, { t, fmt }: I18n): string {
  const sameDay = new Date(ts).toDateString() === new Date().toDateString();
  if (sameDay) return t("quiz.home.today", { time: fmt.time(ts) });
  return fmt.date(ts, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Thousands of characters with one decimal, locale-formatted. */
function kChars(chars: number, fmt: I18n["fmt"]): string {
  return fmt.number(chars / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
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
  onDismissJob,
  quizzes,
  onStartQuiz,
  onDeleteQuiz,
  onDeleteQuizzes,
}: QuizHomeProps) {
  const i18n = useI18n();
  const { t, fmt } = i18n;
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
            {t("quiz.home.badge")}
          </span>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            {t("quiz.home.title")}
          </h1>
        </div>
        <div
          className="flex items-center gap-2 rounded-2xl border border-border bg-background px-3 py-2"
          aria-label={t("quiz.home.modelAria")}
          title={t("quiz.home.modelTitle")}
        >
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            Hermes
          </span>
          <span className="max-w-40 truncate text-[13px] font-medium sm:max-w-56" dir="auto">{modelLabel}</span>
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
          {uploading ? t("quiz.home.reading") : t("quiz.home.upload")}
        </button>
        <button
          type="button"
          onClick={onDemo}
          className="flex h-12 items-center justify-center rounded-xl border border-border px-6 text-[15px] font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("quiz.home.demo")}
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
          <span dir="auto">{error}</span>
        </div>
      ) : null}

      {/* Decks */}
      <section aria-label={t("quiz.home.yourSlides")} className="mx-auto mt-10 w-full max-w-7xl">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            {t("quiz.home.yourSlides")}{" "}
            <span className="text-sm font-medium tabular-nums text-muted-foreground">
              {fmt.number(decks.length)}
            </span>
          </h2>
          <span className="hidden text-[13px] text-muted-foreground sm:inline">
            {t("quiz.home.selectHint")}
          </span>
          <div className="relative ms-auto">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as DeckSort)}
              aria-label={t("quiz.home.sortAria")}
              className="h-9 appearance-none rounded-xl border border-border bg-background ps-3 pe-9 text-[13px] font-medium outline-none focus:ring-2 focus:ring-ring"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {t(`quiz.home.sort.${o}`)}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
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
            <span className="mt-3 text-[15px] font-medium">{t("quiz.home.emptyTitle")}</span>
            <span className="mt-1 text-[13px] text-muted-foreground">
              {t("quiz.home.emptyHint", { mb: MAX_FILE_MB })}
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
                  aria-label={t("quiz.home.selectDeck", { name: deck.fileName })}
                  onClick={() => onToggleDeck(deck.id)}
                  onKeyDown={(e) => {
                    // Keys pressed on the nested delete button belong to that button.
                    if (e.target !== e.currentTarget) return;
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
                          className="absolute -end-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-primary text-[11px] font-bold tabular-nums text-primary-foreground"
                          aria-hidden="true"
                        >
                          {fmt.number(order + 1)}
                        </span>
                      ) : null}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="ltr-value truncate text-start text-[15px] font-semibold" dir="ltr">{deck.fileName}</p>
                      <p className="mt-0.5 text-[13px] text-muted-foreground">
                        {t(`quiz.deckMeta.${deck.kind}`, { count: deck.units, chars: kChars(deck.chars, fmt) })}
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
                          ? t("quiz.home.confirmDeleteDeck", { name: deck.fileName })
                          : t("quiz.home.deleteDeck", { name: deck.fileName })
                      }
                      className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                    >
                      {confirmKey === `deck:${deck.id}` ? (
                        <span className="rounded-md bg-red-500 px-1.5 py-0.5 text-[11px] font-bold text-white">
                          {t("quiz.home.sure")}
                        </span>
                      ) : (
                        <Trash2 className="size-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {deckDate(deck.uploadedAt, i18n)}
                    </span>
                    {selected ? (
                      <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">
                        {t("quiz.home.selected")}
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                        {t("quiz.home.clickToSelect")}
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
              {t("quiz.home.selectionSummary", {
                count: selectedDecks.length,
                chars: kChars(selectedChars, fmt),
              })}
            </p>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={onClearSelection}
                className="flex h-10 items-center rounded-xl px-3 text-sm font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("quiz.home.clear")}
              </button>
              <button
                type="button"
                onClick={onGenerate}
                className="flex h-10 items-center gap-1.5 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("quiz.home.generate")} <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
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
        onDismiss={onDismissJob}
      />

      {/* Saved quizzes */}
      <section aria-label={t("quiz.home.generated")} className="mx-auto mt-10 w-full max-w-7xl">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            {t("quiz.home.generated")}{" "}
            <span className="text-sm font-medium tabular-nums text-muted-foreground">
              {fmt.number(quizzes.length)}
            </span>
          </h2>
          {pickedQuizIds.length > 0 ? (
            <div className="ms-auto flex items-center gap-2">
              <span className="text-[13px] tabular-nums text-muted-foreground">
                {t("quiz.home.picked", { count: pickedQuizIds.length })}
              </span>
              <button
                type="button"
                onClick={() => setPickedQuizIds([])}
                className="flex h-9 items-center rounded-xl px-3 text-[13px] font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("quiz.home.clear")}
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
                  ? t("quiz.home.deleteNConfirm", { count: pickedQuizIds.length })
                  : t("quiz.home.deleteN", { count: pickedQuizIds.length })}
              </button>
            </div>
          ) : null}
        </div>
        {quizzes.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-border bg-background px-5 py-6 text-center text-sm text-muted-foreground">
            {t("quiz.home.emptyQuizzes")}
          </p>
        ) : (
          <p className="mt-1 text-[13px] text-muted-foreground">
            {t("quiz.home.tickHint")}
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
                  aria-label={t("quiz.home.pickQuiz", { name: quiz.deckName })}
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
                    <span className="ltr-value truncate" dir="ltr">{quiz.deckName}</span>
                    {newQuizIds.includes(quiz.id) ? (
                      <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                        {t("quiz.home.newBadge")}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                    {t("quiz.home.questionCount", { count: quiz.questions.length })} ·{" "}
                    {t(`quiz.difficulty.${quiz.difficulty}` as MessageKey)}, {quizBreakdown(quiz.questions, i18n)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {deckDate(quiz.createdAt, i18n)}
                  </p>
                </div>
                {confirming ? (
                  <button
                    type="button"
                    onClick={() => askConfirm(`quiz:${quiz.id}`, () => onDeleteQuiz(quiz.id))}
                    aria-label={t("quiz.home.confirmDeleteQuiz", { name: quiz.deckName })}
                    className="flex h-9 shrink-0 items-center rounded-xl bg-red-500 px-3.5 text-[13px] font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t("quiz.home.sure")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => askConfirm(`quiz:${quiz.id}`, () => onDeleteQuiz(quiz.id))}
                    aria-label={t("quiz.home.deleteQuiz", { name: quiz.deckName })}
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
                  <Play className="size-4" aria-hidden="true" /> {t("quiz.home.start")}
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
