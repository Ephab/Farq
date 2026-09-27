"use client"

import { motion } from "motion/react"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

export type PortalPhase = "loading" | "zoom"

interface CoachPortalIntroProps {
  phase: PortalPhase
  progress: number
  onSkip: () => void
}

const LETTERS = ["C", "o", "a", "c", "h"]

// One continuous keyframed dive: the -8deg tilt resolves straight into the
// massive zoom inside a single animation, so velocity never hits zero
// mid-flight (two chained animations caused the old stop-then-go hitch).
// 12x already covers ~3 viewports; anything larger only adds raster churn.
const ZOOM_DURATION = 1.3

/** Full-bleed theme-aware loading stage. The parent scales this whole
 *  block up to create the "going inside it" portal moment. */
export function CoachPortalIntro({ phase, progress, onSkip }: CoachPortalIntroProps) {
  const zooming = phase === "zoom"
  return (
    <motion.div
      role="status"
      aria-live="polite"
      aria-label="Loading Coach"
      onClick={onSkip}
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.4, ease: EASE_OUT } }}
      className="absolute inset-0 z-30 grid cursor-pointer place-items-center overflow-hidden bg-background"
    >
      {/* Ambient orb + dot grain fade out the moment the dive starts so the
        heavy zoom frames carry nothing but the word itself. */}
      <motion.span
        aria-hidden="true"
        initial={{ opacity: 1, scale: 1 }}
        animate={zooming ? { opacity: 0, scale: 1.25 } : { opacity: 1, scale: [1, 1.08, 1] }}
        transition={
          zooming
            ? { duration: 0.5, ease: EASE_OUT }
            : { duration: 6, repeat: Infinity, ease: "easeInOut" }
        }
        className="pointer-events-none absolute size-[440px] rounded-full bg-primary/10 blur-3xl will-change-transform"
      />
      <motion.span
        aria-hidden="true"
        initial={{ opacity: 0.6 }}
        animate={{ opacity: zooming ? 0 : 0.6 }}
        transition={{ duration: 0.5, ease: EASE_OUT }}
        className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black,transparent_78%)]"
        style={{
          backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />

      <motion.div
        initial={{ scale: 1, rotate: 0 }}
        animate={
          zooming
            ? { scale: [1, 1.06, 12], rotate: [0, -8, 0] }
            : { scale: 1, rotate: 0 }
        }
        transition={
          zooming
            ? { duration: ZOOM_DURATION, times: [0, 0.25, 1], ease: [EASE_OUT, EASE_OUT] }
            : { duration: 0.25, ease: EASE_OUT }
        }
        className="relative flex flex-col items-center px-6 will-change-transform"
      >
        <div
          aria-hidden="true"
          className="flex overflow-hidden text-[clamp(72px,14vw,180px)] font-bold leading-none tracking-[-0.04em] text-foreground"
        >
          {LETTERS.map((letter, index) => (
            <span key={index} className="inline-flex overflow-hidden pb-[0.06em]">
              <motion.span
                initial={{ y: "115%", opacity: 0 }}
                animate={{ y: "0%", opacity: 1 }}
                transition={{ duration: 0.7, ease: EASE_OUT, delay: 0.15 + index * 0.06 }}
                className="inline-block will-change-transform"
              >
                {letter}
              </motion.span>
            </span>
          ))}
        </div>

        <motion.div
          animate={{ opacity: phase === "loading" ? 1 : 0, y: phase === "loading" ? 0 : 8 }}
          transition={{ duration: 0.3, ease: EASE_OUT }}
          className={cn("mt-8 flex flex-col items-center gap-3", phase !== "loading" && "pointer-events-none")}
        >
          <div
            className="h-[3px] w-52 max-w-[60vw] overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Loading Coach"
          >
            <div
              className="h-full w-full origin-left rounded-full bg-primary"
              style={{ transform: `scaleX(${Math.max(0, Math.min(100, progress)) / 100})` }}
            />
          </div>
          <p className="text-xs font-medium text-muted-foreground">
            Preparing your coach{" "}
            <span className="tabular-nums">{Math.max(0, Math.min(100, progress))}%</span>
          </p>
        </motion.div>
      </motion.div>

      <p className="absolute bottom-6 text-[11px] font-medium text-muted-foreground">
        Click anywhere or press Esc to skip
      </p>
    </motion.div>
  )
}
