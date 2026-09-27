"use client"

import { motion } from "motion/react"
import { EASE_OUT } from "@/lib/ease"
import { useI18n } from "@/lib/i18n/context"

export type PortalPhase = "loading" | "leave"

interface CoachPortalIntroProps {
  phase: PortalPhase
  onSkip: () => void
  /** Divides every duration and delay — Hermes Coach runs it at 1.6. */
  speed?: number
  /** Word spelled across the stage. Defaults to "Coach". */
  word?: string
  /** "gentle" softens the exit (smaller lift, dimmer orb) for app startup. */
  tone?: "standard" | "gentle"
}

// Rise-and-dissolve: the loading stage plays, the ambience bows out, the
// letters lift and fade in stagger, then the whole veil drifts up and
// crossfades to the page underneath. Transform + opacity only, so the exit
// stays on the compositor at 60fps. Single-segment animations throughout,
// so velocity never hits zero mid-flight.
const LETTER_OUT_DURATION = 0.3
const LETTER_OUT_STAGGER = 0.035
const VEIL_DELAY = 0.22
const VEIL_DURATION = 0.65
const VEIL_LIFT = -32

/** Full-bleed theme-aware loading stage that dissolves into the page. */
export function CoachPortalIntro({ phase, onSkip, speed = 1, word, tone = "standard" }: CoachPortalIntroProps) {
  const { t, dir } = useI18n()
  const title = word ?? t("common.coachName")
  const leaving = phase === "leave"
  const gentle = tone === "gentle"
  const d = (seconds: number) => seconds / speed
  // Keep connected Arabic letters together during the reveal animation.
  const letters = dir === "rtl" ? [title] : Array.from(title)
  return (
    <motion.div
      role="status"
      aria-live="polite"
      aria-label={t("common.introLoading", { name: title })}
      onClick={onSkip}
      initial={{ opacity: 1, y: 0 }}
      animate={leaving ? { opacity: 0, y: gentle ? -12 : VEIL_LIFT } : { opacity: 1, y: 0 }}
      transition={
        leaving
          ? { duration: d(gentle ? 0.9 : VEIL_DURATION), delay: d(gentle ? 0.2 : VEIL_DELAY), ease: EASE_OUT }
          : { duration: d(0.3), ease: EASE_OUT }
      }
      exit={{ opacity: 0, transition: { duration: d(0.25), ease: EASE_OUT } }}
      className="absolute inset-0 z-30 grid cursor-pointer place-items-center overflow-hidden bg-background"
    >
      {/* Ambient orb + dot grain bow out first so the veil carries a clean
        field with just the lifting word. */}
      <motion.span
        aria-hidden="true"
        initial={{ opacity: 1, scale: 1 }}
        animate={leaving ? { opacity: 0, scale: 1.25 } : { opacity: 1, scale: [1, 1.08, 1] }}
        transition={
          leaving
            ? { duration: d(0.3), ease: EASE_OUT }
            : { duration: gentle ? 8 : 6, repeat: Infinity, ease: "easeInOut" }
        }
        className={`pointer-events-none absolute size-[440px] rounded-full blur-3xl will-change-transform ${gentle ? "bg-primary/5" : "bg-primary/10"}`}
      />
      <motion.span
        aria-hidden="true"
        initial={{ opacity: gentle ? 0.4 : 0.6 }}
        animate={{ opacity: leaving ? 0 : gentle ? 0.4 : 0.6 }}
        transition={{ duration: d(0.3), ease: EASE_OUT }}
        className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black,transparent_78%)]"
        style={{
          backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />

      <div className="relative flex flex-col items-center px-6">
        <div
          aria-hidden="true"
          className="flex overflow-hidden text-[clamp(72px,14vw,180px)] font-bold leading-none tracking-[-0.04em] text-foreground"
        >
          {letters.map((letter, index) => (
            <span key={index} className="inline-flex overflow-hidden pb-[0.06em]">
              <motion.span
                initial={{ y: "115%", opacity: 0 }}
                animate={leaving ? { y: gentle ? "-18%" : "-70%", opacity: 0 } : { y: "0%", opacity: 1 }}
                transition={
                  leaving
                    ? {
                        duration: d(gentle ? 0.5 : LETTER_OUT_DURATION),
                        ease: gentle ? EASE_OUT : "easeIn",
                        delay: d(index * (gentle ? 0.05 : LETTER_OUT_STAGGER)),
                      }
                    : { duration: d(0.55), ease: EASE_OUT, delay: d(0.08 + index * 0.05) }
                }
                className="inline-block will-change-transform"
              >
                {letter}
              </motion.span>
            </span>
          ))}
        </div>
      </div>

      <motion.p
        animate={{ opacity: leaving ? 0 : 1 }}
        transition={{ duration: d(0.25), ease: EASE_OUT }}
        className="absolute bottom-6 text-[11px] font-medium text-muted-foreground"
      >
        {t("common.introSkip")}
      </motion.p>
    </motion.div>
  )
}
