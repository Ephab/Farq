"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, ChevronRight, Command, LoaderCircle } from "lucide-react"
import { BasicsStep } from "@/components/onboarding/BasicsStep"
import { EvidenceReview } from "@/components/onboarding/EvidenceReview"
import { OnboardingChat } from "@/components/onboarding/OnboardingChat"
import { RoadmapPreview } from "@/components/onboarding/RoadmapPreview"
import { SourcesStep } from "@/components/onboarding/SourcesStep"
import { ApiError, DEMO_STUDENT_ID, api, getCurrentStudentId, getHermesApiKey, getHermesModel, getHermesProvider, hasChosenStudent, isNvapiKey, modelsFor, saveHermesApiKey, saveHermesModel, saveHermesProvider, setCurrentStudentId, type HermesProvider, type OnboardingStatus, type StudentProfile } from "@/lib/waypoint-api"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n/context"

const STEPS: { status: OnboardingStatus[]; key: "basics" | "sources" | "review" | "chat" | "preview" }[] = [
  { status: ["basics"], key: "basics" },
  { status: ["sources"], key: "sources" },
  { status: ["review"], key: "review" },
  { status: ["chat", "generating"], key: "chat" },
  { status: ["preview"], key: "preview" },
]

interface OnboardingViewProps {
  onDone: () => void
}

/** New-student flow: sign in, basics, sources, evidence review, chat, roadmap preview. */
export function OnboardingView({ onDone }: OnboardingViewProps) {
  const { t, fmt } = useI18n()
  const [profile, setProfile] = useState<StudentProfile | null>(null)
  const [loading, setLoading] = useState(hasChosenStudent())
  const [error, setError] = useState<string | null>(null)
  // The profile could not be loaded for a reason other than "this student is gone" (offline,
  // server restarting): keep the student and offer a retry instead of signing them out.
  const [loadFailed, setLoadFailed] = useState(false)
  const [stepError, setStepError] = useState<string | null>(null)
  const onDoneRef = useRef(onDone)
  useEffect(() => { onDoneRef.current = onDone }, [onDone])
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
    setLoadFailed(false)
    try {
      const next = await api<StudentProfile>(`/api/students/${getCurrentStudentId()}/profile`)
      if (next.onboarding_status === "done") { onDoneRef.current(); return }
      setProfile(next)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : t("onboarding.loadProfileFailed")
      if (reason instanceof ApiError && (reason.status === 401 || reason.status === 404)) {
        // A remembered student that no longer exists (e.g. database reset): start over.
        setCurrentStudentId(null)
      } else {
        setLoadFailed(true)
      }
      setError(message)
    } finally {
      setLoading(false)
    }
    // t only formats the fallback message; a language switch must not reload the profile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { void load() }, [load])

  // Leave onboarding without losing it: the profile stays and can be resumed from the welcome page.
  const backToStart = () => {
    setCurrentStudentId(null)
    setProfile(null)
    setError(null)
    setLoadFailed(false)
  }
  const resume = (saved: SavedStudent) => {
    setCurrentStudentId(saved.student_id)
    if (saved.onboarding_status === "done") { onDone(); return }
    setLoading(true)
    void load()
  }

  const setStatus = async (status: OnboardingStatus) => {
    if (!profile) return
    setStepError(null)
    try {
      const next = await api<StudentProfile>(`/api/students/${profile.student_id}/profile`, { method: "PUT", body: JSON.stringify({ onboarding_status: status }) })
      setProfile(next)
    } catch (reason) {
      setStepError(reason instanceof Error ? reason.message : t("common.errors.generic", { status: 0 }))
    }
  }

  if (loading) return <div className="grid min-h-svh place-items-center" role="status" aria-label={t("common.loading")}><LoaderCircle className="size-5 animate-spin text-muted-foreground" aria-hidden="true" /></div>
  if (!profile && loadFailed) {
    return (
      <div className="grid min-h-svh place-items-center bg-background p-4 text-foreground">
        <div role="alert" className="w-full max-w-md rounded-3xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <div className="mt-4 flex justify-center gap-2">
            <button type="button" onClick={() => { setLoading(true); void load() }} className="h-9 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("common.retry")}</button>
            <button type="button" onClick={backToStart} className="h-9 rounded-xl border border-border px-4 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">{t("onboarding.backToStart")}</button>
          </div>
        </div>
      </div>
    )
  }
  if (!profile) return <SignIn key={error ?? ""} error={error} onCreated={(created) => { setCurrentStudentId(created.student_id); setProfile(created) }} onDemo={() => { setCurrentStudentId(DEMO_STUDENT_ID); onDone() }} onResume={resume} />

  const stepIndex = STEPS.findIndex((step) => step.status.includes(profile.onboarding_status))
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-4 border-b border-border px-4 py-3 sm:px-8">
        <div className="flex items-center gap-2"><span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground"><Command className="size-4" aria-hidden="true" /></span><span className="text-sm font-semibold">{t("common.appName")}</span></div>
        <button type="button" onClick={backToStart} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="size-3.5 rtl:-scale-x-100" aria-hidden="true" /> {t("onboarding.backToStart")}
        </button>
        <ol className="ms-auto flex flex-wrap items-center gap-1.5 text-xs" aria-label={t("onboarding.progressLabel")}>
          {STEPS.map((step, index) => (
            <li key={step.key} aria-current={index === stepIndex ? "step" : undefined} className={cn("rounded-full px-2.5 py-1", index === stepIndex ? "bg-primary text-primary-foreground" : index < stepIndex ? "bg-muted text-foreground" : "text-muted-foreground")}>
              {t("onboarding.stepItem", { index: fmt.number(index + 1), label: t(`onboarding.steps.${step.key}`) })}
            </li>
          ))}
        </ol>
      </header>
      <div className="border-b border-border bg-muted/40 px-4 py-2 sm:px-8">
        <details className="mx-auto w-full max-w-4xl">
          <summary className="cursor-pointer text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            {hermesProvider === "gemini" && hermesModel === modelOptions[0].id ? t("onboarding.advanced.summary") : t("onboarding.advanced.summaryModel", { model: modelChoices.find((m) => m.id === hermesModel)?.label ?? hermesModel })}<span className="underline">{t("onboarding.advanced.toggle")}</span>
          </summary>
          <div className="flex w-full flex-wrap items-center gap-2 pt-2">
          <label htmlFor="onboarding-hermes-provider" className="sr-only">{t("onboarding.advanced.provider")}</label>
          <select id="onboarding-hermes-provider" value={hermesProvider} onChange={(event) => onProviderChange(event.target.value as HermesProvider)} className="h-8 rounded-lg border border-border bg-background px-1.5 text-xs outline-none focus:ring-2 focus:ring-ring" aria-label={t("onboarding.advanced.provider")}>
            <option value="gemini">Gemini</option>
            <option value="nim">NVIDIA</option>
            <option value="hf">Hugging Face</option>
            <option value="openrouter">OpenRouter</option>
          </select>
          <label htmlFor="onboarding-hermes-model" className="sr-only">{t("onboarding.advanced.model")}</label>
          <select id="onboarding-hermes-model" value={hermesModel} onChange={(event) => onModelChange(event.target.value)} className="h-8 max-w-44 rounded-lg border border-border bg-background px-1.5 text-xs outline-none focus:ring-2 focus:ring-ring" aria-label={t("onboarding.advanced.model")}>
            {modelChoices.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <label htmlFor="onboarding-hermes-key" className="sr-only">{t("onboarding.advanced.apiKey")}</label>
          <input id="onboarding-hermes-key" type={showKey ? "text" : "password"} value={apiKey} onChange={(event) => onKeyChange(event.target.value)} placeholder={t("onboarding.advanced.keyPlaceholder")} dir={apiKey ? "ltr" : undefined} autoComplete="off" spellCheck={false} className="h-8 min-w-36 flex-1 rounded-lg border border-border bg-background px-2.5 text-xs outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" />
          <button type="button" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? t("onboarding.advanced.hideKey") : t("onboarding.advanced.showKey")} className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">{showKey ? t("onboarding.advanced.hide") : t("onboarding.advanced.show")}</button>
          </div>
        </details>
      </div>
      {stepError ? <p role="alert" className="border-b border-border bg-destructive/5 px-4 py-2 text-center text-xs text-destructive sm:px-8">{stepError}</p> : null}
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

interface SavedStudent { student_id: string; display_name: string; onboarding_status: OnboardingStatus; created_at: string | null }

interface SignInProps {
  error: string | null
  onCreated: (profile: StudentProfile) => void
  onDemo: () => void
  onResume: (student: SavedStudent) => void
}

function SignIn({ error, onCreated, onDemo, onResume }: SignInProps) {
  const { t, fmt } = useI18n()
  const [saved, setSaved] = useState<SavedStudent[]>([])
  useEffect(() => {
    // Profiles made on this machine, so a switch or sign-out never strands one.
    api<SavedStudent[]>("/api/students").then(setSaved).catch(() => setSaved([]))
  }, [])
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState(error)
  const create = async () => {
    if (!name.trim()) return
    setBusy(true); setFailure(null)
    try {
      onCreated(await api<StudentProfile>("/api/students", { method: "POST", body: JSON.stringify({ display_name: name.trim() }) }))
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : t("onboarding.signIn.createFailed"))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid min-h-svh place-items-center bg-background p-4 text-foreground">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <span className="grid size-10 place-items-center rounded-2xl bg-primary text-primary-foreground"><Command className="size-5" /></span>
        <h1 className="mt-4 text-xl font-semibold">{t("onboarding.signIn.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("onboarding.signIn.intro")}</p>
        {saved.length ? (
          <div className="mt-6">
            <p className="text-xs font-medium">{t("onboarding.signIn.continueAs")}</p>
            <ul className="mt-1.5 flex max-h-56 flex-col gap-1.5 overflow-y-auto">
              {saved.map((student) => (
                <li key={student.student_id}>
                  <button type="button" onClick={() => onResume(student)} className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2 text-start outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold" aria-hidden="true">{student.display_name.trim().charAt(0).toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <bdi className="block truncate text-sm font-medium">{student.display_name}</bdi>
                      <span className="block text-[11px] text-muted-foreground">
                        {student.onboarding_status === "done" ? t("onboarding.signIn.ready") : t("onboarding.signIn.inProgress")}
                        {student.created_at ? ` · ${t("onboarding.signIn.created", { date: fmt.date(student.created_at) })}` : ""}
                      </span>
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground rtl:-scale-x-100" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-xs font-medium">{t("onboarding.signIn.orNew")}</p>
          </div>
        ) : null}
        <label htmlFor="student-name" className={cn("block text-xs font-medium", saved.length ? "mt-1.5" : "mt-6")}>{t("onboarding.signIn.nameLabel")}</label>
        <input id="student-name" dir="auto" autoFocus={!saved.length} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void create() }} className="mt-1.5 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
        {failure ? <p className="mt-2 text-xs text-destructive">{failure}</p> : null}
        <button type="button" disabled={!name.trim() || busy} onClick={() => void create()} className="mt-4 h-10 w-full rounded-xl bg-primary text-sm font-medium text-primary-foreground disabled:opacity-40">{busy ? t("onboarding.signIn.creating") : t("onboarding.signIn.getStarted")}</button>
        <button type="button" onClick={onDemo} className="mt-2 h-9 w-full rounded-xl text-xs text-muted-foreground hover:bg-muted">{t("onboarding.signIn.demo")}</button>
        <p className="mt-4 text-[11px] leading-4 text-muted-foreground">{t(saved.length ? "onboarding.signIn.savedHere" : "onboarding.signIn.noAccounts")}</p>
      </div>
    </div>
  )
}
