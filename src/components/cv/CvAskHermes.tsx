"use client"

/**
 * "Ask Hermes" side panel for the CV Builder. `onSubmit` may return a string directly (the Phase A
 * mock, see cvAssistant.ts) or a Promise (Phase B's real `/cv/assist` call, see CvView.tsx) — the
 * loader stays up until it resolves either way, so this component doesn't need to know which.
 */

import { useEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { Check, Sparkles, Undo2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { EASE_OUT } from "@/lib/ease"
import { useI18n } from "@/lib/i18n/context"
import { CoachLoader } from "@/components/hermes/CoachLoader"
import "@/components/hermes/coach-concept.css"
import type { CvOffer } from "./fixtures"
import { cvSuggestionChips, type CvPendingEdit } from "./cvAssistant"

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  text: string
}

const STEP_KEYS = ["reading", "drafting", "checking"] as const

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

interface CvAskHermesProps {
  onClose: () => void
  offers: Pick<CvOffer, "id" | "company" | "title">[]
  pendingEdits: CvPendingEdit[]
  onSubmit: (instruction: string) => string | Promise<string>
  onAccept: (id: string) => void
  onUndo: (id: string) => void
  onUndoAll: () => void
}

export function CvAskHermes({ onClose, offers, pendingEdits, onSubmit, onAccept, onUndo, onUndoAll }: CvAskHermesProps) {
  const { t } = useI18n()
  const reduceMotion = useReducedMotion()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [processing, setProcessing] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const timers = useRef<number[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const mounted = useRef(true)

  useEffect(() => () => { mounted.current = false; timers.current.forEach((id) => window.clearTimeout(id)) }, [])
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" })
  }, [messages, processing, reduceMotion])

  const run = (instruction: string) => {
    const trimmed = instruction.trim()
    if (!trimmed || processing) return
    setMessages((prev) => [...prev, { id: uid(), role: "user", text: trimmed }])
    setInput("")
    setProcessing(true)
    setStepIndex(0)
    const stepTimer = window.setInterval(() => setStepIndex((index) => (index + 1) % STEP_KEYS.length), 550)
    timers.current.push(stepTimer)
    Promise.resolve(onSubmit(trimmed))
      .catch((reason) => (reason instanceof Error ? reason.message : t("cv.askHermes.genericError")))
      .then((reply) => {
        window.clearInterval(stepTimer)
        if (!mounted.current) return
        setMessages((prev) => [...prev, { id: uid(), role: "assistant", text: String(reply) }])
        setProcessing(false)
      })
  }

  return (
    <>
      <div className="no-print fixed inset-0 z-40 bg-black/20 sm:hidden" onClick={onClose} aria-hidden="true" />
      <motion.aside
        role="dialog"
        aria-label={t("cv.askHermes.title")}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={reduceMotion ? undefined : { opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.28, ease: EASE_OUT }}
        className="no-print fixed inset-x-0 bottom-0 z-50 flex max-h-[80vh] flex-col rounded-t-3xl border-t border-border bg-background shadow-2xl sm:inset-x-auto sm:inset-y-14 sm:bottom-auto sm:end-4 sm:top-18 sm:h-[calc(100%-5.5rem)] sm:max-h-none sm:w-96 sm:rounded-3xl sm:border"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
          </span>
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{t("cv.askHermes.title")}</h2>
          <button type="button" onClick={onClose} aria-label={t("cv.askHermes.close")} className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {messages.length === 0 ? <p className="mb-3 text-xs text-muted-foreground">{t("cv.askHermes.empty")}</p> : null}

          <div className="mb-3 flex flex-wrap gap-1.5">
            {cvSuggestionChips(offers).map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => run(chip)}
                disabled={processing}
                className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {chip}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            {messages.map((message) => (
              <div key={message.id} className={cn("max-w-[88%] rounded-2xl px-3 py-2 text-[13px] leading-snug", message.role === "user" ? "ms-auto bg-primary text-primary-foreground" : "me-auto bg-muted text-foreground")}>
                <bdi dir="auto">{message.text}</bdi>
              </div>
            ))}
            {processing ? (
              <div className="fq me-auto max-w-[88%] rounded-2xl bg-muted px-3 py-2">
                <CoachLoader activity="thinking" label={t(`cv.askHermes.steps.${STEP_KEYS[stepIndex]}`)} />
              </div>
            ) : null}
          </div>
        </div>

        {pendingEdits.length ? (
          <div className="shrink-0 border-t border-border px-4 py-2.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground">{t("cv.askHermes.pendingHeading")}</p>
              {pendingEdits.length > 1 ? (
                <button type="button" onClick={onUndoAll} className="text-[11px] font-medium text-muted-foreground underline-offset-4 hover:underline">
                  {t("cv.askHermes.undoAll")}
                </button>
              ) : null}
            </div>
            <ul className="mt-1.5 flex max-h-28 flex-col gap-1 overflow-y-auto">
              {pendingEdits.map((edit) => (
                <li key={edit.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-2 py-1.5 text-[12px]">
                  <span className="min-w-0 flex-1 truncate" title={edit.label}>{edit.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => onAccept(edit.id)} aria-label={`${t("cv.askHermes.accept")}: ${edit.label}`} className="grid size-6 place-items-center rounded-md text-emerald-700 outline-none hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-ring dark:text-emerald-400">
                      <Check className="size-3.5" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => onUndo(edit.id)} aria-label={`${t("cv.askHermes.undo")}: ${edit.label}`} className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                      <Undo2 className="size-3.5" aria-hidden="true" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <form
          onSubmit={(event) => { event.preventDefault(); run(input) }}
          className="flex shrink-0 items-center gap-2 border-t border-border p-3"
        >
          <input
            dir="auto"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={t("cv.askHermes.placeholder")}
            disabled={processing}
            className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={processing || !input.trim()}
            className="inline-flex h-10 shrink-0 items-center rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] disabled:opacity-50"
          >
            {t("cv.askHermes.send")}
          </button>
        </form>
      </motion.aside>
    </>
  )
}
