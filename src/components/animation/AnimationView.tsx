"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Gauge, RotateCcw, Sparkles, Zap } from "lucide-react"
import { CoachPortalIntro } from "@/components/animation/CoachPortalIntro"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

type Phase = "loading" | "zoom" | "done"

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
}

const item = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: 0.65, ease: EASE_OUT } },
}

const CARDS = [
  {
    icon: Sparkles,
    title: "Slow mornings",
    copy: "Placeholder ritual card. Real coach content lands here later.",
  },
  {
    icon: Zap,
    title: "Deep work",
    copy: "Placeholder focus card. Nothing here reads real data yet.",
  },
  {
    icon: Gauge,
    title: "Momentum",
    copy: "Placeholder progress card. Wire it to the roadmap when ready.",
  },
]

/** Sidebar "Animation" section. The portal overlay plays on every mount;
 *  placeholder content staggers in underneath as the portal exits. */
export function AnimationView() {
  const reduce = useReducedMotion()
  const [phase, setPhase] = useState<Phase>(() => (reduce ? "done" : "loading"))
  const [progress, setProgress] = useState(0)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const done = phase === "done"

  const skip = useCallback(() => {
    setPhase((previous) => (previous === "done" ? previous : "done"))
  }, [])

  const restart = useCallback(() => {
    if (reduce) return
    setProgress(0)
    setPhase("loading")
  }, [reduce])

  // loading (1.45s) -> zoom (1.35s, settles before unmount) -> done
  useEffect(() => {
    if (reduce) {
      setPhase("done")
      return
    }
    if (phase === "done") return
    const next = phase === "loading" ? "zoom" : "done"
    const delay = phase === "loading" ? 1450 : 1350
    const timer = window.setTimeout(() => setPhase(next), delay)
    return () => window.clearTimeout(timer)
  }, [phase, reduce])

  // 0 -> 100% counter across the loading phase.
  useEffect(() => {
    if (phase !== "loading" || reduce) {
      if (phase !== "loading") setProgress(100)
      return
    }
    let raf = 0
    const start = performance.now()
    const duration = 1350
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      setProgress(Math.round((1 - Math.pow(1 - t, 3)) * 100))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [phase, reduce])

  useEffect(() => {
    if (done) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") skip()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [done, skip])

  useEffect(() => {
    if (done) headingRef.current?.focus({ preventScroll: true })
  }, [done])

  return (
    <div className="relative h-[calc(100dvh-4rem)] overflow-hidden bg-background">
      <div className={cn("h-full", done ? "overflow-y-auto" : "overflow-hidden")}>
        <motion.div
          variants={container}
          initial="hidden"
          animate={done ? "show" : "hidden"}
          aria-hidden={!done}
          className="mx-auto w-full max-w-[1120px] px-4 py-10 sm:px-8 sm:py-14"
        >
          <motion.div variants={item}>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground">
              <Sparkles aria-hidden="true" className="size-3.5" />
              Animation · Coach portal
            </span>
          </motion.div>

          <motion.h1
            ref={headingRef}
            variants={item}
            tabIndex={-1}
            className="mt-6 max-w-[14ch] text-[clamp(40px,6vw,84px)] font-bold leading-[1.02] tracking-tight outline-none"
          >
            Step inside the Coach.
          </motion.h1>

          <motion.p variants={item} className="mt-4 max-w-[58ch] text-[15px] leading-relaxed text-muted-foreground">
            Placeholder content for the new section. The portal transition above
            is the star — everything below is temporary until real Coach
            content arrives.
          </motion.p>

          <motion.div variants={item} className="mt-8 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={restart}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              Replay portal
            </button>
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-5 text-sm font-semibold outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              Placeholder action
            </button>
          </motion.div>

          <motion.dl variants={item} className="mt-10 flex flex-wrap gap-x-10 gap-y-4">
            {[
              ["3.2s", "portal runtime"],
              ["60fps", "transform-only motion"],
              ["0", "new dependencies"],
            ].map(([value, label]) => (
              <div key={label}>
                <dt className="order-2 mt-1 text-[13px] text-muted-foreground">{label}</dt>
                <dd className="text-[26px] font-bold leading-none tracking-tight">{value}</dd>
              </div>
            ))}
          </motion.dl>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {CARDS.map((card) => (
              <motion.article
                key={card.title}
                variants={item}
                className="rounded-3xl border border-border bg-background p-6 shadow-sm"
              >
                <span className="grid size-10 place-items-center rounded-[13px] bg-muted text-primary">
                  <card.icon aria-hidden="true" className="size-[18px]" />
                </span>
                <h2 className="mt-4 text-[17px] font-bold tracking-tight">{card.title}</h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{card.copy}</p>
              </motion.article>
            ))}
          </div>

          <motion.p variants={item} className="mt-10 text-[13px] text-muted-foreground">
            Placeholder page — the Coach portal transition is the finished piece.
          </motion.p>
        </motion.div>
      </div>

      <AnimatePresence>
        {!done && <CoachPortalIntro phase={phase} progress={progress} onSkip={skip} />}
      </AnimatePresence>
    </div>
  )
}
