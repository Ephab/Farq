"use client"

import { useEffect, useRef, useState } from "react"
import { Bot, LoaderCircle, Sparkles, Wand2 } from "lucide-react"
import { ChatThreadView } from "@/components/hermes/ChatThreadView"
import { useHermesChat } from "@/components/hermes/use-hermes-chat"
import { api, hermesRequestParts, type StudentProfile } from "@/lib/farq-api"

const KICKOFF = "Hi Hermes! I've connected my records. Ask me what you still need to know to build my roadmap."
const GENERATING_STAGES = ["Reading your confirmed evidence", "Choosing stages for your field", "Placing topics and prerequisites", "Checking what you've already mastered", "Validating the roadmap"]

interface OnboardingChatProps {
  profile: StudentProfile
  onBack: () => void
  onGenerated: () => void
}

export function OnboardingChat({ profile, onBack, onGenerated }: OnboardingChatProps) {
  const chat = useHermesChat(profile.thread_id)
  const [generating, setGenerating] = useState(profile.onboarding_status === "generating")
  const [tick, setTick] = useState(0)
  const [genError, setGenError] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current) }, [])

  const generate = async () => {
    setGenerating(true); setGenError(null); setTick(0)
    timer.current = window.setInterval(() => setTick((value) => value + 1), 6000)
    try {
      const { body, headers } = hermesRequestParts()
      await api(`/api/students/${profile.student_id}/onboarding/generate`, { method: "POST", body: JSON.stringify(body), headers })
      onGenerated()
    } catch (reason) {
      setGenError(reason instanceof Error ? reason.message : "Hermes could not generate your roadmap")
      setGenerating(false)
    } finally {
      if (timer.current) window.clearInterval(timer.current)
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
        <div className="grid flex-1 place-items-center p-8 text-center">
          <div><LoaderCircle className="mx-auto size-6 animate-spin text-primary" /><p className="mt-3 text-sm font-medium">{GENERATING_STAGES[Math.min(tick, GENERATING_STAGES.length - 1)]}…</p><p className="mt-1 text-xs text-muted-foreground">This usually takes under a minute.</p></div>
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
            onRetry={() => { chat.refresh().catch(() => undefined) }}
            placeholder={answered ? "Answer Hermes, or press Generate when you're ready…" : "Say hi to start…"}
            empty={<div className="rounded-3xl border border-dashed border-border p-8 text-center"><Sparkles className="mx-auto size-7 text-primary" /><h2 className="mt-3 font-semibold">Hermes has read what you confirmed</h2><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Answer up to five short questions about your goals and how you like to learn. You can skip straight to generating at any time.</p><button type="button" onClick={() => void chat.send(KICKOFF)} className="mt-5 h-9 rounded-xl bg-primary px-4 text-xs font-medium text-primary-foreground">Start the chat</button></div>}
          />
        </>
      )}
    </div>
  )
}
