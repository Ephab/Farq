"use client"

import { motion, useReducedMotion } from "motion/react"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"
import type { TableElement } from "@/components/hermes/elements/types"

/** Plain table, or a comparison when `highlight_column` marks the recommended column. */
export function TableView({ element }: { element: TableElement }) {
  const reduce = useReducedMotion()
  const columns = element.columns.slice(0, 6)
  const rows = element.rows.slice(0, 20)

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT }}
      className="chat-element table-element"
    >
      {element.title ? <p className="table-element-title" dir="auto">{element.title}</p> : null}
      <div className="table-element-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th key={i} className={cn(i === element.highlight_column && "table-col-highlight")} dir="auto">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.slice(0, columns.length).map((cell, c) => (
                  <td key={c} className={cn(c === element.highlight_column && "table-col-highlight")} dir="auto">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  )
}
