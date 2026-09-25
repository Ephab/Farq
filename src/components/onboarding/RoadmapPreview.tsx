"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, LoaderCircle, RotateCcw } from "lucide-react"
import type { NodeStatus, RoadmapNodeData, RoadmapStage } from "@/data/computer-vision-roadmap"
import { RoadmapCanvas } from "@/components/roadmap/RoadmapCanvas"
import { NodeDetailPanel } from "@/components/roadmap/NodeDetailPanel"
import { api, notifyRoadmapChanged, type EvidenceItem, type StudentProfile } from "@/lib/farq-api"

interface InitialProposal {
  id: string
  kind: "ops" | "initial"
  status: string
  snapshot: { title: string; stages: RoadmapStage[]; nodes: RoadmapNodeData[] } | null
}

interface RoadmapPreviewProps {
  profile: StudentProfile
  onRegenerate: () => void
  onAccepted: () => void
}

/** Review the generated first roadmap: untick anything you haven't really mastered, then accept. */
export function RoadmapPreview({ profile, onRegenerate, onAccepted }: RoadmapPreviewProps) {
  const [proposal, setProposal] = useState<InitialProposal | null>(null)
  const [evidence, setEvidence] = useState<Record<string, EvidenceItem>>({})
  const [notDone, setNotDone] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      api<InitialProposal[]>(`/api/students/${profile.student_id}/roadmap/proposals`),
      api<EvidenceItem[]>(`/api/students/${profile.student_id}/evidence`),
    ]).then(([proposals, items]) => {
      setProposal(proposals.find((item) => item.kind === "initial" && item.status === "pending") ?? null)
      setEvidence(Object.fromEntries(items.map((item) => [item.id, item])))
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load your roadmap"))
  }, [profile.student_id])

  const nodes = useMemo(() => proposal?.snapshot?.nodes ?? [], [proposal])
  const statuses = useMemo(() => Object.fromEntries(nodes.map((node) => [node.id, notDone.has(node.id) ? "not-started" : (node.status ?? "not-started")])) as Record<string, NodeStatus>, [nodes, notDone])
  const preDone = nodes.filter((node) => node.status === "done")
  const selected = nodes.find((node) => node.id === selectedId) ?? null
  const selectedIndex = selected ? nodes.indexOf(selected) : -1

  const toggleDone = (id: string, keep: boolean) => setNotDone((current) => {
    const next = new Set(current)
    if (keep) next.delete(id)
    else next.add(id)
    return next
  })

  const accept = async () => {
    if (!proposal) return
    setBusy(true); setError(null)
    try {
      await api(`/api/roadmap-proposals/${proposal.id}/accept`, { method: "POST", body: JSON.stringify({ not_done: [...notDone] }) })
      notifyRoadmapChanged()
      onAccepted()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not accept the roadmap")
      setBusy(false)
    }
  }

  const regenerate = async () => {
    // Back to the chat step; generating again replaces this pending draft.
    await api(`/api/students/${profile.student_id}/profile`, { method: "PUT", body: JSON.stringify({ onboarding_status: "chat" }) }).catch(() => undefined)
    onRegenerate()
  }

  if (!proposal?.snapshot) {
    return <div className="grid flex-1 place-items-center p-8">{error ? <p className="text-sm text-destructive">{error}</p> : proposal === null && !error ? <button type="button" onClick={() => void regenerate()} className="text-sm underline">No draft found. Generate again</button> : <LoaderCircle className="size-5 animate-spin" />}</div>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-8">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">{proposal.snapshot.title}</h1>
          <p className="text-xs text-muted-foreground">{nodes.length} topics in {proposal.snapshot.stages.length} stages · a draft until you accept it</p>
        </div>
        <button type="button" onClick={() => void regenerate()} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-xs"><RotateCcw className="size-3.5" />Regenerate</button>
        <button type="button" onClick={() => void accept()} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-40">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}Accept roadmap</button>
      </div>
      {error ? <p className="px-4 py-2 text-xs text-destructive sm:px-8">{error}</p> : null}
      {preDone.length ? (
        <div className="border-b border-border px-4 py-3 sm:px-8">
          <p className="text-xs font-medium">Already mastered, based on your records. Untick anything you'd like to study again.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {preDone.map((node) => {
              const kept = !notDone.has(node.id)
              const because = (node.evidence ?? []).map((id) => evidence[id]?.title).filter(Boolean).join(", ")
              return (
                <label key={node.id} title={because ? `Because of: ${because}` : undefined} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${kept ? "border-emerald-500/40 bg-emerald-500/10" : "border-border text-muted-foreground line-through"}`}>
                  <input type="checkbox" checked={kept} onChange={(event) => toggleDone(node.id, event.target.checked)} className="size-3.5" />
                  {node.title}{because ? <span className="text-muted-foreground no-underline"> · {because}</span> : null}
                </label>
              )
            })}
          </div>
        </div>
      ) : null}
      <div className="relative flex min-h-[60svh] flex-1 flex-col">
        <RoadmapCanvas
          nodes={nodes}
          stages={proposal.snapshot.stages}
          statuses={statuses}
          selectedId={selectedId}
          dimmedIds={new Set()}
          onSelect={setSelectedId}
          onToggleDone={(id) => {
            const node = nodes.find((item) => item.id === id)
            if (node?.status === "done") toggleDone(id, statuses[id] !== "done")
          }}
        />
        <NodeDetailPanel
          node={selected}
          status={selectedId ? statuses[selectedId] : "not-started"}
          hasPrev={selectedIndex > 0}
          hasNext={selectedIndex >= 0 && selectedIndex < nodes.length - 1}
          // In the draft only evidence-backed "done" can be switched off (or back on).
          onStatus={(status) => { if (selected?.status === "done") toggleDone(selected.id, status === "done") }}
          onClose={() => setSelectedId(null)}
          onNavigate={setSelectedId}
          onPrev={() => selectedIndex > 0 && setSelectedId(nodes[selectedIndex - 1].id)}
          onNext={() => selectedIndex < nodes.length - 1 && setSelectedId(nodes[selectedIndex + 1].id)}
        />
      </div>
    </div>
  )
}
