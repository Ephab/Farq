"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Bot, Check, LoaderCircle, Sparkles, Wand2 } from "lucide-react"
import { ChatThreadView } from "@/components/hermes/ChatThreadView"
import { useHermesChat } from "@/components/hermes/use-hermes-chat"
import { RoadmapCanvas } from "@/components/roadmap/RoadmapCanvas"
import { streamStagedRoadmap, type StagedPlan, type StagedSnapshot } from "@/hooks/use-staged-generation"
import type { NodeStatus } from "@/data/computer-vision-roadmap"
import { api, hermesRequestParts, type StudentProfile } from "@/lib/farq-api"

const KICKOFF = "Hi Hermes! I've connected my records. Ask me what you still need to know to build my roadmap."

interface OnboardingChatProps {
  profile: StudentProfile
  onBack: () => void
  onGenerated: () => void
}

export function OnboardingChat({ profile, onBack, onGenerated }: OnboardingChatProps) {
  const chat = useHermesChat(profile.thread_id)
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

  const generate = async () => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setGenerating(true); setGenError(null); setPlan(null); setSnapshot(null)
    setDoneStageIds(new Set()); setActiveStageId(null); setSelectedId(null)
    try {
      const { body, headers } = hermesRequestParts()
      await streamStagedRoadmap(profile.student_id, body, headers, controller.signal, {
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
      })
    } catch (reason) {
      if (controller.signal.aborted) return
      // Fall back to the whole-roadmap endpoint so a dropped stream never blocks onboarding.
      try {
        const { body, headers } = hermesRequestParts()
        await api(`/api/students/${profile.student_id}/onboarding/generate`, { method: "POST", body: JSON.stringify(body), headers })
        onGenerated()
      } catch (fallbackReason) {
        setGenError(fallbackReason instanceof Error ? fallbackReason.message : reason instanceof Error ? reason.message : "Hermes could not generate your roadmap")
        setGenerating(false)
      }
    }
  }

  const answered = chat.messages.filter((message) => message.role === "user").length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-4 py-3 sm:px-8"><div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3">
        <span className="grid size-9 place-items-center rounded-2xl bg-primary text-primary-foreground"><Bot className="size-4" /></span>
        <div className="min-w-0 flex-1"><h1 className="text-sm font-semibold">A few quick questions</h1><p className="text-xs text-muted-foreground">Hermes only asks about what your records didn't answer.</p></div>
        <button type="button" onClick={onBack} disabled={generating} className="h-9 rounded-xl border border-border px-3 text-xs disabled:opacity-40">Back to review</button>
        <button type="button" onClick={() => void generate()} disabled={generating || chat.busy} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-40">
          {generating ? <LoaderCircle className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}Generate my roadmap
        </button>
      </div></div>
      {generating ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-border px-4 py-3 sm:px-8">
            <div className="mx-auto w-full max-w-3xl">
              <p className="text-sm font-medium">
                {plan ? `${plan.title} — stage ${doneStageIds.size + 1} of ${plan.stages.length}` : "Planning your stages…"}
              </p>
              {plan ? (
                <ol className="mt-2 flex flex-wrap gap-1.5" aria-label="Stage progress">
                  {plan.stages.map((stage) => {
                    const done = doneStageIds.has(stage.id)
                    const active = stage.id === activeStageId
                    return (
                      <li key={stage.id} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${done ? "border-emerald-500/40 bg-emerald-500/10" : active ? "border-primary/40 bg-primary/5" : "border-border text-muted-foreground"}`}>
                        {done ? <Check className="size-3" /> : active ? <LoaderCircle className="size-3 animate-spin" /> : null}
                        {stage.title.replace(/^Stage \d+ · /, "")}
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />Reading your confirmed evidence and choosing stages…</p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">Each finished stage appears below immediately; connections are re-checked before the next one starts.</p>
            </div>
          </div>
          <div className="relative flex min-h-[50svh] min-h-0 flex-1 flex-col">
            {snapshot ? (
              <RoadmapCanvas
                nodes={snapshot.nodes}
                stages={snapshot.stages}
                statuses={statuses}
                selectedId={selectedId}
                dimmedIds={new Set()}
                onSelect={setSelectedId}
                onToggleDone={() => undefined}
              />
            ) : (
              <div className="grid flex-1 place-items-center p-8 text-center">
                <div><LoaderCircle className="mx-auto size-6 animate-spin text-primary" /><p className="mt-3 text-sm font-medium">Building your first stage…</p><p className="mt-1 text-xs text-muted-foreground">This usually takes under a minute.</p></div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {genError ? <div className="mx-auto mt-3 w-full max-w-3xl rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{genError}</div> : null}
          <ChatThreadView
            messages={chat.messages}
            busy={chat.busy}
            stage={chat.stage}
            error={chat.error}
            onSend={(text) => void chat.send(text)}
            onInteraction={(interaction, displayText) => void chat.sendInteraction(interaction, displayText)}
            onRetry={() => { chat.refresh().catch(() => undefined) }}
            onEditResend={(messageId, text) => void chat.editAndResend(messageId, text)}
            onStop={() => void chat.stop()}
            placeholder={answered ? "Answer Hermes, or press Generate when you're ready…" : "Say hi to start…"}
            afterMessages={chat.messages.length > 0 ? (
              <div className="flex justify-center pt-1">
                <button type="button" onClick={() => void generate()} disabled={generating || chat.busy} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-40">
                  {generating ? <LoaderCircle className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}Generate my roadmap
                </button>
              </div>
            ) : undefined}
            empty={<div className="rounded-3xl border border-dashed border-border p-8 text-center"><Sparkles className="mx-auto size-7 text-primary" /><h2 className="mt-3 font-semibold">Hermes has read what you confirmed</h2><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Answer up to five short questions about your goals and how you like to learn. You can skip straight to generating at any time.</p><button type="button" onClick={() => void chat.send(KICKOFF)} className="mt-5 h-9 rounded-xl bg-primary px-4 text-xs font-medium text-primary-foreground">Start the chat</button></div>}
          />
        </>
      )}
    </div>
  )
}
