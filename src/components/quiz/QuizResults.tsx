"use client";

import { motion } from "motion/react";
import { useState } from "react";
import {
  Award,
  Check,
  ChevronDown,
  Flame,
  Home,
  RotateCcw,
  Target,
  X,
} from "lucide-react";
import { EASE_OUT } from "@/lib/ease";
import type { QuizQuestion } from "@/lib/quiz-ai";
import { cn } from "@/lib/utils";
import type { QuizAnswer } from "./QuizRunner";

interface QuizResultsProps {
  questions: QuizQuestion[];
  answers: Record<string, QuizAnswer>;
  sourceName: string;
  onRetry: () => void;
  onHome: () => void;
}

export function QuizResults({ questions, answers, sourceName, onRetry, onHome }: QuizResultsProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  const correct = questions.filter((q) => answers[q.id]?.correct).length;
  const total = questions.length;
  const pct = total === 0 ? 0 : Math.round((correct / total) * 100);
  const bestStreak = questions.reduce(
    (acc, q) => {
      const ok = answers[q.id]?.correct;
      const cur = ok ? acc.cur + 1 : 0;
      return { cur, best: Math.max(acc.best, cur) };
    },
    { cur: 0, best: 0 },
  ).best;

  const headline =
    pct === 100 ? "Flawless — you own this deck." : pct >= 70 ? "Strong. A quick review locks it in." : pct >= 40 ? "Warming up — review the misses below." : "Tough deck. Review, then retry.";

  const R = 44;
  const circ = 2 * Math.PI * R;

  return (
    <div className="w-full px-4 py-8 sm:px-8 lg:px-10">
      <div className="grid w-full items-start gap-8 lg:grid-cols-[360px_minmax(0,1fr)]">
      <div className="min-w-0 text-center lg:sticky lg:top-6 lg:text-left">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4, ease: EASE_OUT }}
          className="relative mx-auto grid size-36 place-items-center lg:mx-0"
          role="img"
          aria-label={`Score ${correct} out of ${total}`}
        >
          <svg viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90">
            <circle cx="50" cy="50" r={R} fill="none" strokeWidth="10" className="stroke-muted" />
            <motion.circle
              cx="50"
              cy="50"
              r={R}
              fill="none"
              strokeWidth="10"
              strokeLinecap="round"
              className="stroke-primary"
              strokeDasharray={circ}
              initial={{ strokeDashoffset: circ }}
              animate={{ strokeDashoffset: circ - (circ * pct) / 100 }}
              transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.15 }}
            />
          </svg>
          <div>
            <p className="text-3xl font-bold tabular-nums">{pct}%</p>
            <p className="text-[13px] text-muted-foreground tabular-nums">
              {correct}/{total}
            </p>
          </div>
        </motion.div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">{headline}</h1>
        <p className="mt-1.5 truncate text-sm text-muted-foreground">{sourceName}</p>

        <div className="mt-5 grid grid-cols-3 gap-2">
          {[
            { icon: Target, label: "Correct", value: `${correct}/${total}` },
            { icon: Flame, label: "Best streak", value: `${bestStreak}` },
            {
              icon: Award,
              label: "Grade",
              value: pct >= 90 ? "A" : pct >= 70 ? "B" : pct >= 50 ? "C" : "Retry",
            },
          ].map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: EASE_OUT, delay: 0.2 + i * 0.08 }}
              className="rounded-2xl border border-border bg-background px-3 py-3"
            >
              <s.icon className="mx-auto size-4 text-muted-foreground" aria-hidden="true" />
              <p className="mt-1 text-base font-semibold tabular-nums">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </motion.div>
          ))}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-[15px] font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcw className="size-4" aria-hidden="true" /> Retry quiz
          </button>
          <button
            type="button"
            onClick={onHome}
            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border px-4 text-[15px] font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Home className="size-4" aria-hidden="true" /> Quizzes home
          </button>
        </div>
      </div>

      <div className="min-w-0">
        <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Review ({total})
        </h2>
        <div className="mt-3 flex flex-col gap-4">
          {questions.map((q, i) => {
            const a = answers[q.id];
            const ok = a?.correct ?? false;
            const open = openId === q.id;
            const typeLabel =
              q.type === "mcq"
                ? "Multiple choice"
                : q.type === "true_false"
                  ? "True / False"
                  : "Short answer";
            return (
              <div key={q.id} className="overflow-hidden rounded-3xl border border-border bg-background">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : q.id)}
                  aria-expanded={open}
                  className="block w-full px-5 py-5 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6 sm:py-6"
                >
                  <span className="flex items-center gap-3">
                    <span
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-full text-white",
                        ok ? "bg-emerald-500" : "bg-red-500",
                      )}
                      aria-hidden="true"
                    >
                      {ok ? <Check className="size-4" /> : <X className="size-4" />}
                    </span>
                    <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      Question {i + 1} · {typeLabel}
                      {q.source ? ` · ${q.source}` : ""}
                    </span>
                    <ChevronDown
                      className={cn("ml-auto size-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="mt-3 block text-base font-medium leading-relaxed sm:text-lg">
                    {q.question}
                  </span>
                  <span
                    className={cn(
                      "mt-4 block rounded-2xl border px-4 py-3 text-sm leading-relaxed",
                      ok
                        ? "border-emerald-500/40 bg-emerald-500/10"
                        : "border-red-500/40 bg-red-500/10",
                    )}
                  >
                    <span className="block">
                      <span className="font-semibold">Your answer: </span>
                      {a?.given ?? "—"}
                    </span>
                    {!ok ? (
                      <span className="mt-1.5 block">
                        <span className="font-semibold">Correct answer: </span>
                        {q.answer}
                      </span>
                    ) : null}
                  </span>
                </button>
                {open ? (
                  <div className="border-t border-border px-5 py-5 text-sm leading-relaxed sm:px-6">
                    {q.type !== "short_answer" && q.options ? (
                      <div className="flex flex-col gap-1.5">
                        {q.options.map((opt) => (
                          <p
                            key={opt}
                            className={cn(
                              "rounded-xl px-3 py-2",
                              opt === q.answer
                                ? "bg-emerald-500/10 font-medium"
                                : "text-muted-foreground",
                            )}
                          >
                            {opt === q.answer ? "✓ " : null}{opt}
                          </p>
                        ))}
                      </div>
                    ) : null}
                    {q.type === "short_answer" ? (
                      <p>
                        <span className="font-medium">Reference answer: </span>
                        {q.answer}
                      </p>
                    ) : null}
                    {q.explanation ? (
                      <p className="mt-3 text-muted-foreground">{q.explanation}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      </div>
    </div>
  );
}
