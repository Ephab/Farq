"use client"

import { useEffect, useState } from "react"
import { ChatThreadView } from "@/components/hermes/ChatThreadView"
import type { ChatMessage, LiveProgress } from "@/components/hermes/use-hermes-chat"
import type { RunProgress } from "@/components/hermes/RunProgress"
import { MOCK_QUIZ_ELEMENT, MOCK_SHOWCASE_ELEMENTS } from "@/components/hermes/elements/fixtures"

/** Dev-only preview (`?mock=elements`) of the chat elements palette, the redesigned loader,
 *  and the word-by-word reply reveal — all driven through the real ChatThreadView, so this
 *  is an honest demo rather than a separate mockup. Never reachable outside import.meta.env.DEV
 *  (see the gate in HermesCoach.tsx) and makes no network calls. */

let seq = 0
const nextId = () => `mock-${++seq}`
const now = () => new Date().toISOString()

function makeProgress(tool: string): LiveProgress {
  const value: RunProgress = {
    phase: "tool",
    tool,
    model: null,
    started_at: Date.now() / 1000 - 1,
    phase_since: Date.now() / 1000,
    tokens: 0,
    tps: null,
    preview: "",
    steps: [],
    notice: null,
    attempt: 1,
    server_now: Date.now() / 1000,
  }
  return { value, receivedAt: Date.now() }
}

const LOADER_TOOLS = ["waypoint_blackboard_courses", "waypoint_get_quiz_history", "waypoint_generate_quiz_questions"]

export function MockElementsThread() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<LiveProgress | null>(null)

  useEffect(() => {
    const timers: number[] = []
    const at = (ms: number, fn: () => void) => { timers.push(window.setTimeout(fn, ms)) }

    at(300, () => {
      setMessages([{ id: nextId(), role: "user", content: "Quiz me on probability, 5 questions", created_at: now() }])
      setBusy(true)
      setProgress(makeProgress(LOADER_TOOLS[0]))
    })
    at(1500, () => setProgress(makeProgress(LOADER_TOOLS[1])))
    at(2800, () => setProgress(makeProgress(LOADER_TOOLS[2])))
    at(4200, () => {
      setBusy(false)
      setProgress(null)
      setMessages((cur) => [...cur, {
        id: nextId(),
        role: "assistant",
        content: "Here's your probability quiz — five questions, mixed types, a couple with a timer. Good luck!",
        metadata: { elements: [MOCK_QUIZ_ELEMENT] },
        created_at: now(),
      }])
    })
    at(5200, () => { setBusy(true); setProgress(null) })
    at(6400, () => {
      setBusy(false)
      setMessages((cur) => [...cur, {
        id: nextId(),
        role: "assistant",
        content: "And here's the rest of the element palette I can drop into a reply: a study plan, a focus timer, flashcards, a checklist, a comparison table, a tip callout, and a code block.",
        metadata: { elements: MOCK_SHOWCASE_ELEMENTS },
        created_at: now(),
      }])
    })

    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [])

  return (
    <ChatThreadView
      messages={messages}
      busy={busy}
      stage="coach.stage.working"
      progress={progress}
      error={null}
      onSend={() => undefined}
      onInteraction={() => undefined}
      onRetry={() => undefined}
      onEditResend={() => undefined}
      onStop={() => undefined}
      placeholder="This is a local preview — sending is disabled"
      disabled
    />
  )
}
