"use client"

import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useEffect, useState } from "react"
import { Check, X } from "lucide-react"
import { CoachLoader } from "@/components/hermes/CoachLoader"
import { EASE_OUT } from "@/lib/ease"
import { useI18n, type MessageKey } from "@/lib/i18n/context"

/** Live state of a chat run, from the API's run-status stream (see app.hermes.RunProgress).
 *  The student view only ever reads `phase`/`tool`/`steps`/`notice` off this — `model`,
 *  `tokens`, `tps` and `preview` are carried for other call sites (dev tooling) but must
 *  never be surfaced here; Phase B should stop sending them to this audience at all. */
export interface RunProgress {
  phase: "starting" | "queued" | "thinking" | "tool" | "writing"
  tool: string | null
  model: string | null
  started_at: number
  phase_since: number
  tokens: number
  tps: number | null
  preview: string
  steps: { tool: string; seconds: number; ok: boolean }[]
  notice: string | null
  attempt: number
  server_now: number
}

/** A run that has said nothing for this long gets a reassuring note (the server switches model at 45 s). */
const SLOW_SECONDS = 15

const TOOL_KEYS: Record<string, MessageKey> = {
  waypoint_get_student_profile: "coach.progress.tools.profile",
  waypoint_get_student_context: "coach.progress.tools.profile",
  waypoint_get_active_roadmap: "coach.progress.tools.roadmap",
  waypoint_record_explicit_fact: "coach.progress.tools.fact",
  waypoint_remember: "coach.progress.tools.remember",
  waypoint_forget: "coach.progress.tools.remember",
  waypoint_ask_question: "coach.progress.tools.question",
  waypoint_ready_to_generate: "coach.progress.tools.ready",
  waypoint_submit_roadmap_proposal: "coach.progress.tools.proposal",
  waypoint_find_hackathons: "coach.progress.tools.hackathons",
  waypoint_find_coop_companies: "coach.progress.tools.coop",
  waypoint_find_coop_postings: "coach.progress.tools.coop",
  waypoint_get_coop_target: "coach.progress.tools.coop",
  waypoint_search_mail: "coach.progress.tools.mail",
  waypoint_read_mail: "coach.progress.tools.mail",
  waypoint_collab_list_classes: "coach.progress.tools.collab",
  waypoint_collab_get_class: "coach.progress.tools.collab",
  waypoint_collab_my_discovery: "coach.progress.tools.collab",
  waypoint_collab_find_teammates: "coach.progress.tools.collab",
  waypoint_collab_find_teams: "coach.progress.tools.collab",
  waypoint_collab_read_candidate: "coach.progress.tools.collab",
  waypoint_collab_draft_profile: "coach.progress.tools.collab",
  waypoint_get_project: "coach.progress.tools.project",
  waypoint_submit_project_refinement: "coach.progress.tools.project",
  waypoint_index_folder: "coach.progress.tools.folder",
  waypoint_scan_folder: "coach.progress.tools.folder",
  waypoint_read_project_file: "coach.progress.tools.folder",
  skill_view: "coach.progress.tools.skill",
  // Speculative Phase B tools (quiz/study elements) — harmless to map ahead of time.
  waypoint_get_quiz_history: "coach.progress.tools.quizHistory",
  waypoint_generate_quiz_questions: "coach.progress.tools.generateQuestions",
  waypoint_show_element: "coach.progress.tools.generateQuestions",
}

function useToolLabel() {
  const { t } = useI18n()
  return (tool: string) => {
    const key = TOOL_KEYS[tool] ?? (tool.startsWith("waypoint_blackboard") ? "coach.progress.tools.courses" : null)
    return key ? t(key) : t("coach.progress.tools.generic", { tool: tool.replace(/^waypoint_/, "").replaceAll("_", " ") })
  }
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

/** What Hermes is doing right now: a pulsing orb, a short cross-fading status title, and
 *  the finished steps collapsed into a subtle list. No model name, token count, speed, or
 *  raw/reasoning text ever reaches this view — the student only sees plain-language intent. */
export function RunProgressCard({ progress, receivedAt }: { progress: RunProgress; receivedAt: number }) {
  const { t } = useI18n()
  const toolLabel = useToolLabel()
  const reduce = useReducedMotion()
  const now = useNow(true)
  // Server clock at this moment: the last report's server time plus what passed here since.
  const serverNow = progress.server_now + (now - receivedAt) / 1000
  const inPhase = Math.max(0, serverNow - progress.phase_since)
  const activity = progress.phase === "tool" ? "tool" as const : progress.phase === "writing" ? "writing" as const : "thinking" as const
  const label = progress.phase === "tool" && progress.tool
    ? toolLabel(progress.tool)
    : t(`coach.progress.phase.${progress.phase}`)
  const silent = (progress.phase === "thinking" || progress.phase === "starting") && inPhase >= SLOW_SECONDS

  return (
    <div className="run-progress" aria-live="polite">
      <CoachLoader activity={activity} label={label} />

      {progress.steps.length ? (
        <ul className="run-progress-steps" aria-label={t("coach.progress.stepsLabel")}>
          <AnimatePresence initial={false}>
            {progress.steps.map((step, index) => (
              <motion.li
                key={`${step.tool}-${index}`}
                initial={reduce ? false : { opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25, ease: EASE_OUT }}
              >
                {step.ok ? <Check size={11} className="run-progress-step-ok" aria-hidden="true" /> : <X size={11} className="run-progress-step-bad" aria-hidden="true" />}
                <span>{toolLabel(step.tool)}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : null}

      {silent ? (
        <p className="run-progress-slow">{t("coach.progress.slow")}</p>
      ) : null}
    </div>
  )
}
