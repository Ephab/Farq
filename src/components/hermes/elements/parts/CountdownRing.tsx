"use client"

import { useEffect, useRef, useState } from "react"
import { useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, "0")}`
}

/** A circular countdown ring with an mm:ss readout. Local-only: ticks with a plain interval,
 *  never phones home. Switches to the warning color inside `warningS`, and calls `onExpire`
 *  once when it reaches zero. */
export function CountdownRing({
  durationS,
  warningS,
  running = true,
  size = 64,
  onExpire,
}: {
  durationS: number
  warningS?: number
  running?: boolean
  size?: number
  onExpire?: () => void
}) {
  const [remaining, setRemaining] = useState(durationS)
  const reduce = useReducedMotion()
  const expiredRef = useRef(false)

  useEffect(() => {
    setRemaining(durationS)
    expiredRef.current = false
  }, [durationS])

  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => {
      setRemaining((value) => (value <= 0 ? value : value - 1))
    }, 1000)
    return () => window.clearInterval(id)
  }, [running])

  useEffect(() => {
    if (remaining === 0 && !expiredRef.current) {
      expiredRef.current = true
      onExpire?.()
    }
  }, [remaining, onExpire])

  const warn = warningS ?? Math.max(5, Math.round(durationS * 0.2))
  const low = remaining <= warn
  const expired = remaining <= 0
  const R = 46
  const circ = 2 * Math.PI * R
  const pct = durationS > 0 ? remaining / durationS : 0

  return (
    <div
      className={cn("countdown-ring", low && "countdown-ring-low", expired && "countdown-ring-expired")}
      style={{ width: size, height: size }}
      role="timer"
      aria-live={low ? "assertive" : "off"}
    >
      <svg viewBox="0 0 100 100" className="countdown-ring-svg">
        <circle cx="50" cy="50" r={R} fill="none" strokeWidth="8" className="countdown-ring-track" />
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          className="countdown-ring-fill"
          strokeDasharray={circ}
          strokeDashoffset={circ - circ * pct}
          style={{ transition: reduce ? "none" : "stroke-dashoffset 1s linear" }}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <span className="countdown-ring-label tabular-nums">{formatClock(remaining)}</span>
    </div>
  )
}
