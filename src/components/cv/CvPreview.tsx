"use client"

import { useMemo } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Code2, Globe, Mail, MapPin, Phone } from "lucide-react"
import { cn } from "@/lib/utils"
import { EASE_OUT } from "@/lib/ease"
import { useI18n } from "@/lib/i18n/context"
import type { CvCertificate, CvDocument, CvEntry, CvSection, CvTemplate } from "./fixtures"

/** Parsed once per render from the flat set of `CvFieldChange.targetId` strings currently pending
 *  in the Ask Hermes panel, so the preview can briefly highlight exactly what changed. */
export interface CvHighlights {
  sections: Set<string>
  bullets: Set<string>
  summaries: Set<string>
}

export function parseHighlightIds(ids: Iterable<string> | undefined): CvHighlights {
  const sections = new Set<string>()
  const bullets = new Set<string>()
  const summaries = new Set<string>()
  for (const id of ids ?? []) {
    const [kind, a, , c] = id.split(":")
    if (kind === "summary") summaries.add(a)
    else if (kind === "bullet") bullets.add(c)
    else if (kind === "section" || kind === "skillsAll") sections.add(a)
  }
  return { sections, bullets, summaries }
}

const HIGHLIGHT_CLASS = "cv-highlight"

/** Subtle "where this came from" chip — never printed (see .no-print in index.css). */
function ProvenanceChip({ label }: { label: string }) {
  const { t } = useI18n()
  return (
    <span className="no-print ms-2 inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 align-middle text-[9px] font-medium leading-none text-primary">
      {t("cv.provenance.from", { label })}
    </span>
  )
}

function EntryBlock({ entry, template, highlightBullets }: { entry: CvEntry; template: CvTemplate; highlightBullets: Set<string> }) {
  const dates = [entry.start, entry.end].filter(Boolean).join(" – ")
  return (
    <div className={template === "compact" ? "mb-2.5" : "mb-3.5"}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-[12.5px] font-semibold leading-snug">
          <bdi dir="auto">{entry.title}</bdi>
          {entry.provenance ? <ProvenanceChip label={entry.provenance.label} /> : null}
        </p>
        {dates ? <span className="shrink-0 text-[10.5px] text-[#555]">{dates}</span> : null}
      </div>
      {entry.subtitle || entry.location ? (
        <p className="text-[11px] italic text-[#444]">
          <bdi dir="auto">{entry.subtitle}</bdi>
          {entry.subtitle && entry.location ? " · " : ""}
          {entry.location ? <bdi dir="auto">{entry.location}</bdi> : null}
        </p>
      ) : null}
      {entry.bullets.length ? (
        <ul className="mt-1 list-disc ps-4">
          {entry.bullets.map((bullet) => (
            <li key={bullet.id} className={cn("text-[11.5px] leading-snug text-[#222]", highlightBullets.has(bullet.id) && HIGHLIGHT_CLASS)}>
              <bdi dir="auto">{bullet.text}</bdi>
              {bullet.provenance ? <ProvenanceChip label={bullet.provenance.label} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function CertBlock({ cert }: { cert: CvCertificate }) {
  return (
    <li className="text-[11.5px] leading-snug text-[#222]">
      <bdi dir="auto"><strong className="font-semibold">{cert.name}</strong> — {cert.issuer} ({cert.date})</bdi>
      {cert.provenance ? <ProvenanceChip label={cert.provenance.label} /> : null}
    </li>
  )
}

function SectionTitle({ title, template }: { title: string; template: CvTemplate }) {
  if (template === "classic") {
    return <h2 className="mb-1.5 border-b pb-0.5 text-[12.5px] font-bold uppercase tracking-[0.08em] text-[#17181c] [border-color:color-mix(in_srgb,var(--cv-accent)_55%,#bbb)]"><bdi dir="auto">{title}</bdi></h2>
  }
  if (template === "compact") {
    return <h2 className="mb-1 text-[11px] font-bold uppercase tracking-[0.1em] text-[color:var(--cv-accent)]"><bdi dir="auto">{title}</bdi></h2>
  }
  return (
    <h2 className="mb-1.5 flex items-center gap-2 text-[12.5px] font-bold uppercase tracking-[0.08em] text-[color:var(--cv-accent)]">
      <span className="h-px flex-1 bg-[color:var(--cv-accent)] opacity-30" aria-hidden="true" />
      <bdi dir="auto">{title}</bdi>
      <span className="h-px flex-1 bg-[color:var(--cv-accent)] opacity-30" aria-hidden="true" />
    </h2>
  )
}

function SectionBody({ section, template, highlights }: { section: CvSection; template: CvTemplate; highlights: CvHighlights }) {
  if (section.kind === "summary") {
    return (
      <p className={cn("text-[11.5px] leading-relaxed text-[#222]", highlights.summaries.has(section.id) && HIGHLIGHT_CLASS)}>
        <bdi dir="auto">{section.summary}</bdi>
      </p>
    )
  }
  if (section.entries) {
    return <>{section.entries.map((entry) => <EntryBlock key={entry.id} entry={entry} template={template} highlightBullets={highlights.bullets} />)}</>
  }
  if (section.skills) {
    return (
      <div className="grid gap-1">
        {section.skills.map((group) => (
          <p key={group.id} className="text-[11.5px] leading-snug text-[#222]">
            <strong className="font-semibold"><bdi dir="auto">{group.label}:</bdi></strong>{" "}
            <bdi dir="auto">{group.items.join(" · ")}</bdi>
          </p>
        ))}
      </div>
    )
  }
  if (section.certificates) {
    return <ul className="grid gap-1">{section.certificates.map((cert) => <CertBlock key={cert.id} cert={cert} />)}</ul>
  }
  if (section.languages) {
    return (
      <p className="text-[11.5px] leading-snug text-[#222]">
        {section.languages.map((lang, index) => (
          <span key={lang.id}>
            {index > 0 ? " · " : ""}
            <bdi dir="auto">{lang.name}</bdi> <span className="text-[#555]">({lang.level})</span>
          </span>
        ))}
      </p>
    )
  }
  return null
}

const SIDEBAR_KINDS = new Set(["skills", "certificates", "languages"])

/** Staggered per-section reveal, replayed whenever `revealToken` changes (the Hermes "generate"
    simulation bumps it). A stable key would skip the entrance since nothing else changed. */
function RevealSection({ index, reduceMotion, className, highlighted, children }: { index: number; reduceMotion: boolean | null; className?: string; highlighted?: boolean; children: React.ReactNode }) {
  return (
    <motion.section
      className={cn(className, highlighted && "cv-highlight cv-highlight-section")}
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_OUT, delay: reduceMotion ? 0 : Math.min(index, 8) * 0.07 }}
    >
      {children}
    </motion.section>
  )
}

export function CvPreview({ document, revealToken = 0, highlightIds }: { document: CvDocument; revealToken?: number; highlightIds?: Set<string> }) {
  const { t } = useI18n()
  const reduceMotion = useReducedMotion()
  const { contact, template } = document
  const accent = document.theme?.accent ?? (template === "classic" ? "#17181c" : "#2f6f5e")
  const fontClass = document.theme?.font === "serif" ? "font-serif" : "font-sans"
  const highlights = useMemo(() => parseHighlightIds(highlightIds), [highlightIds])
  const visible = document.sections.filter((section) => section.visible)
  const main = template === "compact" ? visible.filter((section) => !SIDEBAR_KINDS.has(section.kind)) : visible
  const sidebar = template === "compact" ? visible.filter((section) => SIDEBAR_KINDS.has(section.kind)) : []

  const contactLine: { icon: typeof Mail; value: string }[] = [
    contact.email ? { icon: Mail, value: contact.email } : null,
    contact.phone ? { icon: Phone, value: contact.phone } : null,
    contact.linkedin ? { icon: Globe, value: contact.linkedin } : null,
    contact.github ? { icon: Code2, value: contact.github } : null,
    contact.city ? { icon: MapPin, value: contact.city } : null,
  ].filter((item): item is { icon: typeof Mail; value: string } => item !== null)

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={template}
        initial={reduceMotion ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
        transition={{ duration: 0.32, ease: EASE_OUT }}
        style={{ "--cv-accent": accent } as React.CSSProperties}
        className={cn("p-10", fontClass)}
      >
        <header className={template === "classic" ? "text-center" : "text-start"}>
          <h1 className="text-[22px] font-bold tracking-tight text-[color:var(--cv-accent)]">
            <bdi dir="auto">{contact.name}</bdi>
          </h1>
          <p className="mt-0.5 text-[12px] text-[#444]"><bdi dir="auto">{contact.headline}</bdi></p>
          {contactLine.length ? (
            <div className={`mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-[#444] ${template === "classic" ? "justify-center" : "justify-start"}`}>
              {contactLine.map(({ icon: Icon, value }) => (
                <span key={value} className="inline-flex items-center gap-1">
                  <Icon className="size-3" aria-hidden="true" />
                  <bdi dir="ltr">{value}</bdi>
                </span>
              ))}
            </div>
          ) : null}
        </header>

        {template === "compact" ? (
          <div className="mt-5 grid grid-cols-[1fr_190px] gap-6">
            <div className="min-w-0">
              {main.map((section, index) => (
                <RevealSection key={`${section.id}-${revealToken}`} index={index} reduceMotion={reduceMotion} className="mb-3.5" highlighted={highlights.sections.has(section.id)}>
                  <SectionTitle title={section.title} template={template} />
                  <SectionBody section={section} template={template} highlights={highlights} />
                </RevealSection>
              ))}
            </div>
            <div className="min-w-0 border-s ps-4 [border-color:color-mix(in_srgb,var(--cv-accent)_25%,#ddd)]">
              {sidebar.map((section, index) => (
                <RevealSection key={`${section.id}-${revealToken}`} index={main.length + index} reduceMotion={reduceMotion} className="mb-3.5" highlighted={highlights.sections.has(section.id)}>
                  <SectionTitle title={section.title} template={template} />
                  <SectionBody section={section} template={template} highlights={highlights} />
                </RevealSection>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-5">
            {main.map((section, index) => (
              <RevealSection key={`${section.id}-${revealToken}`} index={index} reduceMotion={reduceMotion} className="mb-4" highlighted={highlights.sections.has(section.id)}>
                <SectionTitle title={section.title} template={template} />
                <SectionBody section={section} template={template} highlights={highlights} />
              </RevealSection>
            ))}
          </div>
        )}

        {visible.length === 0 ? (
          <p className="mt-6 text-center text-sm text-[#777]">{t("cv.editor.emptySection")}</p>
        ) : null}
      </motion.div>
    </AnimatePresence>
  )
}
