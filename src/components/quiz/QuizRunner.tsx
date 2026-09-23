"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Flame,
  Lightbulb,
  X,
} from "lucide-react";
import { EASE_OUT, SPRING_PRESS } from "@/lib/ease";
import type { QuizQuestion } from "@/lib/quiz-ai";
import { cn } from "@/lib/utils";

export interface QuizAnswer {
  given: string;
  correct: boolean;
  revealed: boolean;
  /** short_answer self-grade */
  selfMarked?: boolean;
}

interface QuizRunnerProps {
  questions: QuizQuestion[];
  answers: Record<string, QuizAnswer>;
  onAnswer: (qid: string, a: QuizAnswer) => void;
  onFinish: () => void;
  onQuit: () => void;
  sourceName: string;
}

const LETTERS = ["A", "B", "C", "D"];

type NavState = "current" | "correct" | "wrong" | "review" | "todo";

function navState(
  index: number,
  activeIndex: number,
  answer: QuizAnswer | undefined,
  isShort: boolean,
): NavState {
  if (index === activeIndex) return "current";
  if (!answer?.revealed) return "todo";
  if (isShort && !answer.selfMarked) return "review";
  return answer.correct ? "correct" : "wrong";
}

const NAV_STYLES: Record<NavState, string> = {
  current: "border-primary bg-primary text-primary-foreground",
  correct: "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  wrong: "border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-400",
  review: "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  todo: "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
};

const NAV_LABELS: Record<NavState, string> = {
  current: "current question",
  correct: "answered correctly",
  wrong: "answered incorrectly",
  review: "needs self-grade",
  todo: "unanswered",
};

export function QuizRunner({
  questions,
  answers,
  onAnswer,
  onFinish,
  onQuit,
  sourceName,
}: QuizRunnerProps) {
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState(""); // selection / textarea before check
  const [shakeKey, setShakeKey] = useState(0);
  const q = questions[index];
  const saved = answers[q.id];
  const revealed = saved?.revealed ?? false;

  // Reset draft when navigating.
  useEffect(() => {
    const s = answers[q.id];
    setDraft(s?.given ?? "");
  }, [q.id, answers]);

  const answeredCount = useMemo(
    () => questions.filter((qq) => answers[qq.id]?.revealed).length,
    [questions, answers],
  );
  const streak = useMemo(() => {
    let s = 0;
    for (let i = questions.length - 1; i >= 0; i--) {
      const a = answers[questions[i].id];
      if (a?.revealed && a.correct) s++;
      else if (a?.revealed) break;
    }
    return s;
  }, [questions, answers]);

  const check = () => {
    if (revealed) return;
    const given = draft.trim();
    if (!given) {
      setShakeKey((k) => k + 1);
      return;
    }
    if (q.type === "short_answer") {
      onAnswer(q.id, { given, correct: false, revealed: true });
      return;
    }
    const correct = given === q.answer;
    if (!correct) setShakeKey((k) => k + 1);
    onAnswer(q.id, { given, correct, revealed: true });
  };

  const selfGrade = (correct: boolean) => {
    if (!saved) return;
    onAnswer(q.id, { ...saved, correct, selfMarked: true });
  };

  const go = (dir: 1 | -1) => {
    const next = index + dir;
    if (next >= 0 && next < questions.length) setIndex(next);
  };

  // Keyboard: 1-4/A-D select, Enter check/next, arrows navigate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) check();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (revealed) {
          if (index < questions.length - 1) go(1);
          else onFinish();
        } else check();
        return;
      }
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
      if ((q.type === "mcq" || q.type === "true_false") && !revealed) {
        const opts = q.options ?? [];
        const num = Number(e.key);
        if (num >= 1 && num <= opts.length) setDraft(opts[num - 1]);
        const upper = e.key.toUpperCase();
        const li = LETTERS.indexOf(upper);
        if (li >= 0 && li < opts.length) setDraft(opts[li]);
        if (upper === "T" && q.type === "true_false") setDraft("True");
        if (upper === "F" && q.type === "true_false") setDraft("False");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const typeLabel =
    q.type === "mcq" ? "Multiple choice" : q.type === "true_false" ? "True / False" : "Short answer";

  return (
    <div className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-3xl flex-col px-4 py-6 sm:px-8">
      {/* Top bar */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onQuit}
          aria-label="Back to home"
          className="grid size-10 shrink-0 place-items-center rounded-xl border border-border text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
        <div
          className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={answeredCount}
          aria-valuemin={0}
          aria-valuemax={questions.length}
          aria-label="Quiz progress"
        >
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={false}
            animate={{ width: `${(answeredCount / questions.length) * 100}%` }}
            transition={{ duration: 0.35, ease: EASE_OUT }}
          />
        </div>
        <span className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
          {index + 1}/{questions.length}
        </span>
        {streak >= 2 ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-orange-500/15 px-2.5 py-1 text-xs font-semibold text-orange-600 dark:text-orange-400">
            <Flame className="size-3.5" aria-hidden="true" />
            {streak}
          </span>
        ) : null}
      </div>
      <p className="mt-2 truncate text-[13px] text-muted-foreground">
        {sourceName}
      </p>

      {/* Question navigator strip */}
      <div
        className="mt-4 flex items-center gap-2 overflow-x-auto rounded-2xl border border-border bg-background px-3 py-2.5"
        role="group"
        aria-label="Jump to question"
      >
        <span className="shrink-0 text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {answeredCount}/{questions.length}
        </span>
        <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
        {questions.map((qq, i) => {
          const st = navState(i, index, answers[qq.id], qq.type === "short_answer");
          return (
            <button
              key={qq.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Question ${i + 1}: ${NAV_LABELS[st]}`}
              aria-current={i === index ? "true" : undefined}
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-lg border text-sm font-semibold tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                NAV_STYLES[st],
              )}
            >
              {i + 1}
            </button>
          );
        })}
      </div>

      {/* Question card — grows with its content */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={q.id}
          initial={{ opacity: 0, x: 48 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -48 }}
          transition={{ duration: 0.28, ease: EASE_OUT }}
          className="mt-6 rounded-3xl border border-border bg-muted/30 px-6 py-6 sm:px-8 sm:py-8"
        >
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {typeLabel}
            {q.source ? ` · ${q.source}` : ""}
          </p>
          <motion.div
            key={shakeKey}
            animate={shakeKey ? { x: [0, -10, 10, -6, 6, 0] } : undefined}
            transition={{ duration: 0.35 }}
          >
            <h2 className="mt-2 text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">
              {q.question}
            </h2>
          </motion.div>

          {q.type === "short_answer" ? (
            <div className="mt-6">
              <textarea
                value={revealed ? (saved?.given ?? "") : draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={revealed}
                rows={4}
                placeholder="Type your answer in 1–2 sentences…"
                aria-label="Your answer"
                className="w-full resize-none rounded-2xl border border-border bg-background px-5 py-4 text-base leading-relaxed outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring disabled:opacity-80 sm:text-lg"
              />
              {!revealed ? (
                <p className="mt-1.5 text-[13px] text-muted-foreground">⌘/Ctrl + Enter to reveal</p>
              ) : null}
            </div>
          ) : (
            <div className="mt-6 flex flex-col gap-3" role="radiogroup" aria-label={q.question}>
              {(q.options ?? []).map((opt, i) => {
                const selected = (revealed ? saved?.given : draft) === opt;
                const isCorrectOpt = opt === q.answer;
                return (
                  <motion.button
                    key={opt}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={revealed}
                    onClick={() => setDraft(opt)}
                    whileTap={revealed ? undefined : { scale: 0.985 }}
                    transition={SPRING_PRESS}
                    className={cn(
                      "flex items-center gap-4 rounded-2xl border-2 px-5 py-4 text-left text-base outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring sm:py-5 sm:text-lg",
                      revealed && isCorrectOpt
                        ? "border-emerald-500/70 bg-emerald-500/10"
                        : revealed && selected && !isCorrectOpt
                          ? "border-red-500/70 bg-red-500/10"
                          : selected
                            ? "border-primary bg-muted"
                            : "border-border hover:border-muted-foreground/50 hover:bg-muted/40",
                      revealed && !selected && !isCorrectOpt ? "opacity-60" : "",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-lg text-sm font-bold",
                        revealed && isCorrectOpt
                          ? "bg-emerald-500 text-white"
                          : revealed && selected
                            ? "bg-red-500 text-white"
                            : selected
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground",
                      )}
                      aria-hidden="true"
                    >
                      {revealed && isCorrectOpt ? (
                        <Check className="size-4" />
                      ) : revealed && selected ? (
                        <X className="size-4" />
                      ) : q.type === "mcq" ? (
                        LETTERS[i] ?? i + 1
                      ) : (
                        opt[0]
                      )}
                    </span>
                    <span className="min-w-0 flex-1">{opt}</span>
                  </motion.button>
                );
              })}
            </div>
          )}

          {/* Feedback */}
          <AnimatePresence initial={false}>
            {revealed ? (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25, ease: EASE_OUT }}
                className={cn(
                  "mt-5 rounded-2xl border px-5 py-4",
                  q.type === "short_answer"
                    ? "border-border bg-muted/50"
                    : saved?.correct
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-red-500/40 bg-red-500/10",
                )}
              >
                {q.type === "short_answer" ? (
                  <div>
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      <Lightbulb className="size-4" aria-hidden="true" />
                      Reference answer
                    </p>
                    <p className="mt-1 text-[15px] leading-relaxed">{q.answer}</p>
                    {q.explanation ? (
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                        {q.explanation}
                      </p>
                    ) : null}
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => selfGrade(true)}
                        aria-pressed={saved?.selfMarked && saved.correct}
                        className={cn(
                          "flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          saved?.selfMarked && saved.correct
                            ? "bg-emerald-500 text-white"
                            : "border border-border hover:bg-muted",
                        )}
                      >
                        <Check className="size-4" aria-hidden="true" /> I got it right
                      </button>
                      <button
                        type="button"
                        onClick={() => selfGrade(false)}
                        aria-pressed={saved?.selfMarked && !saved.correct}
                        className={cn(
                          "flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          saved?.selfMarked && !saved.correct
                            ? "bg-red-500 text-white"
                            : "border border-border hover:bg-muted",
                        )}
                      >
                        <X className="size-4" aria-hidden="true" /> I missed it
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-[15px] font-semibold">
                      {saved?.correct ? "Correct — nice." : `Not quite. Answer: ${q.answer}`}
                    </p>
                    {q.explanation ? (
                      <p className="mt-1 text-sm leading-relaxed opacity-90">{q.explanation}</p>
                    ) : null}
                  </div>
                )}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.div>
      </AnimatePresence>

      {/* Footer nav */}
      <div className="mt-auto pt-8">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={index === 0}
            className="flex h-12 items-center gap-1 rounded-xl border border-border px-4 text-[15px] font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowLeft className="size-4" aria-hidden="true" /> Back
          </button>
          {!revealed ? (
            <button
              type="button"
              onClick={check}
              className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Check <ChevronRight className="size-5" aria-hidden="true" />
            </button>
          ) : index < questions.length - 1 ? (
            <button
              type="button"
              onClick={() => go(1)}
              className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Next <ArrowRight className="size-5" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onFinish}
              className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-base font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              See results <Check className="size-5" aria-hidden="true" />
            </button>
          )}
        </div>
        <p className="mt-2 text-center text-[13px] text-muted-foreground">
          {q.type === "short_answer" ? "Answer, reveal, then grade yourself" : "Keys 1–4 / A–D select · Enter checks"}
        </p>
      </div>
    </div>
  );
}
