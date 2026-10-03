"use client"

import { useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { ChevronLeft, ChevronRight, RotateCw } from "lucide-react"
import { EASE_OUT } from "@/lib/ease"
import { useI18n } from "@/lib/i18n/context"
import type { FlashcardsElement } from "@/components/hermes/elements/types"

export function FlashcardsView({ element }: { element: FlashcardsElement }) {
  const { t } = useI18n()
  const reduce = useReducedMotion()
  const cards = element.cards.slice(0, 20)
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const card = cards[index]

  const go = (delta: 1 | -1) => {
    setFlipped(false)
    setIndex((i) => Math.min(cards.length - 1, Math.max(0, i + delta)))
  }

  if (!card) return null

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT }}
      className="chat-element flashcards-element"
    >
      {element.title ? <p className="flashcards-title" dir="auto">{element.title}</p> : null}
      <button
        type="button"
        className="flashcard"
        onClick={() => setFlipped((f) => !f)}
        aria-label={t("coach.elements.flashcards.flip")}
      >
        <motion.div
          className="flashcard-inner"
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ duration: reduce ? 0 : 0.45, ease: EASE_OUT }}
        >
          <div className="flashcard-face flashcard-front">
            <span dir="auto">{card.front}</span>
            <RotateCw size={13} className="flashcard-flip-hint" aria-hidden="true" />
          </div>
          <div className="flashcard-face flashcard-back">
            <span dir="auto">{card.back}</span>
          </div>
        </motion.div>
      </button>
      <div className="flashcards-footer">
        <button type="button" className="icon-button" disabled={index === 0} onClick={() => go(-1)} aria-label={t("coach.elements.flashcards.prev")}>
          <ChevronLeft size={16} />
        </button>
        <span className="flashcards-count tabular-nums">{t("coach.elements.flashcards.cardOf", { current: index + 1, total: cards.length })}</span>
        <button type="button" className="icon-button" disabled={index === cards.length - 1} onClick={() => go(1)} aria-label={t("coach.elements.flashcards.next")}>
          <ChevronRight size={16} />
        </button>
      </div>
    </motion.div>
  )
}
