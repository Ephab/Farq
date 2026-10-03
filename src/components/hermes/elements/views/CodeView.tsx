"use client"

import { motion, useReducedMotion } from "motion/react"
import { EASE_OUT } from "@/lib/ease"
import type { CodeElement } from "@/components/hermes/elements/types"
import { CodeBlock } from "@/components/hermes/elements/parts/CodeBlock"

export function CodeView({ element }: { element: CodeElement }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT }}
      className="chat-element"
    >
      <CodeBlock code={element.code.slice(0, 4000)} language={element.language} caption={element.caption} />
    </motion.div>
  )
}
