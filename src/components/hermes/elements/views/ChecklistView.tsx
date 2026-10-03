"use client"

import { useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { Check } from "lucide-react"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n/context"
import type { ChecklistElement } from "@/components/hermes/elements/types"

/** Tickable steps, local state only — never written back anywhere (see AGENTS.md:
 *  only explicit statements/choices/ticked review evidence become facts). */
export function ChecklistView({ element }: { element: ChecklistElement }) {
  const { t } = useI18n()
  const reduce = useReducedMotion()
  const items = element.items.slice(0, 15)
  const [checked, setChecked] = useState<Record<string, boolean>>(
    Object.fromEntries(items.map((item) => [item.id, item.done ?? false])),
  )
  const doneCount = Object.values(checked).filter(Boolean).length

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT }}
      className="chat-element checklist-element"
    >
      <div className="checklist-head">
        {element.title ? <p className="checklist-title" dir="auto">{element.title}</p> : null}
        <span className="checklist-count tabular-nums">{t("coach.elements.checklist.doneCount", { done: doneCount, total: items.length })}</span>
      </div>
      <ul className="checklist-items">
        {items.map((item, i) => {
          const on = checked[item.id]
          return (
            <motion.li
              key={item.id}
              initial={reduce ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.28, ease: EASE_OUT, delay: reduce ? 0 : i * 0.03 }}
            >
              <button
                type="button"
                className={cn("checklist-item", on && "checklist-item-done")}
                aria-pressed={on}
                onClick={() => setChecked((cur) => ({ ...cur, [item.id]: !cur[item.id] }))}
              >
                <span className="checklist-box" aria-hidden="true">{on ? <Check size={12} /> : null}</span>
                <span dir="auto">{item.label}</span>
              </button>
            </motion.li>
          )
        })}
      </ul>
    </motion.div>
  )
}
