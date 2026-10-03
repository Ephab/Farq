"use client"

import { motion, useReducedMotion } from "motion/react"
import { Check } from "lucide-react"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n/context"
import type { ProgressElement } from "@/components/hermes/elements/types"
import { ProgressRing } from "@/components/hermes/elements/parts/ProgressRing"

export function ProgressView({ element }: { element: ProgressElement }) {
  const { t } = useI18n()
  const reduce = useReducedMotion()
  const style = element.style ?? (element.steps?.length ? "steps" : "ring")

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT }}
      className="chat-element progress-element"
    >
      {element.title ? <p className="progress-element-title" dir="auto">{element.title}</p> : null}
      {style === "ring" || !element.steps?.length ? (
        <div className="progress-element-ring-row">
          <ProgressRing current={element.current} total={element.total} size={52} />
          <span className="progress-element-sub">{t("coach.elements.progress.stepOf", { current: element.current, total: element.total })}</span>
        </div>
      ) : (
        <ol className="progress-element-steps">
          {element.steps.slice(0, 12).map((step, i) => {
            const done = step.done ?? i < element.current
            const active = !done && i === element.current
            return (
              <motion.li
                key={step.id}
                initial={reduce ? false : { opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, ease: EASE_OUT, delay: reduce ? 0 : i * 0.04 }}
                className={cn("progress-step", done && "progress-step-done", active && "progress-step-active")}
              >
                <span className="progress-step-mark" aria-hidden="true">{done ? <Check size={12} /> : i + 1}</span>
                <span dir="auto">{step.label}</span>
              </motion.li>
            )
          })}
        </ol>
      )}
    </motion.div>
  )
}
