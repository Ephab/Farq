"use client"

import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { CoachActivityIcon, type CoachActivity } from "@/components/hermes/CoachActivityIcon"
import { EASE_OUT } from "@/lib/ease"

/** The coach's "what I'm doing right now" row: a pulsing orb plus a short, plain-language
 *  title that cross-fades whenever `label` changes. Never shows model names, tokens, or raw
 *  reasoning/preview text — those must be stripped before they reach this component. */
export function CoachLoader({ activity, label }: { activity: CoachActivity; label: string }) {
  const reduce = useReducedMotion()
  return (
    <div className="coach-loader" role="status">
      <span className="coach-loader-orb">
        <CoachActivityIcon activity={activity} size={20} />
      </span>
      <AnimatePresence mode="wait">
        <motion.span
          key={label}
          initial={reduce ? false : { opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -5 }}
          transition={{ duration: 0.3, ease: EASE_OUT }}
          className="coach-loader-label"
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </div>
  )
}
