"use client"

import { useEffect, useState } from "react"
import { api } from "@/lib/waypoint-api"

export interface GenerationStatus {
  state: "idle" | "running" | "done" | "error" | "cancelled"
  title: string | null
  total_stages: number
  completed_stage_ids: string[]
  proposal_id: string | null
  error: string | null
}

const POLL_MS = 2500

/** Progress of the student's first-roadmap generation, polled while `enabled`. The server keeps the run
 * going without any page attached, so this is how the rest of the app can tell how it is doing. */
export function useGenerationStatus(studentId: string | null, enabled: boolean): GenerationStatus | null {
  const [status, setStatus] = useState<GenerationStatus | null>(null)
  useEffect(() => {
    if (!enabled || !studentId) return
    let cancelled = false
    let timer: number | undefined
    const tick = async () => {
      try {
        const next = await api<GenerationStatus>(`/api/students/${studentId}/onboarding/generate/status`)
        if (cancelled) return
        setStatus(next)
        if (next.state !== "running") return
      } catch {
        // A failed poll is retried on the next tick; the banner keeps its last state.
      }
      if (!cancelled) timer = window.setTimeout(() => void tick(), POLL_MS)
    }
    void tick()
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [studentId, enabled])
  return status
}
