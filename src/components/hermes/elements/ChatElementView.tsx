"use client"

import type { ChatElement } from "@/components/hermes/elements/types"
import { QuizCard } from "@/components/hermes/elements/views/QuizCard"
import { TimerView } from "@/components/hermes/elements/views/TimerView"
import { ProgressView } from "@/components/hermes/elements/views/ProgressView"
import { FlashcardsView } from "@/components/hermes/elements/views/FlashcardsView"
import { ChecklistView } from "@/components/hermes/elements/views/ChecklistView"
import { TableView } from "@/components/hermes/elements/views/TableView"
import { CalloutView } from "@/components/hermes/elements/views/CalloutView"
import { CodeView } from "@/components/hermes/elements/views/CodeView"

/** Dispatches one `ChatElement` to its renderer. Unknown kinds (a future server
 *  sending something this build doesn't understand yet) render nothing rather
 *  than crash the thread. */
export function ChatElementView({ element }: { element: ChatElement }) {
  switch (element.kind) {
    case "quiz": return <QuizCard element={element} />
    case "timer": return <TimerView element={element} />
    case "progress": return <ProgressView element={element} />
    case "flashcards": return <FlashcardsView element={element} />
    case "checklist": return <ChecklistView element={element} />
    case "table": return <TableView element={element} />
    case "callout": return <CalloutView element={element} />
    case "code": return <CodeView element={element} />
    default: return null
  }
}
