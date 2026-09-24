"use client"

import { useCallback, useEffect, useState } from "react"
import { Command, LoaderCircle } from "lucide-react"
import { BasicsStep } from "@/components/onboarding/BasicsStep"
import { EvidenceReview } from "@/components/onboarding/EvidenceReview"
import { OnboardingChat } from "@/components/onboarding/OnboardingChat"
import { RoadmapPreview } from "@/components/onboarding/RoadmapPreview"
import { SourcesStep } from "@/components/onboarding/SourcesStep"
import { DEMO_STUDENT_ID, api, getCurrentStudentId, getHermesApiKey, getHermesModel, getHermesProvider, hasChosenStudent, isNvapiKey, modelsFor, saveHermesApiKey, saveHermesModel, saveHermesProvider, setCurrentStudentId, type HermesProvider, type OnboardingStatus, type StudentProfile } from "@/lib/farq-api"
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
  const [apiKey, setApiKey] = useState(getHermesApiKey())
  const [showKey, setShowKey] = useState(false)
  // Provider/model live here (not just footer Settings) so a saturated model
  // can be switched mid-onboarding without leaving the flow.
  const [hermesProvider, setHermesProvider] = useState<HermesProvider>(() => initialHermesProvider())
  const [hermesModel, setHermesModel] = useState<string>(() => getHermesModel(initialHermesProvider()))
  const modelOptions = modelsFor(hermesProvider)
  const modelChoices =
    hermesModel && !modelOptions.some((m) => m.id === hermesModel)
      ? [{ id: hermesModel, label: hermesModel }, ...modelOptions]
      : modelOptions

  const onKeyChange = (value: string) => {
    setApiKey(value)
    saveHermesApiKey(value.trim())
    // An nvapi key only works on NVIDIA: follow it automatically.
    if (isNvapiKey(value)) {
      setHermesProvider("nim")
      saveHermesProvider("nim")
      setHermesModel(getHermesModel("nim"))
    }
  }
  const onProviderChange = (provider: HermesProvider) => {
    setHermesProvider(provider)
    saveHermesProvider(provider)
    setHermesModel(getHermesModel(provider))
  }
  const onModelChange = (model: string) => {
    setHermesModel(model)
    saveHermesModel(hermesProvider, model)
  }

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
      <div className="border-b border-border bg-muted/40 px-4 py-2 sm:px-8">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-2">
          <label htmlFor="onboarding-hermes-provider" className="sr-only">Hermes provider</label>
          <select id="onboarding-hermes-provider" value={hermesProvider} onChange={(event) => onProviderChange(event.target.value as HermesProvider)} className="h-8 rounded-lg border border-border bg-background px-1.5 text-xs outline-none focus:ring-2 focus:ring-ring" aria-label="Hermes provider">
            <option value="gemini">Gemini</option>
            <option value="nim">NVIDIA</option>
            <option value="hf">Hugging Face</option>
          </select>
          <label htmlFor="onboarding-hermes-model" className="sr-only">Hermes model</label>
          <select id="onboarding-hermes-model" value={hermesModel} onChange={(event) => onModelChange(event.target.value)} className="h-8 max-w-44 rounded-lg border border-border bg-background px-1.5 text-xs outline-none focus:ring-2 focus:ring-ring" aria-label="Hermes model">
            {modelChoices.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <label htmlFor="onboarding-hermes-key" className="sr-only">Hermes API key</label>
          <input id="onboarding-hermes-key" type={showKey ? "text" : "password"} value={apiKey} onChange={(event) => onKeyChange(event.target.value)} placeholder="Key — nvapi-… switches to NVIDIA, empty uses server key" autoComplete="off" spellCheck={false} className="h-8 min-w-36 flex-1 rounded-lg border border-border bg-background px-2.5 text-xs outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" />
          <button type="button" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? "Hide Hermes API key" : "Show Hermes API key"} className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">{showKey ? "Hide" : "Show"}</button>
        </div>
      </div>
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

function initialHermesProvider(): HermesProvider {
  return isNvapiKey(getHermesApiKey()) ? "nim" : getHermesProvider()
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
