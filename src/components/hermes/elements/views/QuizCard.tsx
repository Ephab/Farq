"use client"

import { useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Check, ChevronRight, RotateCcw, X } from "lucide-react"
import { EASE_OUT, SPRING_PRESS } from "@/lib/ease"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n/context"
import type { QuizElement, QuizQuestionSpec } from "@/components/hermes/elements/types"
import { ProgressRing } from "@/components/hermes/elements/parts/ProgressRing"
import { CountdownRing } from "@/components/hermes/elements/parts/CountdownRing"

interface Answer {
  given: string
  correct: boolean
  revealed: boolean
  /** short_answer only: the student self-graded after seeing the reference answer. */
  selfMarked?: boolean
}

const LETTERS = ["A", "B", "C", "D"]

function optionsFor(q: QuizQuestionSpec): string[] {
  if (q.type === "true_false") return ["True", "False"]
  return q.options?.slice(0, 4) ?? []
}

/** All questions in one card, one at a time: progress ring, instant feedback,
 *  optional per-question timer, final score ring + review. Entirely local state —
 *  nothing here is a StudentFact or a backend write (Phase A, UI only). */
export function QuizCard({ element }: { element: QuizElement }) {
  const { t, fmt } = useI18n()
  const reduce = useReducedMotion()
  const questions = element.questions
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [draft, setDraft] = useState("")
  const [done, setDone] = useState(false)

  const q = questions[index]
  const saved = q ? answers[q.id] : undefined
  const revealed = saved?.revealed ?? false

  const answeredCount = Object.values(answers).filter((a) => a.revealed).length

  const reveal = (given: string) => {
    if (!q || revealed) return
    const correct = q.type === "short_answer" ? false : given === q.answer
    setAnswers((cur) => ({ ...cur, [q.id]: { given, correct, revealed: true } }))
  }

  const selfGrade = (correct: boolean) => {
    if (!q || !saved) return
    setAnswers((cur) => ({ ...cur, [q.id]: { ...cur[q.id], correct, selfMarked: true } }))
  }

  const next = () => {
    if (index < questions.length - 1) {
      setIndex((i) => i + 1)
      setDraft("")
    } else {
      setDone(true)
    }
  }

  const retry = () => {
    setAnswers({})
    setIndex(0)
    setDraft("")
    setDone(false)
  }

  const correctCount = questions.filter((qq) => {
    const a = answers[qq.id]
    return a?.revealed && a.correct && (qq.type !== "short_answer" || a.selfMarked)
  }).length
  const gradedTotal = questions.filter((qq) => {
    const a = answers[qq.id]
    return a?.revealed && (qq.type !== "short_answer" || a.selfMarked)
  }).length

  if (done) {
    const R = 40
    const circ = 2 * Math.PI * R
    const pct = gradedTotal > 0 ? Math.round((correctCount / gradedTotal) * 100) : 0
    return (
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: EASE_OUT }}
        className="chat-element quiz-element quiz-element-done"
      >
        <div className="quiz-score-row">
          <div className="quiz-score-ring">
            <svg viewBox="0 0 100 100" className="progress-ring-svg">
              <circle cx="50" cy="50" r={R} fill="none" strokeWidth="9" className="progress-ring-track" />
              <motion.circle
                cx="50" cy="50" r={R} fill="none" strokeWidth="9" strokeLinecap="round"
                className="progress-ring-fill" strokeDasharray={circ}
                initial={reduce ? false : { strokeDashoffset: circ }}
                animate={{ strokeDashoffset: circ - (circ * pct) / 100 }}
                transition={{ duration: reduce ? 0 : 0.8, ease: EASE_OUT, delay: 0.1 }}
                transform="rotate(-90 50 50)"
              />
            </svg>
            <div className="quiz-score-ring-label">
              <strong>{fmt.percent(pct / 100)}</strong>
            </div>
          </div>
          <div>
            <p className="quiz-score-title">{t("coach.elements.quiz.scoreTitle")}</p>
            <p className="quiz-score-fraction tabular-nums" dir="ltr">{t("coach.elements.quiz.scoreFraction", { correct: correctCount, total: gradedTotal })}</p>
          </div>
        </div>
        <ol className="quiz-review-list">
          {questions.map((qq, i) => {
            const a = answers[qq.id]
            const ok = Boolean(a?.revealed && a.correct)
            return (
              <li key={qq.id} className={cn("quiz-review-item", ok ? "quiz-review-ok" : "quiz-review-bad")}>
                <span className="quiz-review-mark" aria-hidden="true">{ok ? <Check size={12} /> : <X size={12} />}</span>
                <span className="quiz-review-text">
                  <span className="quiz-review-stem" dir="auto">{i + 1}. {qq.stem}</span>
                  {qq.explanation ? <span className="quiz-review-explain" dir="auto">{qq.explanation}</span> : null}
                </span>
              </li>
            )
          })}
        </ol>
        <button type="button" className="button secondary small" onClick={retry}>
          <RotateCcw size={13} /> {t("coach.elements.quiz.retry")}
        </button>
      </motion.div>
    )
  }

  if (!q) return null
  const opts = optionsFor(q)

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT }}
      className="chat-element quiz-element"
    >
      <div className="quiz-head">
        {element.title ? <p className="quiz-title" dir="auto">{element.title}</p> : null}
        <div className="quiz-head-meta">
          <ProgressRing current={answeredCount} total={questions.length} size={40} />
          {q.time_limit_s ? (
            <CountdownRing
              key={q.id}
              durationS={q.time_limit_s}
              running={!revealed}
              size={40}
              onExpire={() => reveal(draft)}
            />
          ) : null}
        </div>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={q.id}
          initial={reduce ? false : { opacity: 0, x: 14 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, x: -14 }}
          transition={{ duration: 0.28, ease: EASE_OUT }}
        >
          <p className="quiz-question" dir="auto">{q.stem}</p>

          {q.type === "short_answer" ? (
            <div className="quiz-short">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={revealed}
                rows={2}
                dir="auto"
                placeholder={t("coach.elements.quiz.typeAnswer")}
                className="quiz-short-input"
              />
              {!revealed ? (
                <button type="button" className="button small" disabled={!draft.trim()} onClick={() => reveal(draft)}>
                  {t("coach.elements.quiz.check")}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="quiz-options">
              {opts.map((opt, i) => {
                const selected = saved?.given === opt
                const isAnswer = opt === q.answer
                const show = revealed && (selected || isAnswer)
                return (
                  <motion.button
                    key={opt}
                    type="button"
                    disabled={revealed}
                    onClick={() => reveal(opt)}
                    whileTap={reduce || revealed ? undefined : { scale: 0.98 }}
                    transition={SPRING_PRESS}
                    className={cn(
                      "quiz-option",
                      revealed && isAnswer && "quiz-option-correct",
                      revealed && selected && !isAnswer && "quiz-option-wrong",
                    )}
                    aria-pressed={selected}
                  >
                    <span className="quiz-option-letter">{q.type === "true_false" ? "" : LETTERS[i]}</span>
                    <span dir="auto">{opt}</span>
                    {show ? <span className="quiz-option-icon">{isAnswer ? <Check size={14} /> : <X size={14} />}</span> : null}
                  </motion.button>
                )
              })}
            </div>
          )}

          <AnimatePresence>
            {revealed ? (
              <motion.div
                initial={reduce ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                transition={{ duration: 0.3, ease: EASE_OUT }}
                className={cn("quiz-feedback", saved?.correct ? "quiz-feedback-ok" : q.type === "short_answer" && !saved?.selfMarked ? "quiz-feedback-pending" : "quiz-feedback-bad")}
              >
                {q.type === "short_answer" ? (
                  <>
                    <p className="quiz-feedback-title">{t("coach.elements.quiz.correctAnswer")}</p>
                    <p dir="auto">{q.answer}</p>
                    {!saved?.selfMarked ? (
                      <div className="quiz-self-grade">
                        <span>{t("coach.elements.quiz.selfGrade")}</span>
                        <button type="button" className="button secondary small" onClick={() => selfGrade(true)}>{t("coach.elements.quiz.gotIt")}</button>
                        <button type="button" className="button secondary small" onClick={() => selfGrade(false)}>{t("coach.elements.quiz.missedIt")}</button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="quiz-feedback-title">{saved?.correct ? t("coach.elements.quiz.correct") : t("coach.elements.quiz.incorrect")}</p>
                )}
                {q.explanation && (q.type !== "short_answer" || saved?.selfMarked) ? <p className="quiz-feedback-explain" dir="auto">{q.explanation}</p> : null}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.div>
      </AnimatePresence>

      <div className="quiz-footer">
        <span className="quiz-counter tabular-nums">{t("coach.elements.quiz.questionLabel", { n: index + 1, total: questions.length })}</span>
        {revealed && (q.type !== "short_answer" || saved?.selfMarked) ? (
          <button type="button" className="button small" onClick={next}>
            {index < questions.length - 1 ? t("coach.elements.quiz.next") : t("coach.elements.quiz.finish")}
            <ChevronRight size={14} />
          </button>
        ) : null}
      </div>
    </motion.div>
  )
}
