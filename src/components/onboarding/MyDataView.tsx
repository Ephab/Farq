"use client"

import { useEffect, useState } from "react"
import { Bot, CheckCircle2, LoaderCircle } from "lucide-react"
import { EvidenceReview } from "@/components/onboarding/EvidenceReview"
import { SourcesStep } from "@/components/onboarding/SourcesStep"
import { api, getCurrentStudentId, type StudentProfile } from "@/lib/farq-api"

interface MyDataViewProps {
  /** Hand a prefilled request to Hermes Coach; the student still presses send. */
  onAskHermes: (draft: string) => void
}

/** Add sources after onboarding. New evidence is reviewed, then Hermes proposes roadmap changes. */
export function MyDataView({ onAskHermes }: MyDataViewProps) {
  const [profile, setProfile] = useState<StudentProfile | null>(null)
  const [step, setStep] = useState<"sources" | "review" | "done">("sources")
  const [kept, setKept] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<StudentProfile>(`/api/students/${getCurrentStudentId()}/profile`).then(setProfile).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load your profile"))
  }, [])

  if (!profile) return <div className="grid flex-1 place-items-center p-8">{error ? <p className="text-sm text-destructive">{error}</p> : <LoaderCircle className="size-5 animate-spin text-muted-foreground" />}</div>

  if (step === "sources") return <SourcesStep profile={profile} title="Add more of your records" backLabel="Review new items" onBack={() => setStep("review")} onNext={() => setStep("review")} />
  if (step === "review") return <EvidenceReview profile={profile} onlyNew onBack={() => setStep("sources")} onNext={(titles) => { setKept(titles); setStep("done") }} />

  const draft = kept.length
    ? `I added new records to my profile: ${kept.slice(0, 15).join(", ")}${kept.length > 15 ? `, and ${kept.length - 15} more` : ""}. Please review my confirmed evidence and propose any roadmap updates.`
    : ""
  return (
    <div className="mx-auto w-full max-w-xl p-4 sm:p-8">
      <CheckCircle2 className="size-7 text-emerald-600" />
      <h1 className="mt-3 text-lg font-semibold">{kept.length ? `Saved ${kept.length} new item${kept.length === 1 ? "" : "s"} to your profile` : "Nothing new to save"}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {kept.length
          ? "Your roadmap hasn't changed. Hermes can suggest updates based on these; finished and in-progress topics stay as they are, and nothing changes until you accept."
          : "Add a source when you're ready."}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={() => setStep("sources")} className="h-10 rounded-xl border border-border px-4 text-sm">Add more</button>
        {kept.length ? <button type="button" onClick={() => onAskHermes(draft)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground"><Bot className="size-4" />Ask Hermes to update my roadmap</button> : null}
      </div>
    </div>
  )
}
