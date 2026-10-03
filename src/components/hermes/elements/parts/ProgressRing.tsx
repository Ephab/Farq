"use client"

import { motion, useReducedMotion } from "motion/react"
import { EASE_OUT } from "@/lib/ease"

/** Small "n / total" progress ring, used by the quiz card header and the standalone
 *  progress element. Purely presentational — current/total come from the caller. */
export function ProgressRing({ current, total, size = 44 }: { current: number; total: number; size?: number }) {
  const reduce = useReducedMotion()
  const R = 40
  const circ = 2 * Math.PI * R
  const pct = total > 0 ? Math.min(1, current / total) : 0
  return (
    <div className="progress-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="progress-ring-svg">
        <circle cx="50" cy="50" r={R} fill="none" strokeWidth="10" className="progress-ring-track" />
        <motion.circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          className="progress-ring-fill"
          strokeDasharray={circ}
          initial={reduce ? false : { strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ - circ * pct }}
          transition={{ duration: reduce ? 0 : 0.55, ease: EASE_OUT }}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <span className="progress-ring-label tabular-nums">{current}/{total}</span>
    </div>
  )
}
