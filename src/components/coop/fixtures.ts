/**
 * Phase A (UI only) mock data for the redesigned co-op Matches tab.
 *
 * These types sketch what Phase B's real API is expected to return once Hermes/Jev-backed
 * personalization lands (see docs/handoff.md and AGENTS.md invariants on Jev + StudentFact).
 * Nothing here is wired to the backend; it only powers the `?mock=coop` dev preview so the
 * design can be reviewed before any server work starts.
 */

export type CoopSourceKey = "telegram" | "linkedin" | "feeds" | "official"

export type CoopSourceStatusState = "ok" | "partial" | "failed" | "not_configured" | "running" | "never"

/** Per-source sync status, shown in the status strip above the match list. */
export interface CoopSourceStatus {
  key: CoopSourceKey
  label: string
  status: CoopSourceStatusState
  lastSyncedAt: string | null
  count: number
  error: string | null
}

/** Why Jev (or the discipline fallback) scored a posting the way it did. */
export interface CoopRelevanceReason {
  /** One-line, student-facing explanation, e.g. "Uses your Python and ML coursework". */
  text: string
  /** The discipline this posting is written for, so a mismatch is obvious at a glance. */
  targetDiscipline: string
}

/** A skill gap between the student and a posting, most important first. The first entry in
 * a match's `gaps` array is the one shown as the card's missing-skill chip. */
export interface CoopGap {
  id: string
  /** Short skill name only — rendered verbatim in the chip, e.g. "Bash scripting". */
  skill: string
  /** One or two sentences: why this posting needs it. */
  why: string
  importance: "high" | "medium" | "low"
  /** What would prove this gap closed, e.g. "A completed course, certificate, or project...". */
  evidenceNeeded: string
  suggestion: {
    /** Roadmap node title Phase B would propose, e.g. "Linux & Bash fundamentals". */
    title: string
    description: string
    /** Human-readable estimate, e.g. "~2 weeks". */
    duration: string
    kind: "course" | "project" | "certificate" | "practice"
  }
}

/** An eligibility requirement that is NOT a roadmap gap (GPA, nationality, a university letter, the
 * application window...) — shown as a checklist instead, except items Jev marks learnable. */
export interface CoopEligibilityItem {
  type: "gpa" | "nationality" | "language_test" | "university_letter" | "enrollment" | "dates" | "other"
  detail: string
}

/** A single personalized co-op posting, as Phase B's `coop_relevance` purpose would return it. */
export interface CoopMatch {
  id: string
  title: string
  company: string
  location: string
  source: CoopSourceKey
  sourceLabel: string
  postedAt: string
  deadline: string | null
  detailUrl: string
  /** 0-100 Jev fit score for this student. */
  fitScore: number
  fitTier: "strong" | "good" | "explore"
  reason: CoopRelevanceReason
  /** Present only for hidden/filtered matches: why Jev decided this is not relevant. */
  hiddenReason?: string
  skills: string[]
  /** What the student already demonstrably matches on this posting. */
  matched?: string[]
  /** What the student is missing, most important first; empty/absent means no visible gap. */
  gaps?: CoopGap[]
  /** Eligibility items (GPA, nationality, dates...) that are not roadmap gaps. */
  eligibility?: CoopEligibilityItem[]
  /** Real mode only: whether the student already saved or dismissed this posting server-side. */
  state?: "neutral" | "saved" | "dismissed"
}

export type CoopPersona = "cs" | "medicine"

interface PersonaFixture {
  studentLabel: string
  discipline: string
  visible: CoopMatch[]
  hidden: CoopMatch[]
  sources: CoopSourceStatus[]
}

const sharedSources: CoopSourceStatus[] = [
  { key: "telegram", label: "Telegram archive", status: "ok", lastSyncedAt: "2026-10-02T06:12:00Z", count: 43, error: null },
  { key: "linkedin", label: "LinkedIn", status: "ok", lastSyncedAt: "2026-10-02T06:05:00Z", count: 16, error: null },
  { key: "feeds", label: "Employer career feeds", status: "partial", lastSyncedAt: "2026-10-02T06:00:00Z", count: 2, error: null },
  { key: "official", label: "Official pages", status: "ok", lastSyncedAt: "2026-10-02T05:30:00Z", count: 5, error: null },
]

const CS_VISIBLE: CoopMatch[] = [
  {
    id: "cs-1",
    title: "AI/ML Co-op Engineer",
    company: "SDAIA",
    location: "Riyadh",
    source: "feeds",
    sourceLabel: "Employer career feeds",
    postedAt: "2026-09-29T09:00:00Z",
    deadline: "2026-10-20T00:00:00Z",
    detailUrl: "https://sdaia.gov.sa/careers",
    fitScore: 94,
    fitTier: "strong",
    reason: { text: "Uses your Python, PyTorch and data pipeline coursework", targetDiscipline: "cs" },
    skills: ["Python", "PyTorch", "ML pipelines"],
    matched: ["Python", "PyTorch", "Data pipelines"],
    gaps: [
      {
        id: "cs-1-g1",
        skill: "MLOps / model deployment",
        why: "SDAIA's posting asks for experience shipping models to production, not just training them in notebooks.",
        importance: "high",
        evidenceNeeded: "A completed course, certificate, or project that demonstrates MLOps / model deployment.",
        suggestion: { title: "MLOps fundamentals (Docker, model serving)", description: "Close the MLOps / model deployment gap this posting calls out.", duration: "~3 weeks", kind: "course" },
      },
      {
        id: "cs-1-g2",
        skill: "SQL",
        why: "The team pulls training data from internal warehouses; basic SQL comes up in the screening interview.",
        importance: "medium",
        evidenceNeeded: "A completed course, certificate, or project that demonstrates SQL.",
        suggestion: { title: "SQL for data analysis", description: "Close the SQL gap this posting calls out.", duration: "~1 week", kind: "course" },
      },
    ],
  },
  {
    id: "cs-2",
    title: "Software Engineering Intern — Cloud Platform",
    company: "stc",
    location: "Riyadh",
    source: "telegram",
    sourceLabel: "Telegram archive",
    postedAt: "2026-09-30T14:20:00Z",
    deadline: "2026-10-15T00:00:00Z",
    detailUrl: "https://t.me/s/nobthacv1",
    fitScore: 88,
    fitTier: "strong",
    reason: { text: "Matches your backend and cloud coursework direction", targetDiscipline: "cs" },
    skills: ["Backend", "Kubernetes", "Go"],
    matched: ["Backend fundamentals", "REST APIs"],
    gaps: [
      {
        id: "cs-2-g1",
        skill: "Bash scripting",
        why: "stc's cloud team automates deployments with shell scripts; the posting lists it as a day-one expectation.",
        importance: "high",
        evidenceNeeded: "A completed course, certificate, or project that demonstrates Bash scripting.",
        suggestion: { title: "Linux & Bash fundamentals", description: "Close the Bash scripting gap this posting calls out.", duration: "~2 weeks", kind: "course" },
      },
      {
        id: "cs-2-g2",
        skill: "Kubernetes",
        why: "Services run on an internal Kubernetes cluster; interns are expected to read manifests, not just use the CLI.",
        importance: "medium",
        evidenceNeeded: "A completed course, certificate, or project that demonstrates Kubernetes.",
        suggestion: { title: "Kubernetes basics for app developers", description: "Close the Kubernetes gap this posting calls out.", duration: "~2 weeks", kind: "course" },
      },
      {
        id: "cs-2-g3",
        skill: "Go",
        why: "Most of the platform is written in Go; prior exposure isn't required but is explicitly preferred.",
        importance: "low",
        evidenceNeeded: "A completed course, certificate, or project that demonstrates Go.",
        suggestion: { title: "Go for Python/JS developers", description: "Close the Go gap this posting calls out.", duration: "~1 week", kind: "course" },
      },
    ],
  },
  {
    id: "cs-3",
    title: "Data Science Co-op",
    company: "KAUST",
    location: "Thuwal",
    source: "linkedin",
    sourceLabel: "LinkedIn",
    postedAt: "2026-09-27T11:00:00Z",
    deadline: "2026-10-25T00:00:00Z",
    detailUrl: "https://kaust.edu.sa/careers",
    fitScore: 81,
    fitTier: "good",
    reason: { text: "Research-industry hybrid fits your project history", targetDiscipline: "cs" },
    skills: ["Data science", "Research", "Python"],
    matched: ["Python", "Statistics coursework"],
    gaps: [
      {
        id: "cs-3-g1",
        skill: "Academic writing",
        why: "KAUST co-ops are expected to help draft a short research note or poster at the end of the term.",
        importance: "medium",
        evidenceNeeded: "A completed course, certificate, or project that demonstrates Academic writing.",
        suggestion: { title: "Writing for research papers", description: "Close the Academic writing gap this posting calls out.", duration: "~2 weeks", kind: "practice" },
      },
    ],
  },
  {
    id: "cs-4",
    title: "Cybersecurity Analyst Co-op",
    company: "Tahakom",
    location: "Riyadh",
    source: "feeds",
    sourceLabel: "Employer career feeds",
    postedAt: "2026-09-25T08:30:00Z",
    deadline: null,
    detailUrl: "https://careers.tahakom.com",
    fitScore: 70,
    fitTier: "good",
    reason: { text: "Overlaps with your security coursework, though it's a newer interest", targetDiscipline: "cs" },
    skills: ["Security", "SOC", "Networking"],
    matched: ["Networking fundamentals"],
    gaps: [
      {
        id: "cs-4-g1",
        skill: "SOC tooling (SIEM)",
        why: "The role is a junior analyst seat on Tahakom's security operations center; SIEM triage is the daily task.",
        importance: "high",
        evidenceNeeded: "A completed course, certificate, or project that demonstrates SOC tooling (SIEM).",
        suggestion: { title: "SOC analyst fundamentals (SIEM, alert triage)", description: "Close the SOC tooling (SIEM) gap this posting calls out.", duration: "~3 weeks", kind: "course" },
      },
      {
        id: "cs-4-g2",
        skill: "Security certifications (Security+)",
        why: "Not required to apply, but listed as a plus that strengthens the interview.",
        importance: "low",
        evidenceNeeded: "A completed course, certificate, or project that demonstrates Security certifications (Security+).",
        suggestion: { title: "CompTIA Security+ prep", description: "Close the Security certifications (Security+) gap this posting calls out.", duration: "~4 weeks", kind: "course" },
      },
    ],
  },
  {
    id: "cs-5",
    title: "Junior Full-Stack Developer (6-month training)",
    company: "KACST",
    location: "Riyadh",
    source: "telegram",
    sourceLabel: "Telegram archive",
    postedAt: "2026-10-01T07:40:00Z",
    deadline: "2026-11-01T00:00:00Z",
    detailUrl: "https://t.me/s/nobthacv1",
    fitScore: 62,
    fitTier: "explore",
    reason: { text: "Web stack overlaps your coursework; worth exploring", targetDiscipline: "cs" },
    skills: ["React", "Node.js"],
  },
]

const CS_HIDDEN: CoopMatch[] = [
  {
    id: "cs-h1",
    title: "Branch Operations Manager",
    company: "Al Rajhi Bank",
    location: "Jeddah",
    source: "telegram",
    sourceLabel: "Telegram archive",
    postedAt: "2026-09-28T12:00:00Z",
    deadline: null,
    detailUrl: "https://t.me/s/nobthacv1",
    fitScore: 8,
    fitTier: "explore",
    reason: { text: "", targetDiscipline: "business" },
    hiddenReason: "Manager role — needs 5+ yrs experience and targets business graduates, not co-op students",
    skills: ["Management", "Operations"],
  },
  {
    id: "cs-h2",
    title: "Clinical Research Coordinator Trainee",
    company: "King Faisal Specialist Hospital",
    location: "Riyadh",
    source: "telegram",
    sourceLabel: "Telegram archive",
    postedAt: "2026-09-26T10:15:00Z",
    deadline: "2026-10-10T00:00:00Z",
    detailUrl: "https://t.me/s/nobthacv1",
    fitScore: 4,
    fitTier: "explore",
    reason: { text: "", targetDiscipline: "medicine" },
    hiddenReason: "Targets medicine students — requires clinical rotation credit",
    skills: ["Clinical research"],
  },
  {
    id: "cs-h3",
    title: "Site Civil Engineer — Infrastructure Program",
    company: "NEOM",
    location: "Tabuk",
    source: "linkedin",
    sourceLabel: "LinkedIn",
    postedAt: "2026-09-24T09:00:00Z",
    deadline: null,
    detailUrl: "https://neom.com/careers",
    fitScore: 11,
    fitTier: "explore",
    reason: { text: "", targetDiscipline: "engineering" },
    hiddenReason: "Targets civil engineering students; no software component",
    skills: ["Civil engineering", "Site supervision"],
  },
]

const MED_VISIBLE: CoopMatch[] = [
  {
    id: "med-1",
    title: "Clinical Rotation Co-op — Internal Medicine",
    company: "King Faisal Specialist Hospital",
    location: "Riyadh",
    source: "telegram",
    sourceLabel: "Telegram archive",
    postedAt: "2026-09-30T08:00:00Z",
    deadline: "2026-10-18T00:00:00Z",
    detailUrl: "https://t.me/s/nobthacv1",
    fitScore: 92,
    fitTier: "strong",
    reason: { text: "Matches your clinical-year rotation requirements", targetDiscipline: "medicine" },
    skills: ["Clinical rotations", "Patient care"],
    matched: ["Clinical rotation hours", "Patient history taking"],
    gaps: [
      {
        id: "med-1-g1",
        skill: "Clinical documentation (EMR)",
        why: "KFSH runs rotations through its electronic medical record system; co-ops are expected to chart independently by week two.",
        importance: "high",
        evidenceNeeded: "A completed course, certificate, or project that demonstrates Clinical documentation (EMR).",
        suggestion: { title: "EMR documentation basics", description: "Close the Clinical documentation (EMR) gap this posting calls out.", duration: "~1 week", kind: "practice" },
      },
      {
        id: "med-1-g2",
        skill: "ACLS certification",
        why: "Internal medicine rotations prefer (not require) a current Advanced Cardiac Life Support card.",
        importance: "low",
        evidenceNeeded: "A completed course, certificate, or project that demonstrates ACLS certification.",
        suggestion: { title: "ACLS certification course", description: "Close the ACLS certification gap this posting calls out.", duration: "~2 days", kind: "certificate" },
      },
    ],
  },
  {
    id: "med-2",
    title: "Research Assistant — Public Health",
    company: "KAUST Health",
    location: "Thuwal",
    source: "linkedin",
    sourceLabel: "LinkedIn",
    postedAt: "2026-09-28T13:30:00Z",
    deadline: "2026-10-22T00:00:00Z",
    detailUrl: "https://kaust.edu.sa/careers",
    fitScore: 85,
    fitTier: "strong",
    reason: { text: "Fits your stated interest in research alongside clinical work", targetDiscipline: "medicine" },
    skills: ["Public health", "Research"],
    matched: ["Research interest", "Clinical background"],
    gaps: [
      {
        id: "med-2-g1",
        skill: "Biostatistics (R or SPSS)",
        why: "The role analyzes cohort data; the posting lists R or SPSS as a core daily tool.",
        importance: "high",
        evidenceNeeded: "A completed course, certificate, or project that demonstrates Biostatistics (R or SPSS).",
        suggestion: { title: "Biostatistics with R", description: "Close the Biostatistics (R or SPSS) gap this posting calls out.", duration: "~3 weeks", kind: "course" },
      },
      {
        id: "med-2-g2",
        skill: "IRB / research ethics training",
        why: "Any work touching patient data requires a completed ethics certification before the start date.",
        importance: "medium",
        evidenceNeeded: "A completed course, certificate, or project that demonstrates IRB / research ethics training.",
        suggestion: { title: "Research ethics & IRB basics", description: "Close the IRB / research ethics training gap this posting calls out.", duration: "~3 days", kind: "practice" },
      },
    ],
  },
  {
    id: "med-3",
    title: "Pharmacy Co-op Trainee",
    company: "SFDA",
    location: "Riyadh",
    source: "feeds",
    sourceLabel: "Employer career feeds",
    postedAt: "2026-09-26T09:00:00Z",
    deadline: null,
    detailUrl: "https://sfda.gov.sa/careers",
    fitScore: 74,
    fitTier: "good",
    reason: { text: "Adjacent to your health-sciences program, regulatory focus", targetDiscipline: "medicine" },
    skills: ["Pharmacovigilance", "Regulatory"],
    matched: ["Health sciences coursework"],
    gaps: [
      {
        id: "med-3-g1",
        skill: "Pharmacovigilance reporting",
        why: "SFDA co-ops triage adverse-event reports; the posting asks for familiarity with reporting workflows.",
        importance: "high",
        evidenceNeeded: "A completed course, certificate, or project that demonstrates Pharmacovigilance reporting.",
        suggestion: { title: "Pharmacovigilance fundamentals", description: "Close the Pharmacovigilance reporting gap this posting calls out.", duration: "~2 weeks", kind: "course" },
      },
      {
        id: "med-3-g2",
        skill: "Regulatory Arabic documentation",
        why: "Submissions to SFDA are reviewed in Arabic; comfort writing regulatory Arabic speeds onboarding.",
        importance: "low",
        evidenceNeeded: "A completed course, certificate, or project that demonstrates Regulatory Arabic documentation.",
        suggestion: { title: "Regulatory writing (Arabic)", description: "Close the Regulatory Arabic documentation gap this posting calls out.", duration: "~1 week", kind: "practice" },
      },
    ],
  },
  {
    id: "med-4",
    title: "Medical Device QA Co-op",
    company: "KACST",
    location: "Riyadh",
    source: "telegram",
    sourceLabel: "Telegram archive",
    postedAt: "2026-10-01T10:00:00Z",
    deadline: "2026-10-30T00:00:00Z",
    detailUrl: "https://t.me/s/nobthacv1",
    fitScore: 61,
    fitTier: "explore",
    reason: { text: "Health-adjacent, lighter overlap with your clinical focus", targetDiscipline: "medicine" },
    skills: ["QA", "Medical devices"],
  },
]

const MED_HIDDEN: CoopMatch[] = [
  {
    id: "med-h1",
    title: "AI/ML Co-op Engineer",
    company: "SDAIA",
    location: "Riyadh",
    source: "feeds",
    sourceLabel: "Employer career feeds",
    postedAt: "2026-09-29T09:00:00Z",
    deadline: "2026-10-20T00:00:00Z",
    detailUrl: "https://sdaia.gov.sa/careers",
    fitScore: 3,
    fitTier: "explore",
    reason: { text: "", targetDiscipline: "cs" },
    hiddenReason: "Targets computer science students — requires Python and ML coursework",
    skills: ["Python", "PyTorch"],
  },
  {
    id: "med-h2",
    title: "Branch Operations Manager",
    company: "Al Rajhi Bank",
    location: "Jeddah",
    source: "telegram",
    sourceLabel: "Telegram archive",
    postedAt: "2026-09-28T12:00:00Z",
    deadline: null,
    detailUrl: "https://t.me/s/nobthacv1",
    fitScore: 5,
    fitTier: "explore",
    reason: { text: "", targetDiscipline: "business" },
    hiddenReason: "Manager role — needs 5+ yrs experience and targets business graduates, not co-op students",
    skills: ["Management", "Operations"],
  },
  {
    id: "med-h3",
    title: "Site Civil Engineer — Infrastructure Program",
    company: "NEOM",
    location: "Tabuk",
    source: "linkedin",
    sourceLabel: "LinkedIn",
    postedAt: "2026-09-24T09:00:00Z",
    deadline: null,
    detailUrl: "https://neom.com/careers",
    fitScore: 7,
    fitTier: "explore",
    reason: { text: "", targetDiscipline: "engineering" },
    hiddenReason: "Targets civil engineering students; no clinical component",
    skills: ["Civil engineering"],
  },
]

export const COOP_PERSONA_FIXTURES: Record<CoopPersona, PersonaFixture> = {
  cs: { studentLabel: "AI/CS student", discipline: "cs", visible: CS_VISIBLE, hidden: CS_HIDDEN, sources: sharedSources },
  medicine: { studentLabel: "Medicine student", discipline: "medicine", visible: MED_VISIBLE, hidden: MED_HIDDEN, sources: sharedSources },
}

/** Reads `?mock=coop&persona=cs|medicine` — dev-only preview, never active in production. */
export function readMockCoopParams(search: string): { active: boolean; persona: CoopPersona } {
  const params = new URLSearchParams(search)
  const active = params.get("mock") === "coop"
  const persona = params.get("persona") === "medicine" ? "medicine" : "cs"
  return { active, persona }
}
