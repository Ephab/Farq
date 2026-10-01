import type { CSSProperties } from "react"
import "./coach-activity-icon.css"

/** What the coach is doing right now; each state moves differently. */
export type CoachActivity = "thinking" | "writing" | "tool"

/**
 * Waypoint's own activity glyph: an eight-point compass star (four long
 * cardinal points, four short diagonal ones) with a bright centre. It spins
 * and pulses in the theme accent while the coach works. Decorative: the
 * visible status label next to it carries the meaning, so it is aria-hidden.
 */
export function CoachActivityIcon({ activity = "thinking", size = 18, className }: { activity?: CoachActivity; size?: number; className?: string }) {
  return (
    <svg
      className={`coach-activity coach-activity-${activity}${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size } as CSSProperties}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <g className="coach-activity-spin">
        <path className="coach-activity-minor" d="M12 1.5 L14 10 L22.5 12 L14 14 L12 22.5 L10 14 L1.5 12 L10 10 Z" transform="rotate(45 12 12) translate(12 12) scale(0.66) translate(-12 -12)" />
        <path className="coach-activity-major" d="M12 1.5 L14 10 L22.5 12 L14 14 L12 22.5 L10 14 L1.5 12 L10 10 Z" />
      </g>
      <circle className="coach-activity-core" cx="12" cy="12" r="1.7" />
    </svg>
  )
}
