"use client"

import { motion, useReducedMotion } from "motion/react"
import { CircleCheck, Info, Lightbulb, TriangleAlert } from "lucide-react"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"
import type { CalloutElement } from "@/components/hermes/elements/types"

const ICONS = { tip: Lightbulb, warning: TriangleAlert, info: Info, success: CircleCheck }

export function CalloutView({ element }: { element: CalloutElement }) {
  const reduce = useReducedMotion()
  const Icon = ICONS[element.tone]
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT }}
      className={cn("chat-element callout-element", `callout-${element.tone}`)}
    >
      <Icon size={16} className="callout-icon" aria-hidden="true" />
      <div>
        {element.title ? <p className="callout-title" dir="auto">{element.title}</p> : null}
        <p className="callout-body" dir="auto">{element.body}</p>
      </div>
    </motion.div>
  )
}
