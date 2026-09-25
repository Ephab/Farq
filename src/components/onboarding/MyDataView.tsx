"use client"

import { useEffect, useState } from "react"
import { Bot, LoaderCircle } from "lucide-react"
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
    <div className="h-[calc(100dvh-4rem)] overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-[760px] px-4 py-10 sm:px-8">
        <section className="rounded-[32px] border border-border bg-card p-8 text-center shadow-sm sm:p-14">
          <span className="mx-auto mb-5 grid size-[52px] place-items-center rounded-full bg-emerald-500/10 text-xl font-bold text-emerald-600">✓</span>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">Profile updated</p>
          <h1 className="mx-auto mt-2 max-w-[16ch] text-4xl font-semibold tracking-tight sm:text-5xl">{kept.length ? `${kept.length} record${kept.length === 1 ? "" : "s"} saved.` : "Nothing new to save."}</h1>
          <p className="mx-auto mt-4 max-w-[56ch] text-[15px] text-muted-foreground">
            {kept.length
              ? "Your roadmap has not changed. Hermes can compare these records with future milestones and draft changes for your review."
              : "Add a source when you're ready."}
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            {kept.length ? <button type="button" onClick={() => onAskHermes(draft)} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"><Bot className="size-4" />Review roadmap suggestions →</button> : null}
            <button type="button" onClick={() => setStep("sources")} className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-5 text-sm font-semibold outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">Add more records</button>
          </div>
        </section>
        <p className="mt-4 text-center text-[13px] text-muted-foreground">Completed work stays protected · Nothing changes silently</p>
      </div>
    </div>
  )
}
