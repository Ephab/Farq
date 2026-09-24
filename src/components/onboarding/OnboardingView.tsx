"use client"

import { useCallback, useEffect, useState } from "react"
import { Command, LoaderCircle } from "lucide-react"
import { BasicsStep } from "@/components/onboarding/BasicsStep"
import { EvidenceReview } from "@/components/onboarding/EvidenceReview"
import { OnboardingChat } from "@/components/onboarding/OnboardingChat"
import { RoadmapPreview } from "@/components/onboarding/RoadmapPreview"
import { SourcesStep } from "@/components/onboarding/SourcesStep"
import { DEMO_STUDENT_ID, api, getCurrentStudentId, hasChosenStudent, setCurrentStudentId, type OnboardingStatus, type StudentProfile } from "@/lib/farq-api"
import { cn } from "@/lib/utils"

const STEPS: { status: OnboardingStatus[]; label: string }[] = [
  { status: ["basics"], label: "About you" },
  { status: ["sources"], label: "Connect" },
  { status: ["review"], label: "Review" },
  { status: ["chat", "generating"], label: "Chat" },
  { status: ["preview"], label: "Your roadmap" },
]

interface OnboardingViewProps {
  onDone: () => void
}

/** New-student flow: sign in, basics, sources, evidence review, chat, roadmap preview. */
export function OnboardingView({ onDone }: OnboardingViewProps) {
  const [profile, setProfile] = useState<StudentProfile | null>(null)
  const [loading, setLoading] = useState(hasChosenStudent())
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!hasChosenStudent()) { setLoading(false); return }
    try {
      const next = await api<StudentProfile>(`/api/students/${getCurrentStudentId()}/profile`)
      if (next.onboarding_status === "done") { onDone(); return }
      setProfile(next)
    } catch (reason) {
      // A remembered student that no longer exists (e.g. database reset): start over.
      setCurrentStudentId(null)
      setError(reason instanceof Error ? reason.message : "Could not load your profile")
    } finally {
      setLoading(false)
    }
  }, [onDone])

  useEffect(() => { void load() }, [load])

  const setStatus = async (status: OnboardingStatus) => {
    if (!profile) return
    const next = await api<StudentProfile>(`/api/students/${profile.student_id}/profile`, { method: "PUT", body: JSON.stringify({ onboarding_status: status }) })
    setProfile(next)
  }

  if (loading) return <div className="grid min-h-svh place-items-center"><LoaderCircle className="size-5 animate-spin text-muted-foreground" /></div>
  if (!profile) return <SignIn error={error} onCreated={(created) => { setCurrentStudentId(created.student_id); setProfile(created) }} onDemo={() => { setCurrentStudentId(DEMO_STUDENT_ID); onDone() }} />

  const stepIndex = STEPS.findIndex((step) => step.status.includes(profile.onboarding_status))
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-4 border-b border-border px-4 py-3 sm:px-8">
        <div className="flex items-center gap-2"><span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground"><Command className="size-4" /></span><span className="text-sm font-semibold">Farq</span></div>
        <ol className="ml-auto flex flex-wrap items-center gap-1.5 text-xs" aria-label="Onboarding progress">
          {STEPS.map((step, index) => (
            <li key={step.label} aria-current={index === stepIndex ? "step" : undefined} className={cn("rounded-full px-2.5 py-1", index === stepIndex ? "bg-primary text-primary-foreground" : index < stepIndex ? "bg-muted text-foreground" : "text-muted-foreground")}>
              {index + 1}. {step.label}
            </li>
          ))}
        </ol>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">
        {profile.onboarding_status === "basics" ? <BasicsStep profile={profile} onSaved={(next) => setProfile(next)} /> : null}
        {profile.onboarding_status === "sources" ? <SourcesStep profile={profile} onBack={() => void setStatus("basics")} onNext={() => void setStatus("review")} /> : null}
        {profile.onboarding_status === "review" ? <EvidenceReview profile={profile} onBack={() => void setStatus("sources")} onNext={() => void setStatus("chat")} /> : null}
        {profile.onboarding_status === "chat" || profile.onboarding_status === "generating" ? <OnboardingChat profile={profile} onBack={() => void setStatus("review")} onGenerated={() => void load()} /> : null}
        {profile.onboarding_status === "preview" ? <RoadmapPreview profile={profile} onRegenerate={() => void load()} onAccepted={onDone} /> : null}
      </main>
    </div>
  )
}

function SignIn({ error, onCreated, onDemo }: { error: string | null; onCreated: (profile: StudentProfile) => void; onDemo: () => void }) {
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState(error)
  const create = async () => {
    if (!name.trim()) return
    setBusy(true); setFailure(null)
    try {
      onCreated(await api<StudentProfile>("/api/students", { method: "POST", body: JSON.stringify({ display_name: name.trim() }) }))
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : "Could not create your profile")
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid min-h-svh place-items-center bg-background p-4 text-foreground">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <span className="grid size-10 place-items-center rounded-2xl bg-primary text-primary-foreground"><Command className="size-5" /></span>
        <h1 className="mt-4 text-xl font-semibold">Welcome to Farq</h1>
        <p className="mt-1 text-sm text-muted-foreground">Farq builds a learning roadmap from what you've already done: your transcript, CV, projects and more. You won't have to type it all out.</p>
        <label htmlFor="student-name" className="mt-6 block text-xs font-medium">What should Hermes call you?</label>
        <input id="student-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void create() }} className="mt-1.5 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
        {failure ? <p className="mt-2 text-xs text-destructive">{failure}</p> : null}
        <button type="button" disabled={!name.trim() || busy} onClick={() => void create()} className="mt-4 h-10 w-full rounded-xl bg-primary text-sm font-medium text-primary-foreground disabled:opacity-40">{busy ? "Creating…" : "Get started"}</button>
        <button type="button" onClick={onDemo} className="mt-2 h-9 w-full rounded-xl text-xs text-muted-foreground hover:bg-muted">Explore the demo student instead</button>
        <p className="mt-4 text-[11px] leading-4 text-muted-foreground">There are no accounts yet. This browser remembers your profile.</p>
      </div>
    </div>
  )
}
