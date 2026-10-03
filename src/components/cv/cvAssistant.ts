/**
 * Phase A (UI only) mock for "Ask Hermes" inside the CV Builder.
 *
 * Phase B replaces `runCvAssistant` with a real call: a tool-less JSON prompt that receives the
 * current CvDocument, the student's instruction, and confirmed learner context (same sources as
 * `useCvData`/`cv.py`), and returns a validated revised CvDocument/patch. The instruction text
 * itself is never stored as a StudentFact (AGENTS.md) — same rule as every other Hermes chat
 * surface in this app.
 *
 * Everything below is deterministic and keyword-matched so the UI (loading, reply, per-change
 * accept/undo, highlight) can be built and reviewed before any server work exists.
 */

import { api } from "@/lib/waypoint-api"
import { computeFit, tailorDocument, type CvDocument, type CvFit, type CvOffer, type CvPersona, type CvSkillGroup } from "./fixtures"

/** One field-level edit, addressable well enough to revert in isolation. */
export interface CvFieldChange {
  targetId: string
  before: unknown
  after: unknown
}

export interface CvAssistantResult {
  doc: CvDocument
  /** Empty when the request didn't match anything editable. */
  changes: CvFieldChange[]
  /** Short label for the Accept/Undo row, e.g. "Shortened summary". */
  summary: string
  /** Hermes' chat reply. */
  reply: string
}

/** A pending (not yet accepted/undone) group of field changes from one request. */
export interface CvPendingEdit {
  id: string
  label: string
  fields: CvFieldChange[]
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * Writes one field change into the document. Target id formats:
 * - `summary:<sectionId>` → section.summary
 * - `bullet:<sectionId>:<entryId>:<bulletId>` → bullet.text
 * - `skillsAll:<sectionId>` → section.skills (whole array, used for reordering)
 * - `doc:full` → the whole document (used for broad rewrites like tailoring)
 * - `section:<sectionId>` → no-op; carried only so the preview can highlight the whole section
 */
export function applyFieldValue(doc: CvDocument, targetId: string, value: unknown): CvDocument {
  if (targetId === "doc:full") return value as CvDocument
  const [kind, a, b, c] = targetId.split(":")
  if (kind === "summary") {
    return { ...doc, sections: doc.sections.map((section) => (section.id === a ? { ...section, summary: value as string } : section)) }
  }
  if (kind === "bullet") {
    return {
      ...doc,
      sections: doc.sections.map((section) =>
        section.id !== a
          ? section
          : {
              ...section,
              entries: section.entries?.map((entry) =>
                entry.id !== b ? entry : { ...entry, bullets: entry.bullets.map((bullet) => (bullet.id === c ? { ...bullet, text: value as string } : bullet)) },
              ),
            },
      ),
    }
  }
  if (kind === "skillsAll") {
    return { ...doc, sections: doc.sections.map((section) => (section.id === a ? { ...section, skills: value as CvSkillGroup[] } : section)) }
  }
  // "section:<id>" and anything unrecognized: no-op (decorative targetId, used only for highlighting).
  return doc
}

/** Reverts every field in a pending edit, most-recent-first so overlapping targets resolve safely. */
export function revertPendingEdit(doc: CvDocument, edit: CvPendingEdit): CvDocument {
  return [...edit.fields].reverse().reduce((current, field) => applyFieldValue(current, field.targetId, field.before), doc)
}

const SHORT_SUMMARY: Record<CvPersona, string> = {
  cs: "AI/CS undergraduate building production ML systems, from research notebooks to deployed services.",
  medicine: "Fourth-year medical student with internal medicine rotation experience and a growing public health research interest.",
}

function opShortenSummary(doc: CvDocument, persona: CvPersona): CvAssistantResult {
  const section = doc.sections.find((item) => item.kind === "summary")
  if (!section) return { doc, changes: [], summary: "", reply: "I couldn't find a summary section to shorten." }
  const targetId = `summary:${section.id}`
  const before = section.summary ?? ""
  const after = SHORT_SUMMARY[persona]
  return {
    doc: applyFieldValue(doc, targetId, after),
    changes: [{ targetId, before, after }],
    summary: "Shortened summary",
    reply: "Shortened your summary to a tighter two sentences.",
  }
}

const RESEARCH_BULLET_MATCH: Record<CvPersona, RegExp> = {
  cs: /Hajj crowd dataset/,
  medicine: /retrospective cohort study/,
}
const RESEARCH_BULLET_REWRITE: Record<CvPersona, string> = {
  cs: "Led independent research training a lightweight CNN to 91% accuracy on a 10k-image Hajj crowd dataset, documented in a short research report",
  medicine: "Led a research assistantship, co-authoring a retrospective cohort study on 400 patient records presented at a student research day",
}

function opEmphasizeResearch(doc: CvDocument, persona: CvPersona): CvAssistantResult {
  const changes: CvFieldChange[] = []
  let next = doc
  for (const section of doc.sections) {
    for (const entry of section.entries ?? []) {
      for (const bullet of entry.bullets) {
        if (RESEARCH_BULLET_MATCH[persona].test(bullet.text)) {
          const targetId = `bullet:${section.id}:${entry.id}:${bullet.id}`
          changes.push({ targetId, before: bullet.text, after: RESEARCH_BULLET_REWRITE[persona] })
          next = applyFieldValue(next, targetId, RESEARCH_BULLET_REWRITE[persona])
        }
      }
    }
  }
  const skillsSection = next.sections.find((section) => section.kind === "skills")
  if (skillsSection?.skills) {
    const index = skillsSection.skills.findIndex((group) => /research/i.test(group.label))
    if (index > 0) {
      const before = skillsSection.skills
      const after = [skillsSection.skills[index], ...skillsSection.skills.filter((_, i) => i !== index)]
      const targetId = `skillsAll:${skillsSection.id}`
      changes.push({ targetId, before, after })
      next = applyFieldValue(next, targetId, after)
    }
  }
  if (!changes.length) return { doc, changes: [], summary: "", reply: "I couldn't find a clear research angle to emphasize yet — try adding a research bullet first." }
  return { doc: next, changes, summary: `Emphasized research (${changes.length} change${changes.length > 1 ? "s" : ""})`, reply: `Emphasized your research work — ${changes.length} change${changes.length > 1 ? "s" : ""} across your bullets and skills.` }
}

const VERB_REPLACEMENTS: [RegExp, string][] = [
  [/\bBuilt\b/, "Engineered"],
  [/\bShipped\b/, "Delivered"],
  [/\bAssisted\b/, "Supported"],
  [/\bRotated through\b/, "Led rotations through"],
  [/\bCo-authored\b/, "Spearheaded"],
  [/\bOrganized\b/, "Directed"],
  [/\bDesigned\b/, "Architected"],
  [/\bTrained\b/, "Developed and trained"],
  [/\bLed\b/, "Directed"],
]

function rewriteBullet(text: string): string | null {
  for (const [pattern, replacement] of VERB_REPLACEMENTS) {
    if (pattern.test(text)) return text.replace(pattern, replacement)
  }
  return null
}

function opStrongerVerbs(doc: CvDocument): CvAssistantResult {
  const changes: CvFieldChange[] = []
  let next = doc
  outer: for (const section of doc.sections) {
    if (!["experience", "projects", "activities"].includes(section.kind)) continue
    for (const entry of section.entries ?? []) {
      for (const bullet of entry.bullets) {
        if (changes.length >= 3) break outer
        const rewritten = rewriteBullet(bullet.text)
        if (rewritten && rewritten !== bullet.text) {
          const targetId = `bullet:${section.id}:${entry.id}:${bullet.id}`
          changes.push({ targetId, before: bullet.text, after: rewritten })
          next = applyFieldValue(next, targetId, rewritten)
        }
      }
    }
  }
  if (!changes.length) return { doc, changes: [], summary: "", reply: "Your bullets already use strong verbs — nothing obvious to change." }
  return { doc: next, changes, summary: `Strengthened ${changes.length} bullet${changes.length > 1 ? "s" : ""}`, reply: `Strengthened ${changes.length} bullet${changes.length > 1 ? "s" : ""} with stronger action verbs.` }
}

const ARABIC_SUMMARY: Record<CvPersona, string> = {
  cs: "طالبة ذكاء اصطناعي وعلوم حاسب، لديها خبرة عملية في مشاريع تعلم الآلة وأساس قوي في خطوط معالجة البيانات والأنظمة الخلفية.",
  medicine: "طالبة طب في سنتها الرابعة، لديها خبرة في التناوب السريري بالطب الباطني واهتمام بحثي متنامٍ بالصحة العامة.",
}

function opTranslateSummary(doc: CvDocument, persona: CvPersona): CvAssistantResult {
  const section = doc.sections.find((item) => item.kind === "summary")
  if (!section) return { doc, changes: [], summary: "", reply: "I couldn't find a summary to translate." }
  const targetId = `summary:${section.id}`
  const before = section.summary ?? ""
  const after = ARABIC_SUMMARY[persona]
  return {
    doc: applyFieldValue(doc, targetId, after),
    changes: [{ targetId, before, after }],
    summary: "Translated summary to Arabic",
    reply: "Translated your summary to Arabic — the rest of the CV stays in English for now.",
  }
}

function opTailor(doc: CvDocument, offers: CvOffer[], mention: string): CvAssistantResult {
  const matched = mention ? offers.find((offer) => offer.company.toLowerCase().includes(mention) || offer.title.toLowerCase().includes(mention)) : undefined
  const offer = matched ?? offers[0]
  if (!offer) return { doc, changes: [], summary: "", reply: "I don't have a mock offer to tailor against yet." }
  const before = doc
  const after = tailorDocument(doc, offer)
  const fit = computeFit(doc, offer)
  const skillsIds = after.sections.filter((section) => section.kind === "skills").map((section) => `section:${section.id}` as const)
  const changes: CvFieldChange[] = [{ targetId: "doc:full", before, after }, ...skillsIds.map((targetId) => ({ targetId, before: null, after: null }))]
  return {
    doc: after,
    changes,
    summary: `Tailored for ${offer.company}`,
    reply: `Tailored your CV for ${offer.company} (${offer.title}) — reordered skills and bullets to match, and updated your summary. Fit score: ${fit.score}%.`,
  }
}

const GENERIC_SUFFIX = " Comfortable picking up new tools quickly and working well across a team."

function opGenericPolish(doc: CvDocument): CvAssistantResult {
  const section = doc.sections.find((item) => item.kind === "summary")
  if (!section) return { doc, changes: [], summary: "", reply: "Tell me more about what you'd like changed." }
  const before = section.summary ?? ""
  if (before.includes(GENERIC_SUFFIX.trim())) {
    return { doc, changes: [], summary: "", reply: 'Already applied that polish — try something more specific, like "make my summary shorter" or "emphasize research".' }
  }
  const after = `${before.trim()}${GENERIC_SUFFIX}`
  const targetId = `summary:${section.id}`
  return {
    doc: applyFieldValue(doc, targetId, after),
    changes: [{ targetId, before, after }],
    summary: "Polished summary",
    reply: 'Made a light pass over your summary. Want something more specific — "emphasize research", "translate to Arabic", or "tailor for" a saved offer?',
  }
}

/** Keyword-routes a free-text instruction to one of the canned mock edits above. */
export function runCvAssistant(doc: CvDocument, persona: CvPersona, offers: CvOffer[], instruction: string): CvAssistantResult {
  const text = instruction.toLowerCase()
  if (/short|shorten|tighten|concise/.test(text)) return opShortenSummary(doc, persona)
  if (/research/.test(text)) return opEmphasizeResearch(doc, persona)
  if (/verb|stronger|action|punch/.test(text)) return opStrongerVerbs(doc)
  if (/arabic|translate|عرب/.test(text)) return opTranslateSummary(doc, persona)
  const mentionedOffer = offers.find((offer) => text.includes(offer.company.toLowerCase()))
  if (/tailor|offer/.test(text) || mentionedOffer) return opTailor(doc, offers, mentionedOffer?.company.toLowerCase() ?? "")
  return opGenericPolish(doc)
}

/** Persona-aware example prompts shown as chips. Kept in English (not translated): they're canned
 *  example instructions matched by English keywords above, same convention as the CV fixtures. */
export function cvSuggestionChips(offers: Pick<CvOffer, "company">[]): string[] {
  return [
    "Make my summary shorter",
    "Emphasize research",
    "Rewrite bullets with stronger verbs",
    "Translate my summary to Arabic",
    offers[0] ? `Tailor for ${offers[0].company}` : "Tailor for a co-op offer",
  ]
}

export function newPendingEdit(summary: string, fields: CvFieldChange[]): CvPendingEdit {
  return { id: uid(), label: summary, fields }
}

// ---------------------------------------------------------------------------------------------
// Phase B: real backend calls, same shapes as the mock above so CvView.tsx can use either.
// ---------------------------------------------------------------------------------------------

interface CvAssistResponse {
  document: CvDocument
  changes: { target_id: string; before: unknown; after: unknown }[]
  summary: string
  reply: string
}

/** POST /api/students/{id}/cv/assist — services/api/app/cv.py validates every change server-side
 *  (known target ids only, re-validates the whole document) before this ever returns. */
export async function runCvAssistantRemote(studentId: string, document: CvDocument, instruction: string): Promise<CvAssistantResult> {
  const response = await api<CvAssistResponse>(`/api/students/${studentId}/cv/assist`, {
    method: "POST",
    body: JSON.stringify({ instruction, document }),
  })
  return {
    doc: response.document,
    changes: response.changes.map((change) => ({ targetId: change.target_id, before: change.before, after: change.after })),
    summary: response.summary,
    reply: response.reply,
  }
}

interface CvFitResponse {
  score: number
  matched: string[]
  missing: { keyword: string; suggestion: string }[]
  engine: string
}

/** POST /api/students/{id}/cv/fit — Jev (or a deterministic fallback) scored against a real
 *  co-op posting's extracted requirements; see services/api/app/cv_fit.py. */
export async function fetchCvFit(studentId: string, postingId: string, document: CvDocument): Promise<CvFit> {
  const response = await api<CvFitResponse>(`/api/students/${studentId}/cv/fit`, {
    method: "POST",
    body: JSON.stringify({ posting_id: postingId, document }),
  })
  return { score: response.score, matched: response.matched, missing: response.missing }
}
