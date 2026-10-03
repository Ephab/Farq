// Rich UI "elements" Hermes can attach to a chat message (`ChatMessageMetadata.elements`).
// Phase A (this file): local, typed, UI-only — no network calls, no backend. Phase B mirrors
// this exact shape in Pydantic models server-side (see services/api/app/chat_ui.py for the
// existing waypoint_ask_question staging pattern) and a new `waypoint_show_element` tool stages
// one of these into `run.ui_json` the same way. Keep the size limits below in sync with the
// Pydantic validators when that lands, so a misbehaving model can't ship a mile-long card.

export type ChatElementId = string

export type QuizQuestionType = "mcq" | "true_false" | "short_answer"

export interface QuizQuestionSpec {
  id: string
  type: QuizQuestionType
  /** The question text. */
  stem: string
  /** mcq: 2-4 options. true_false: omit (UI supplies True/False). short_answer: omit. */
  options?: string[]
  /** mcq: must exactly match one entry in `options`. true_false: "True" | "False". */
  answer: string
  /** Shown after the student answers. */
  explanation?: string
  difficulty?: "easy" | "medium" | "hard"
  /** Optional per-question countdown, in seconds (e.g. 180-300 for "3-5 min"). */
  time_limit_s?: number
}

/** A self-contained quiz card. Size limit: <=10 questions (keeps one card scannable and
 *  keeps a future generation call cheap/fast). */
export interface QuizElement {
  kind: "quiz"
  id: ChatElementId
  title?: string
  /** 1-10 questions. */
  questions: QuizQuestionSpec[]
}

/** A standalone circular countdown. Size limit: 5s-3600s. */
export interface TimerElement {
  kind: "timer"
  id: ChatElementId
  label?: string
  duration_s: number
  /** Seconds remaining at which the ring switches to the warning color. Defaults to 20% of duration. */
  warning_s?: number
  autostart?: boolean
}

export interface ProgressStep {
  id: string
  label: string
  done?: boolean
}

/** Multi-step task/plan progress. Size limit: <=12 steps when `style: "steps"`. */
export interface ProgressElement {
  kind: "progress"
  id: ChatElementId
  title?: string
  style?: "ring" | "steps"
  current: number
  total: number
  /** Only used by style: "steps"; <=12 entries. */
  steps?: ProgressStep[]
}

export interface Flashcard {
  id: string
  front: string
  back: string
}

/** Size limit: <=20 cards. */
export interface FlashcardsElement {
  kind: "flashcards"
  id: ChatElementId
  title?: string
  cards: Flashcard[]
}

export interface ChecklistItem {
  id: string
  label: string
  done?: boolean
}

/** Local-state only (ticking a box never writes a StudentFact or any backend state).
 *  Size limit: <=15 items. */
export interface ChecklistElement {
  kind: "checklist"
  id: ChatElementId
  title?: string
  items: ChecklistItem[]
}

/** Plain table, or a side-by-side comparison when `highlight_column` marks the
 *  recommended column. Size limit: <=6 columns, <=20 rows. */
export interface TableElement {
  kind: "table"
  id: ChatElementId
  title?: string
  columns: string[]
  rows: string[][]
  highlight_column?: number
}

export type CalloutTone = "tip" | "warning" | "info" | "success"

/** Size limit: body <=600 chars (it's a callout, not an essay). */
export interface CalloutElement {
  kind: "callout"
  id: ChatElementId
  tone: CalloutTone
  title?: string
  body: string
}

/** Size limit: code <=4000 chars. Syntax-plain (no highlighting), just a readable, copyable block. */
export interface CodeElement {
  kind: "code"
  id: ChatElementId
  language?: string
  code: string
  caption?: string
}

export type ChatElement =
  | QuizElement
  | TimerElement
  | ProgressElement
  | FlashcardsElement
  | ChecklistElement
  | TableElement
  | CalloutElement
  | CodeElement

export type ChatElementKind = ChatElement["kind"]
