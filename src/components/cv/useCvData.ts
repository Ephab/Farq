/**
 * CV data seam: real backend in production, local fixtures in the dev `?mock=cv` preview.
 *
 * Phase B: `GET /api/students/{id}/cv/draft` first; when the student has no draft yet, this falls
 * back to `POST /api/students/{id}/cv/generate` (optionally tailored to `postingId`), which also
 * persists the result as the draft. Ownership is enforced server-side
 * (services/api/app/ownership.py); nothing here ever reads an EvidenceItem still in `suggested`
 * state or writes a StudentFact (see AGENTS.md and services/api/app/cv.py).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { api, getCurrentStudentId } from "@/lib/waypoint-api"
import { CV_FIXTURES, type CvContact, type CvDocument, type CvPersona } from "./fixtures"

export interface UseCvDataResult {
  document: CvDocument | null
  loading: boolean
  generating: boolean
  error: string | null
  /** Re-generates from scratch (the "Generate with Hermes" button), optionally tailored to a posting. */
  regenerate: (postingId?: string | null, contact?: CvContact) => Promise<void>
}

interface CvDraftResponse {
  document: CvDocument
  posting_id: string | null
  updated_at: string
}

/** `mock` is only ever true in a dev build (see CvView.tsx's readMockCvParams gate). */
export function useCvData(persona: CvPersona, mock: boolean): UseCvDataResult {
  const studentId = getCurrentStudentId()
  const [document, setDocument] = useState<CvDocument | null>(() => (mock ? structuredClone(CV_FIXTURES[persona]) : null))
  const [loading, setLoading] = useState(!mock)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  const generate = useCallback(async (postingId?: string | null, contact?: CvContact) => {
    setGenerating(true)
    setError(null)
    try {
      const draft = await api<CvDraftResponse>(`/api/students/${studentId}/cv/generate`, {
        method: "POST",
        body: JSON.stringify({ posting_id: postingId || null, contact: contact ?? null }),
      })
      if (mounted.current) setDocument(draft.document)
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : "Could not generate your CV")
      throw reason
    } finally {
      if (mounted.current) setGenerating(false)
    }
  }, [studentId])

  useEffect(() => {
    if (mock) {
      setDocument(structuredClone(CV_FIXTURES[persona]))
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    api<CvDraftResponse | null>(`/api/students/${studentId}/cv/draft`)
      .then(async (draft) => {
        if (!active) return
        if (draft) {
          setDocument(draft.document)
          return
        }
        await generate(null)
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load your CV") })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `generate` is stable per studentId; persona/mock gate the mock-only branch above.
  }, [studentId, mock])

  return { document, loading, generating, error, regenerate: generate }
}
