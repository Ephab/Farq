"use client"

import type { RoadmapNodeData, RoadmapStage } from "@/data/computer-vision-roadmap"
import { API_BASE, httpErrorMessage, identityHeaders, runErrorMessage } from "@/lib/waypoint-api"
import { translate } from "@/lib/i18n/context"

export interface StagedPlanStage {
  id: string
  title: string
  description: string
  node_count: number
  goal: string
}

export interface StagedPlan {
  title: string
  stages: StagedPlanStage[]
}

export interface StagedSnapshot {
  title: string
  stages: RoadmapStage[]
  nodes: RoadmapNodeData[]
}

export interface StagedStreamCallbacks {
  onPlan: (jobId: string, plan: StagedPlan) => void
  onStage: (stageId: string, snapshot: StagedSnapshot) => void
  onDone: (proposalId: string) => void
  onError: (message: string, stageId?: string) => void
}

/** Consume the staged-generation SSE stream with fetch (EventSource cannot
 * send the tab-only Hermes key header). Each completed stage arrives with
 * the snapshot so far so the canvas can render it immediately. */
export async function streamStagedRoadmap(
  studentId: string,
  signal: AbortSignal,
  callbacks: StagedStreamCallbacks,
): Promise<void> {
  // No model in the request: the server runs the Settings choice.
  const response = await fetch(`${API_BASE}/api/students/${studentId}/onboarding/generate/stream`, {
    headers: identityHeaders(),
    signal,
  }).catch((reason: unknown) => {
    if (signal.aborted) throw reason
    throw new Error(translate("common.networkError"))
  })
  if (!response.ok || !response.body) {
    let message = httpErrorMessage(response.status)
    try {
      const payload = (await response.json()) as { detail?: string }
      if (payload.detail) message = payload.detail
    } catch {
      // Keep the HTTP status when the server did not return JSON.
    }
    throw new Error(message)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let event = ""
  let finished = false

  const dispatch = (type: string, raw: string) => {
    let data: { job_id?: string; plan?: StagedPlan; stage_id?: string; snapshot?: StagedSnapshot; proposal_id?: string; error?: string }
    try {
      data = JSON.parse(raw) as typeof data
    } catch {
      return
    }
    if (type === "plan" && data.plan) callbacks.onPlan(data.job_id ?? "", data.plan)
    else if (type === "stage" && data.snapshot) callbacks.onStage(data.stage_id ?? "", data.snapshot)
    else if (type === "done") {
      finished = true
      callbacks.onDone(data.proposal_id ?? "")
    } else if (type === "error") {
      finished = true
      callbacks.onError(data.error ? runErrorMessage(data.error) : translate("onboarding.chat.generateFailed"), data.stage_id)
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (;;) {
        const frameEnd = buffer.indexOf("\n\n")
        if (frameEnd < 0) break
        const frame = buffer.slice(0, frameEnd)
        buffer = buffer.slice(frameEnd + 2)
        let data = ""
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim()
          else if (line.startsWith("data:")) data += line.slice(5).trim()
        }
        if (event && data) dispatch(event, data)
        event = ""
        if (finished) return
      }
    }
  } finally {
    reader.releaseLock()
  }
  if (!finished) throw new Error(translate("onboarding.chat.streamEnded"))
}
