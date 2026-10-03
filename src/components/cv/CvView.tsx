"use client"

/**
 * CV Builder. `?mock=cv&persona=cs|medicine` (dev only) renders entirely from local fixtures
 * (src/components/cv/fixtures.ts), never touching the network — useful for reviewing the UI and
 * for the two persona demos. Otherwise this is wired to the real backend (services/api/app/cv.py):
 * useCvData loads/generates the draft, Ask Hermes calls /cv/assist, the Tailor panel lists real
 * co-op postings and scores fit via /cv/fit, and edits are saved back with a debounced PUT.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, Reorder, motion, useReducedMotion } from "motion/react"
import {
  Check,
  Download,
  Eye,
  EyeOff,
  FileWarning,
  GripVertical,
  Info,
  LoaderCircle,
  MessageCircleMore,
  Palette,
  Plus,
  Sparkles,
  Target,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { EASE_OUT } from "@/lib/ease"
import { useI18n } from "@/lib/i18n/context"
import { api, getCurrentStudentId } from "@/lib/waypoint-api"
import { A4Frame } from "./A4Frame"
import { CvAskHermes } from "./CvAskHermes"
import { CvPreview } from "./CvPreview"
import { fetchCvFit, newPendingEdit, revertPendingEdit, runCvAssistant, runCvAssistantRemote, type CvPendingEdit } from "./cvAssistant"
import { useCvData } from "./useCvData"
import {
  CV_ACCENT_PRESETS,
  CV_OFFERS,
  computeFit,
  readMockCvParams,
  tailorDocument,
  type CvDocument,
  type CvEntry,
  type CvFit,
  type CvPersona,
  type CvSection,
  type CvTemplate,
} from "./fixtures"

/** Enough of a co-op posting (mock CvOffer or a real one from /coop/postings) to list and tailor
 *  toward — the Tailor panel and Ask Hermes chips only ever need these three fields. */
interface OfferLite { id: string; company: string; title: string }

interface CoopPostingLite { id: string; title: string; company_name: string }

const TEMPLATES: { id: CvTemplate; labelKey: "classic" | "modern" | "compact" }[] = [
  { id: "classic", labelKey: "classic" },
  { id: "modern", labelKey: "modern" },
  { id: "compact", labelKey: "compact" },
]

const GENERATE_STEP_KEYS = ["reading", "picking", "writing", "polishing"] as const

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

/** Shared minimal "inline" text control — looks like plain text until focused. */
function InlineInput({ value, onChange, placeholder, className, dir }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; dir?: "auto" | "ltr" }) {
  return (
    <input
      dir={dir ?? "auto"}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={cn("w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm outline-none transition-colors hover:border-border focus:border-border focus:bg-background focus:ring-1 focus:ring-ring", className)}
    />
  )
}

function InlineTextarea({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <textarea
      dir="auto"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={2}
      className="w-full resize-y rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm leading-snug outline-none transition-colors hover:border-border focus:border-border focus:bg-background focus:ring-1 focus:ring-ring"
    />
  )
}

interface SectionEditorProps {
  section: CvSection
  onUpdate: (mutate: (section: CvSection) => CvSection) => void
}

/** Inline editor for one section's content, shape depends on `section.kind`. */
function SectionContentEditor({ section, onUpdate }: SectionEditorProps) {
  const { t } = useI18n()

  const updateEntry = (entryId: string, mutate: (entry: CvEntry) => CvEntry) =>
    onUpdate((current) => ({ ...current, entries: current.entries?.map((entry) => (entry.id === entryId ? mutate(entry) : entry)) }))

  if (section.kind === "summary") {
    return <InlineTextarea value={section.summary ?? ""} onChange={(value) => onUpdate((current) => ({ ...current, summary: value }))} />
  }

  if (section.entries) {
    return (
      <div className="flex flex-col gap-3">
        {section.entries.map((entry) => (
          <div key={entry.id} className="rounded-lg border border-border/60 p-2">
            <div className="grid grid-cols-2 gap-1.5">
              <InlineInput value={entry.title} onChange={(value) => updateEntry(entry.id, (e) => ({ ...e, title: value }))} className="col-span-2 font-medium" />
              <InlineInput value={entry.subtitle ?? ""} onChange={(value) => updateEntry(entry.id, (e) => ({ ...e, subtitle: value }))} placeholder="Organization" />
              <InlineInput value={entry.location ?? ""} onChange={(value) => updateEntry(entry.id, (e) => ({ ...e, location: value }))} placeholder="Location" />
              <InlineInput value={entry.start ?? ""} onChange={(value) => updateEntry(entry.id, (e) => ({ ...e, start: value }))} placeholder="Start" dir="ltr" />
              <InlineInput value={entry.end ?? ""} onChange={(value) => updateEntry(entry.id, (e) => ({ ...e, end: value }))} placeholder="End" dir="ltr" />
            </div>
            <ul className="mt-1.5 flex flex-col gap-1">
              {entry.bullets.map((bullet) => (
                <li key={bullet.id} className="flex items-start gap-1">
                  <InlineTextarea
                    value={bullet.text}
                    onChange={(value) => updateEntry(entry.id, (e) => ({ ...e, bullets: e.bullets.map((b) => (b.id === bullet.id ? { ...b, text: value } : b)) }))}
                  />
                  <button
                    type="button"
                    onClick={() => updateEntry(entry.id, (e) => ({ ...e, bullets: e.bullets.filter((b) => b.id !== bullet.id) }))}
                    aria-label={t("cv.editor.removeBullet")}
                    className="mt-1 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => updateEntry(entry.id, (e) => ({ ...e, bullets: [...e.bullets, { id: uid(), text: "" }] }))}
              className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="size-3.5" aria-hidden="true" /> {t("cv.editor.addBullet")}
            </button>
          </div>
        ))}
      </div>
    )
  }

  if (section.skills) {
    return (
      <div className="flex flex-col gap-1.5">
        {section.skills.map((group) => (
          <div key={group.id} className="flex items-start gap-1.5">
            <span className="mt-1.5 shrink-0 text-xs font-semibold text-muted-foreground">{group.label}</span>
            <InlineInput
              value={group.items.join(", ")}
              onChange={(value) => onUpdate((current) => ({ ...current, skills: current.skills?.map((g) => (g.id === group.id ? { ...g, items: value.split(",").map((item) => item.trim()).filter(Boolean) } : g)) }))}
            />
          </div>
        ))}
      </div>
    )
  }

  if (section.certificates) {
    return (
      <div className="flex flex-col gap-1.5">
        {section.certificates.map((cert) => (
          <div key={cert.id} className="grid grid-cols-3 gap-1.5">
            <InlineInput value={cert.name} onChange={(value) => onUpdate((current) => ({ ...current, certificates: current.certificates?.map((c) => (c.id === cert.id ? { ...c, name: value } : c)) }))} className="col-span-3 font-medium" />
            <InlineInput value={cert.issuer} onChange={(value) => onUpdate((current) => ({ ...current, certificates: current.certificates?.map((c) => (c.id === cert.id ? { ...c, issuer: value } : c)) }))} />
            <InlineInput value={cert.date} onChange={(value) => onUpdate((current) => ({ ...current, certificates: current.certificates?.map((c) => (c.id === cert.id ? { ...c, date: value } : c)) }))} dir="ltr" />
          </div>
        ))}
      </div>
    )
  }

  if (section.languages) {
    return (
      <div className="flex flex-col gap-1.5">
        {section.languages.map((lang) => (
          <div key={lang.id} className="grid grid-cols-2 gap-1.5">
            <InlineInput value={lang.name} onChange={(value) => onUpdate((current) => ({ ...current, languages: current.languages?.map((l) => (l.id === lang.id ? { ...l, name: value } : l)) }))} />
            <InlineInput value={lang.level} onChange={(value) => onUpdate((current) => ({ ...current, languages: current.languages?.map((l) => (l.id === lang.id ? { ...l, level: value } : l)) }))} />
          </div>
        ))}
      </div>
    )
  }

  return null
}

function FitRing({ score }: { score: number }) {
  const radius = 26
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - score / 100)
  const tone = score >= 70 ? "stroke-emerald-500" : score >= 40 ? "stroke-amber-500" : "stroke-red-500"
  return (
    <svg viewBox="0 0 64 64" className="size-16 shrink-0 -rotate-90">
      <circle cx="32" cy="32" r={radius} fill="none" stroke="currentColor" strokeWidth="6" className="text-muted" />
      <motion.circle
        cx="32" cy="32" r={radius} fill="none" strokeWidth="6" strokeLinecap="round"
        className={tone} stroke="currentColor"
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      />
      <text x="32" y="36" textAnchor="middle" className="rotate-90 fill-foreground text-[16px] font-bold" style={{ transformOrigin: "32px 32px" }}>
        {score}
      </text>
    </svg>
  )
}

function TailorPanel({ offers, applied, applying, onApply, onReset, fit }: { offers: OfferLite[]; applied: OfferLite | null; applying: boolean; onApply: (offer: OfferLite) => void; onReset: () => void; fit: CvFit | null }) {
  const { t } = useI18n()
  return (
    <div className="rounded-2xl border border-border bg-background p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><Target className="size-4 text-primary" aria-hidden="true" /> {t("cv.tailorPanel.title")}</h2>
      <div className="mt-3 flex flex-col gap-1.5" role="radiogroup" aria-label={t("cv.tailorPanel.pick")} aria-disabled={applying}>
        {offers.map((offer) => (
          <button
            key={offer.id}
            type="button"
            role="radio"
            aria-checked={applied?.id === offer.id}
            disabled={applying}
            onClick={() => (applied?.id === offer.id ? onReset() : onApply(offer))}
            className={cn(
              "flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-start text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
              applied?.id === offer.id ? "border-primary bg-muted" : "border-border hover:bg-muted/50",
            )}
          >
            <span className="min-w-0">
              <span className="block truncate font-medium"><bdi>{offer.title}</bdi></span>
              <span className="block truncate text-xs text-muted-foreground"><bdi>{offer.company}</bdi></span>
            </span>
            {applied?.id === offer.id ? <Check className="size-4 shrink-0 text-primary" aria-hidden="true" /> : null}
          </button>
        ))}
      </div>

      <AnimatePresence initial={false}>
        {applied && fit ? (
          <motion.div
            key={applied.id}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-xs font-medium text-muted-foreground">{t("cv.tailorPanel.applied", { company: applied.company, title: applied.title })}</p>
              <div className="mt-3 flex items-center gap-4">
                <FitRing score={fit.score} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{t("cv.tailorPanel.fit.heading")}</p>
                  <p className="text-xs text-muted-foreground">{t("cv.tailorPanel.fit.score", { score: fit.score })}</p>
                </div>
              </div>
              {fit.matched.length ? (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-muted-foreground">{t("cv.tailorPanel.fit.matched")}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {fit.matched.map((keyword) => (
                      <span key={keyword} className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">{keyword}</span>
                    ))}
                  </div>
                </div>
              ) : null}
              {fit.missing.length ? (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-muted-foreground">{t("cv.tailorPanel.fit.missing")}</p>
                  <ul className="mt-1 flex flex-col gap-1.5">
                    {fit.missing.map((item) => (
                      <li key={item.keyword} className="rounded-lg bg-muted/60 px-2 py-1.5 text-[11px]">
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300">{item.keyword}</span>
                        <p className="mt-1 text-muted-foreground"><span className="font-semibold text-foreground">{t("cv.tailorPanel.fit.suggestion")}: </span>{item.suggestion}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <button type="button" onClick={onReset} className="mt-3 text-xs font-medium text-muted-foreground underline-offset-4 hover:underline">
                {t("cv.tailorPanel.reset")}
              </button>
            </div>
          </motion.div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">{t("cv.tailorPanel.none")}</p>
        )}
      </AnimatePresence>
    </div>
  )
}

function GenerateOverlay({ stepIndex }: { stepIndex: number }) {
  const { t } = useI18n()
  const steps = GENERATE_STEP_KEYS.map((key) => t(`cv.generate.steps.${key}`))
  return (
    <div className="absolute inset-0 z-10 grid place-items-center rounded-2xl bg-background/90 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="grid size-11 place-items-center rounded-2xl bg-primary/10">
          <Sparkles className="size-5 animate-pulse text-primary" aria-hidden="true" />
        </span>
        <AnimatePresence mode="wait">
          <motion.p
            key={stepIndex}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.28, ease: EASE_OUT }}
            className="text-sm font-medium text-muted-foreground"
          >
            {steps[Math.min(stepIndex, steps.length - 1)]}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  )
}

const DRAFT_SAVE_DEBOUNCE_MS = 1200

export function CvView() {
  const { t } = useI18n()
  const reduceMotion = useReducedMotion()
  const studentId = getCurrentStudentId()
  const mock = import.meta.env.DEV ? readMockCvParams(window.location.search) : { active: false as const, persona: "cs" as const }
  const persona: CvPersona = mock.persona
  const { document: loadedDoc, loading, generating: remoteGenerating, error: loadError, regenerate } = useCvData(persona, mock.active)
  const [doc, setDoc] = useState<CvDocument | null>(loadedDoc)
  useEffect(() => setDoc(loadedDoc), [loadedDoc])

  const [localGenerating, setLocalGenerating] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [revealSeq, setRevealSeq] = useState(0)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), [])
  const generating = mock.active ? localGenerating : remoteGenerating

  // Real postings for the Tailor panel + Ask Hermes chips; the mock preview uses the persona
  // fixtures instead so it never touches the network (see fixtures.ts/CV_OFFERS).
  const [realOffers, setRealOffers] = useState<OfferLite[]>([])
  useEffect(() => {
    if (mock.active) return
    let active = true
    api<{ results: CoopPostingLite[] }>(`/api/students/${studentId}/coop/postings?status=all&limit=50&query=`)
      .then((response) => { if (active) setRealOffers(response.results.map((item) => ({ id: item.id, company: item.company_name, title: item.title }))) })
      .catch(() => undefined)
    return () => { active = false }
  }, [mock.active, studentId])
  const offers: OfferLite[] = mock.active ? CV_OFFERS[persona] : realOffers

  const [appliedOfferId, setAppliedOfferId] = useState<string | null>(null)
  const appliedOffer = offers.find((offer) => offer.id === appliedOfferId) ?? null
  const [remoteFit, setRemoteFit] = useState<CvFit | null>(null)
  const [tailoring, setTailoring] = useState(false)

  const applyOffer = async (offer: OfferLite) => {
    setAppliedOfferId(offer.id)
    if (mock.active) return
    if (!doc) return
    setTailoring(true)
    try {
      const [, fitResult] = await Promise.all([regenerate(offer.id, doc.contact), fetchCvFit(studentId, offer.id, doc)])
      setRemoteFit(fitResult)
      setRevealSeq((n) => n + 1)
    } catch {
      setAppliedOfferId(null)
    } finally {
      setTailoring(false)
    }
  }
  const resetOffer = async () => {
    setAppliedOfferId(null)
    setRemoteFit(null)
    if (mock.active || !doc) return
    setTailoring(true)
    try {
      await regenerate(null, doc.contact)
      setRevealSeq((n) => n + 1)
    } finally {
      setTailoring(false)
    }
  }

  // Arriving from "Tailor my CV for this" on a co-op posting (CoopMatchesPreview's gap-detail
  // sheet): preselect and tailor toward that posting once, then clear the key so a later visit
  // to this tab (or a refresh) doesn't keep re-tailoring.
  const consumedTailorPosting = useRef(false)
  useEffect(() => {
    if (mock.active || !doc || consumedTailorPosting.current) return
    let postingId: string | null = null
    try {
      postingId = window.sessionStorage.getItem("waypoint.cv.tailor-posting")
    } catch { /* storage blocked: nothing to preselect */ }
    if (!postingId) return
    consumedTailorPosting.current = true
    try { window.sessionStorage.removeItem("waypoint.cv.tailor-posting") } catch { /* already gone */ }
    void applyOffer({ id: postingId, company: "", title: "" })
    // applyOffer is recreated every render; only `doc` becoming available should retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, mock.active])

  /** Every inline edit control below goes through this — `doc` is only null while loading/generating. */
  const patchDoc = (mutate: (current: CvDocument) => CvDocument) => setDoc((current) => (current ? mutate(current) : current))

  const updateSection = (id: string, mutate: (section: CvSection) => CvSection) =>
    patchDoc((current) => ({ ...current, sections: current.sections.map((section) => (section.id === id ? mutate(section) : section)) }))

  // "Ask Hermes" chat panel: pendingEdits are field-level groups the student can Accept (keep)
  // or Undo (revert) individually, or all at once. See cvAssistant.ts for the mock mapping, and
  // services/api/app/cv.py's /cv/assist for the real one.
  const [askOpen, setAskOpen] = useState(false)
  const [pendingEdits, setPendingEdits] = useState<CvPendingEdit[]>([])
  const highlightIds = useMemo(() => new Set(pendingEdits.flatMap((edit) => edit.fields.map((field) => field.targetId))), [pendingEdits])

  const handleAskSubmit = useCallback(async (instruction: string): Promise<string> => {
    if (!doc) return t("cv.askHermes.genericError")
    if (mock.active) {
      await new Promise((resolve) => window.setTimeout(resolve, 1400))
      const result = runCvAssistant(doc, persona, CV_OFFERS[persona], instruction)
      if (result.changes.length) {
        setDoc(result.doc)
        setPendingEdits((prev) => [...prev, newPendingEdit(result.summary, result.changes)])
      }
      return result.reply
    }
    const result = await runCvAssistantRemote(studentId, doc, instruction)
    if (result.changes.length) {
      setDoc(result.doc)
      setPendingEdits((prev) => [...prev, newPendingEdit(result.summary, result.changes)])
    }
    return result.reply
    // offers/persona only matter for the mock path; studentId/doc cover the real one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, mock.active, studentId, persona])

  const acceptEdit = (id: string) => setPendingEdits((prev) => prev.filter((edit) => edit.id !== id))
  const undoEdit = (id: string) => {
    const edit = pendingEdits.find((item) => item.id === id)
    if (edit) setDoc((current) => (current ? revertPendingEdit(current, edit) : current))
    setPendingEdits((prev) => prev.filter((item) => item.id !== id))
  }
  const undoAllEdits = () => {
    setDoc((current) => (current ? [...pendingEdits].reverse().reduce((next, edit) => revertPendingEdit(next, edit), current) : current))
    setPendingEdits([])
  }

  // Debounced autosave of local edits (template/theme/contact/section/bullet changes). Never
  // runs in the dev mock preview, and never fires for the document load that just populated `doc`.
  const skipNextSave = useRef(true)
  useEffect(() => { skipNextSave.current = true }, [loadedDoc])
  useEffect(() => {
    if (mock.active || !doc) return
    if (skipNextSave.current) { skipNextSave.current = false; return }
    const timer = window.setTimeout(() => {
      api(`/api/students/${studentId}/cv/draft`, { method: "PUT", body: JSON.stringify({ document: doc }) }).catch(() => undefined)
    }, DRAFT_SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [doc, mock.active, studentId])

  const generate = () => {
    if (generating) return
    if (mock.active) {
      if (reduceMotion) {
        setStepIndex(GENERATE_STEP_KEYS.length - 1)
        setRevealSeq((n) => n + 1)
        return
      }
      setLocalGenerating(true)
      setStepIndex(0)
      GENERATE_STEP_KEYS.slice(1).forEach((_, index) => {
        timers.current.push(window.setTimeout(() => setStepIndex(index + 1), (index + 1) * 950))
      })
      timers.current.push(
        window.setTimeout(() => {
          setLocalGenerating(false)
          setRevealSeq((n) => n + 1)
        }, 4000),
      )
      return
    }
    setStepIndex(0)
    const stepTimer = window.setInterval(() => setStepIndex((index) => (index + 1) % GENERATE_STEP_KEYS.length), 900)
    regenerate(appliedOfferId, doc?.contact)
      .then(() => setRevealSeq((n) => n + 1))
      .catch(() => undefined)
      .finally(() => window.clearInterval(stepTimer))
  }

  const download = () => window.print()

  if (loading || !doc) {
    return (
      <div className="mx-auto grid w-full max-w-7xl place-items-center p-4 py-24 sm:p-8">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />
          <p className="text-sm">{loadError ?? t("cv.toolbar.generating")}</p>
        </div>
      </div>
    )
  }

  // The local reorder-preview (computeFit/tailorDocument) only exists for the mock fixtures, which
  // carry keywords/tailoredSummary; real postings get their fit from /cv/fit (remoteFit) and their
  // tailored content from a real /cv/generate call (see applyOffer), not a client-side transform.
  const appliedMockOffer = mock.active ? CV_OFFERS[persona].find((offer) => offer.id === appliedOfferId) ?? null : null
  const fit: CvFit | null = mock.active ? (appliedMockOffer ? computeFit(doc, appliedMockOffer) : null) : remoteFit
  const displayDoc = appliedMockOffer ? tailorDocument(doc, appliedMockOffer) : doc

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-8">
      <header className="mb-6 border-b border-border pb-6">
        <p className="mb-2 text-sm font-medium text-muted-foreground">{t("cv.eyebrow")}</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("cv.title")}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{t("cv.subtitle")}</p>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={generate}
          disabled={generating}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] disabled:opacity-60"
        >
          <Sparkles className="size-4" aria-hidden="true" />
          {generating ? t("cv.toolbar.generating") : t("cv.toolbar.generate")}
        </button>
        <button
          type="button"
          onClick={download}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
        >
          <Download className="size-4" aria-hidden="true" />
          {t("cv.toolbar.downloadPdf")}
        </button>
        <span title={t("cv.toolbar.docxUnavailable")} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-dashed border-border px-3 text-xs font-medium text-muted-foreground">
          <FileWarning className="size-3.5" aria-hidden="true" /> DOCX
          <Info className="size-3.5" aria-hidden="true" />
        </span>
        <button
          type="button"
          onClick={() => setAskOpen((value) => !value)}
          aria-pressed={askOpen}
          className={cn(
            "ms-auto inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]",
            askOpen ? "border-primary bg-muted" : "border-border",
          )}
        >
          <MessageCircleMore className="size-4" aria-hidden="true" />
          {t("cv.toolbar.askHermes")}
          {pendingEdits.length ? <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-none text-primary-foreground">{pendingEdits.length}</span> : null}
        </button>
      </div>

      <p className="mb-4 text-xs text-muted-foreground lg:hidden">{t("cv.mobileNote")}</p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        {/* Editor column */}
        <div className="flex min-w-0 flex-col gap-4">
          <section className="rounded-2xl border border-border bg-background p-4">
            <span className="text-sm font-semibold">{t("cv.template.label")}</span>
            <div className="mt-2 flex gap-1 rounded-xl bg-muted p-1">
              {TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  aria-pressed={doc.template === tpl.id}
                  onClick={() => patchDoc((current) => ({ ...current, template: tpl.id }))}
                  className={cn(
                    "h-9 flex-1 rounded-lg px-2 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    doc.template === tpl.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(`cv.template.${tpl.labelKey}`)}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-background p-4">
            <span className="flex items-center gap-1.5 text-sm font-semibold"><Palette className="size-4 text-muted-foreground" aria-hidden="true" /> {t("cv.appearance.heading")}</span>
            <p className="mt-1 text-xs text-muted-foreground">{t("cv.appearance.accent")}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {CV_ACCENT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.label}
                  aria-label={preset.label}
                  aria-pressed={doc.theme.accent.toLowerCase() === preset.value.toLowerCase()}
                  onClick={() => patchDoc((d) => ({ ...d, theme: { ...d.theme, accent: preset.value } }))}
                  className={cn(
                    "size-7 shrink-0 rounded-full outline-none ring-offset-2 ring-offset-background transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring",
                    doc.theme.accent.toLowerCase() === preset.value.toLowerCase() && "ring-2 ring-foreground",
                  )}
                  style={{ backgroundColor: preset.value }}
                >
                  {doc.theme.accent.toLowerCase() === preset.value.toLowerCase() ? <Check className="mx-auto size-3.5 text-white" aria-hidden="true" /> : null}
                </button>
              ))}
              <label className="relative size-7 shrink-0 cursor-pointer overflow-hidden rounded-full border border-dashed border-border" title={t("cv.appearance.custom")}>
                <input
                  type="color"
                  value={doc.theme.accent}
                  onChange={(event) => patchDoc((d) => ({ ...d, theme: { ...d.theme, accent: event.target.value } }))}
                  aria-label={t("cv.appearance.custom")}
                  className="absolute -inset-2 cursor-pointer"
                />
              </label>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{t("cv.appearance.font")}</p>
            <div className="mt-2 flex gap-1 rounded-xl bg-muted p-1">
              {(["sans", "serif"] as const).map((font) => (
                <button
                  key={font}
                  type="button"
                  aria-pressed={(doc.theme.font ?? "sans") === font}
                  onClick={() => patchDoc((d) => ({ ...d, theme: { ...d.theme, font } }))}
                  className={cn(
                    "h-9 flex-1 rounded-lg px-2 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    font === "serif" ? "font-serif" : "font-sans",
                    (doc.theme.font ?? "sans") === font ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(`cv.appearance.${font}`)}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-background p-4">
            <h2 className="text-sm font-semibold">{t("cv.contact.headline")}</h2>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <InlineInput value={doc.contact.name} onChange={(value) => patchDoc((d) => ({ ...d, contact: { ...d.contact, name: value } }))} placeholder={t("cv.contact.name")} className="col-span-2 font-medium" />
              <InlineInput value={doc.contact.headline} onChange={(value) => patchDoc((d) => ({ ...d, contact: { ...d.contact, headline: value } }))} placeholder={t("cv.contact.headline")} className="col-span-2" />
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><Info className="size-3.5" aria-hidden="true" /> {t("cv.optionalHint")}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <InlineInput value={doc.contact.email ?? ""} onChange={(value) => patchDoc((d) => ({ ...d, contact: { ...d.contact, email: value } }))} placeholder={t("cv.contact.email")} dir="ltr" />
              <InlineInput value={doc.contact.phone ?? ""} onChange={(value) => patchDoc((d) => ({ ...d, contact: { ...d.contact, phone: value } }))} placeholder={t("cv.contact.phone")} dir="ltr" />
              <InlineInput value={doc.contact.linkedin ?? ""} onChange={(value) => patchDoc((d) => ({ ...d, contact: { ...d.contact, linkedin: value } }))} placeholder={t("cv.contact.linkedin")} dir="ltr" />
              <InlineInput value={doc.contact.github ?? ""} onChange={(value) => patchDoc((d) => ({ ...d, contact: { ...d.contact, github: value } }))} placeholder={t("cv.contact.github")} dir="ltr" />
              <InlineInput value={doc.contact.city ?? ""} onChange={(value) => patchDoc((d) => ({ ...d, contact: { ...d.contact, city: value } }))} placeholder={t("cv.contact.city")} className="col-span-2" />
            </div>
          </section>

          <section aria-label={t("cv.editor.heading")} className="rounded-2xl border border-border bg-background p-4">
            <h2 className="text-sm font-semibold">{t("cv.editor.heading")}</h2>
            <Reorder.Group
              axis="y"
              values={doc.sections}
              onReorder={(sections) => patchDoc((current) => ({ ...current, sections }))}
              className="mt-2 flex flex-col gap-2"
            >
              {doc.sections.map((section) => (
                <Reorder.Item key={section.id} value={section} className="list-none rounded-xl border border-border/70 bg-background">
                  <div className="flex items-center gap-1.5 px-2 py-1.5">
                    <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing" aria-hidden="true" />
                    <InlineInput value={section.title} onChange={(value) => updateSection(section.id, (s) => ({ ...s, title: value }))} className="font-semibold" />
                    <button
                      type="button"
                      onClick={() => updateSection(section.id, (s) => ({ ...s, visible: !s.visible }))}
                      aria-label={section.visible ? t("cv.sections.toggleVisible", { title: section.title }) : t("cv.sections.toggleHidden", { title: section.title })}
                      aria-pressed={section.visible}
                      className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {section.visible ? <Eye className="size-4" aria-hidden="true" /> : <EyeOff className="size-4" aria-hidden="true" />}
                    </button>
                  </div>
                  {section.visible ? (
                    <div className="border-t border-border/60 px-2.5 py-2">
                      <SectionContentEditor section={section} onUpdate={(mutate) => updateSection(section.id, mutate)} />
                    </div>
                  ) : null}
                </Reorder.Item>
              ))}
            </Reorder.Group>
          </section>

          <TailorPanel offers={offers} applied={appliedOffer} applying={tailoring} onApply={(offer) => void applyOffer(offer)} onReset={() => void resetOffer()} fit={fit} />
        </div>

        {/* Preview column */}
        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground">{t("cv.preview.heading")}</h2>
            <span className="text-xs text-muted-foreground">{t("cv.preview.a4Note")}</span>
          </div>
          <div className="relative">
            {generating ? <GenerateOverlay stepIndex={stepIndex} /> : null}
            <div className="cv-print-root rounded-2xl bg-muted/30 p-4 sm:p-6">
              <A4Frame className="mx-auto">
                <CvPreview document={displayDoc} revealToken={revealSeq} highlightIds={highlightIds} />
              </A4Frame>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {askOpen ? (
          <CvAskHermes
            onClose={() => setAskOpen(false)}
            offers={offers}
            pendingEdits={pendingEdits}
            onSubmit={handleAskSubmit}
            onAccept={acceptEdit}
            onUndo={undoEdit}
            onUndoAll={undoAllEdits}
          />
        ) : null}
      </AnimatePresence>
    </div>
  )
}
