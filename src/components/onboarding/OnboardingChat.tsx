"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowRight, BookOpen, Bot, Check, FastForward, LoaderCircle, Sparkles, Target, Wand2 } from "lucide-react"
import { GeneratingView } from "@/components/onboarding/GeneratingView"
import { ChatThreadView } from "@/components/hermes/ChatThreadView"
import { useHermesChat } from "@/components/hermes/use-hermes-chat"
import { streamStagedRoadmap, type StagedPlan, type StagedSnapshot } from "@/hooks/use-staged-generation"
import type { NodeStatus } from "@/data/computer-vision-roadmap"
import { api, runErrorMessage, type StudentProfile } from "@/lib/waypoint-api"
import { useI18n } from "@/lib/i18n/context"

interface OnboardingChatProps {
  profile: StudentProfile
  onBack: () => void
  onGenerated: () => void
  /** Leave onboarding for the app while the roadmap keeps generating on the server. */
  onExplore: () => void
  /** Reports whether a roadmap is being built, so the page around the chat can drop exits that would orphan it. */
  onGeneratingChange?: (generating: boolean) => void
}

export function OnboardingChat({ profile, onBack, onGenerated, onExplore, onGeneratingChange }: OnboardingChatProps) {
  const { t } = useI18n()
  const chat = useHermesChat(profile.thread_id)
  // Generation runs on the server, so a student who left (or reloaded) mid-run comes back to it:
  // the stream below re-attaches and replays what has been built so far.
  const [generating, setGenerating] = useState(profile.onboarding_status === "generating")
  const [plan, setPlan] = useState<StagedPlan | null>(null)
  const [snapshot, setSnapshot] = useState<StagedSnapshot | null>(null)
  const [doneStageIds, setDoneStageIds] = useState<Set<string>>(new Set())
  const [activeStageId, setActiveStageId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => () => abort.current?.abort(), [])

  const statuses = useMemo(() => {
    const map: Record<string, NodeStatus> = {}
    for (const node of snapshot?.nodes ?? []) map[node.id] = node.status ?? "not-started"
    return map
  }, [snapshot])

  const generate = async (attach = false) => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setGenerating(true); setGenError(null); setPlan(null); setSnapshot(null)
    setDoneStageIds(new Set()); setActiveStageId(null); setSelectedId(null)
    try {
      await streamStagedRoadmap(profile.student_id, controller.signal, {
        onPlan: (_jobId, next) => {
          setPlan(next)
          setActiveStageId(next.stages[0]?.id ?? null)
        },
        onStage: (stageId, next) => {
          setSnapshot(next)
          setDoneStageIds((current) => new Set(current).add(stageId))
          setActiveStageId(next.stages.find((stage) => stage.nodeIds.length === 0)?.id ?? null)
        },
        onDone: () => onGenerated(),
        onError: (message) => {
          setGenError(message)
          setGenerating(false)
        },
      }, attach)
    } catch (reason) {
      if (controller.signal.aborted) return
      if (attach) {
        setGenError(reason instanceof Error ? runErrorMessage(reason.message) : t("onboarding.chat.generateFailed"))
        setGenerating(false)
        return
      }
      // Fall back to the whole-roadmap endpoint so a dropped stream never blocks onboarding.
      try {
        await api(`/api/students/${profile.student_id}/onboarding/generate`, { method: "POST", body: "{}" })
        onGenerated()
      } catch (fallbackReason) {
        setGenError(fallbackReason instanceof Error ? runErrorMessage(fallbackReason.message) : reason instanceof Error ? runErrorMessage(reason.message) : t("onboarding.chat.generateFailed"))
        setGenerating(false)
      }
    }
  }

  // Returning to a run that is already going: follow it instead of starting another.
  useEffect(() => {
    if (profile.onboarding_status === "generating") void generate(true)
    // Once on mount; later runs are started by the buttons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { onGeneratingChange?.(generating) }, [generating, onGeneratingChange])
  useEffect(() => () => onGeneratingChange?.(false), [onGeneratingChange])

  const stop = async () => {
    abort.current?.abort()
    try { await api(`/api/students/${profile.student_id}/onboarding/generate/cancel`, { method: "POST" }) } catch { /* the run may already be over */ }
    setGenerating(false); setPlan(null); setSnapshot(null)
  }

  const answered = chat.messages.filter((message) => message.role === "user").length
  // Hermes calls waypoint_ready_to_generate once it knows enough; until then Generate is only a quiet skip.
  const ready = chat.messages.some((message) => message.role === "assistant" && message.metadata?.ready_to_generate)
  const canSkip = !ready && answered >= 2

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {generating ? null : (
      <div className="border-b border-border px-4 py-3 sm:px-8"><div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3">
        <span className="grid size-9 place-items-center rounded-2xl bg-primary text-primary-foreground"><Bot className="size-4" /></span>
        <div className="min-w-0 flex-1"><h1 className="text-sm font-semibold">{t("onboarding.chat.title")}</h1><p className="text-xs text-muted-foreground">{t("onboarding.chat.subtitle")}</p></div>
        <button type="button" onClick={onBack} className="h-9 rounded-xl border border-border px-3 text-xs disabled:opacity-40">{t("onboarding.chat.backToReview")}</button>
        {ready ? (
          <button type="button" onClick={() => void generate()} disabled={chat.busy} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-40">
            <Wand2 className="size-3.5" />{t("onboarding.chat.generate")}
          </button>
        ) : canSkip ? (
          <button type="button" onClick={() => void generate()} disabled={chat.busy} title={t("onboarding.chat.skipAheadTitle")} className="h-9 rounded-xl px-3 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-40">
            {t("onboarding.chat.skipAhead")}
          </button>
        ) : null}
      </div></div>
      )}
      {generating ? (
        <GeneratingView
          plan={plan}
          snapshot={snapshot}
          doneStageIds={doneStageIds}
          activeStageId={activeStageId}
          statuses={statuses}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onExplore={onExplore}
          onStop={() => void stop()}
        />
      ) : (
        <>
          {genError ? <div className="mx-auto mt-3 w-full max-w-3xl rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{genError}</div> : null}
          <div className="onboarding-chat mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
          <ChatThreadView
            messages={chat.messages}
            busy={chat.busy}
            stage={chat.stage}
            progress={chat.progress}
            error={chat.error}
            onSend={(text) => void chat.send(text)}
            onInteraction={(interaction, displayText) => void chat.sendInteraction(interaction, displayText)}
            onRetry={() => { chat.retry().catch(() => undefined) }}
            onEditResend={(messageId, text) => void chat.editAndResend(messageId, text)}
            onStop={() => void chat.stop()}
            placeholder={answered ? t("onboarding.chat.placeholderAnswered") : t("onboarding.chat.placeholderStart")}
            afterMessages={ready && !chat.busy ? (
              <div className="mx-auto flex w-full max-w-md flex-col items-center gap-2 rounded-2xl border border-primary/25 bg-primary/5 px-5 py-4 text-center">
                <p className="flex items-center gap-1.5 text-sm font-semibold"><Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />{t("onboarding.chat.readyTitle")}</p>
                <p className="text-xs text-muted-foreground">{t("onboarding.chat.readyBody")}</p>
                <button type="button" onClick={() => void generate()} disabled={generating} className="mt-1 inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-40">
                  {generating ? <LoaderCircle className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}{t("onboarding.chat.generate")}
                </button>
              </div>
            ) : undefined}
            empty={
              <div className="onb-empty">
                <span className="onb-empty-mark"><Sparkles className="size-6" aria-hidden="true" /></span>
                <h2>{t("onboarding.chat.emptyTitle")}</h2>
                <p>{t("onboarding.chat.emptyBody")}</p>
                <ul className="onb-empty-chips">
                  <li><Target className="size-3.5" aria-hidden="true" />{t("onboarding.chat.chipGoals")}</li>
                  <li><BookOpen className="size-3.5" aria-hidden="true" />{t("onboarding.chat.chipLearning")}</li>
                  <li><FastForward className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />{t("onboarding.chat.chipSkip")}</li>
                </ul>
                <button type="button" onClick={() => void chat.send(t("onboarding.chat.kickoff"))} className="onb-empty-start">
                  {t("onboarding.chat.start")}<ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
                </button>
              </div>
            }
          />
          </div>
        </>
      )}
    </div>
  )
}
