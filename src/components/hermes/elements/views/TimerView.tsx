"use client"

import { useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { Pause, Play, RotateCcw } from "lucide-react"
import { EASE_OUT } from "@/lib/ease"
import { useI18n } from "@/lib/i18n/context"
import type { TimerElement } from "@/components/hermes/elements/types"
import { CountdownRing } from "@/components/hermes/elements/parts/CountdownRing"

export function TimerView({ element }: { element: TimerElement }) {
  const { t } = useI18n()
  const reduce = useReducedMotion()
  const [running, setRunning] = useState(element.autostart ?? true)
  const [expired, setExpired] = useState(false)
  const [resetKey, setResetKey] = useState(0)

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT }}
      className="chat-element timer-element"
    >
      <CountdownRing
        key={resetKey}
        durationS={element.duration_s}
        warningS={element.warning_s}
        running={running && !expired}
        size={72}
        onExpire={() => setExpired(true)}
      />
      <div className="timer-element-body">
        <p className="timer-element-label" dir="auto">{element.label ?? t("coach.elements.timer.label")}</p>
        {expired ? (
          <p className="timer-element-up">{t("coach.elements.timer.timeUp")}</p>
        ) : (
          <div className="timer-element-controls">
            <button type="button" className="button secondary small" onClick={() => setRunning((r) => !r)}>
              {running ? <Pause size={13} /> : <Play size={13} />}
              {running ? t("coach.elements.timer.pause") : t("coach.elements.timer.start")}
            </button>
            <button
              type="button"
              className="button secondary small"
              onClick={() => { setExpired(false); setRunning(true); setResetKey((k) => k + 1) }}
            >
              <RotateCcw size={13} /> {t("coach.elements.timer.reset")}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  )
}
