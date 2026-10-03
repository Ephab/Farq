/**
 * Phase A (UI only) CV Builder — types + mock data.
 *
 * These types sketch the shape Phase B's real `/api/students/{id}/cv/*` endpoints are expected
 * to return once Hermes/Jev-backed generation lands (see docs/handoff.md and the AGENTS.md
 * invariants on StudentFact, EvidenceItem and Jev). Nothing here is wired to the backend; it only
 * powers the `?mock=cv&persona=cs|medicine` dev preview and the always-on Phase A fixture so the
 * design can be reviewed before any server work starts. See useCvData.ts for the swap seam.
 */

export type CvTemplate = "classic" | "modern" | "compact"

export type CvPersona = "cs" | "medicine"

/** Where a generated bullet or entry came from — shown as a subtle chip, never printed. */
export interface CvProvenance {
  /** e.g. "Project Waypoint · evaluation", "Roadmap · Linear Algebra", "Group Project · Nova" */
  label: string
}

export interface CvBullet {
  id: string
  text: string
  provenance?: CvProvenance
}

/** One row inside Education, Experience/Co-op, Projects or Activities. */
export interface CvEntry {
  id: string
  title: string
  subtitle?: string
  location?: string
  start?: string
  end?: string
  bullets: CvBullet[]
  provenance?: CvProvenance
}

export interface CvSkillGroup {
  id: string
  label: string
  items: string[]
}

export interface CvLanguage {
  id: string
  name: string
  level: string
}

export interface CvCertificate {
  id: string
  name: string
  issuer: string
  date: string
  provenance?: CvProvenance
}

export type CvSectionKind =
  | "summary"
  | "education"
  | "experience"
  | "projects"
  | "skills"
  | "certificates"
  | "activities"
  | "languages"

/** A reorderable, hideable block. Content lives in the field matching `kind`. */
export interface CvSection {
  id: string
  kind: CvSectionKind
  title: string
  visible: boolean
  summary?: string
  entries?: CvEntry[]
  skills?: CvSkillGroup[]
  certificates?: CvCertificate[]
  languages?: CvLanguage[]
}

/** Contact fields are all optional by design — empty ones are omitted from the CV. */
export interface CvContact {
  name: string
  headline: string
  phone?: string
  email?: string
  linkedin?: string
  github?: string
  city?: string
}

/** Accent color + optional font pairing, applied across all three templates. Persisted on the
 *  document so Phase B can save it alongside the content. */
export interface CvTheme {
  /** Any CSS color (hex). One of CV_ACCENT_PRESETS, or a value from the custom color picker. */
  accent: string
  font?: "sans" | "serif"
}

export interface CvDocument {
  template: CvTemplate
  theme: CvTheme
  contact: CvContact
  sections: CvSection[]
}

export interface CvAccentPreset {
  id: string
  label: string
  value: string
}

/** Six-to-eight tasteful presets, chosen to stay readable as both text and a thin rule/border at
 *  CV body-text size, and to survive printing in grayscale if a student's printer can't do color. */
export const CV_ACCENT_PRESETS: CvAccentPreset[] = [
  { id: "neutral", label: "Neutral", value: "#17181c" },
  { id: "navy", label: "Navy", value: "#1e3a5f" },
  { id: "teal", label: "Teal", value: "#0f766e" },
  { id: "emerald", label: "Emerald", value: "#0f7a53" },
  { id: "burgundy", label: "Burgundy", value: "#7f1d3d" },
  { id: "slate", label: "Slate", value: "#334155" },
  { id: "indigo", label: "Indigo", value: "#3730a3" },
  { id: "rust", label: "Rust", value: "#9a3412" },
]

/** A mock co-op posting to tailor the CV against (Phase B: a real posting via Jev). */
export interface CvOffer {
  id: string
  company: string
  title: string
  keywords: string[]
  tailoredSummary: string
}

export interface CvFitMissing {
  keyword: string
  suggestion: string
}

export interface CvFit {
  score: number
  matched: string[]
  missing: CvFitMissing[]
}

function uid(prefix: string): () => string {
  let n = 0
  return () => `${prefix}-${++n}`
}

// ---------------------------------------------------------------------------------------------
// AI/CS persona
// ---------------------------------------------------------------------------------------------

const csId = uid("cs")

const CS_CV: CvDocument = {
  template: "modern",
  theme: { accent: "#0f766e", font: "sans" },
  contact: {
    name: "Lama Al-Qahtani",
    headline: "AI & Computer Science Student · KFUPM, Class of 2027",
    email: "lama.q@kfupm.edu.sa",
    linkedin: "linkedin.com/in/lama-alqahtani",
    github: "github.com/lqahtani",
    city: "Dhahran, Saudi Arabia",
  },
  sections: [
    {
      id: csId(), kind: "summary", title: "Summary", visible: true,
      summary: "AI/CS undergraduate with hands-on machine learning project work and a strong grounding in data pipelines and backend systems. Comfortable moving from research notebooks to production-ready services.",
    },
    {
      id: csId(), kind: "education", title: "Education", visible: true,
      entries: [{
        id: csId(), title: "B.Sc. Computer Science — AI concentration", subtitle: "King Fahd University of Petroleum & Minerals",
        location: "Dhahran", start: "2023", end: "2027 (expected)",
        bullets: [
          { id: csId(), text: "GPA 3.8/4.0, Dean's List (2024, 2025)", provenance: { label: "Profile · transcript" } },
          { id: csId(), text: "Relevant coursework: Machine Learning, Data Structures, Distributed Systems, Linear Algebra", provenance: { label: "Roadmap · completed nodes" } },
        ],
      }],
    },
    {
      id: csId(), kind: "experience", title: "Experience", visible: true,
      entries: [{
        id: csId(), title: "Software Engineering Co-op (Summer)", subtitle: "stc Cloud Platform",
        location: "Riyadh", start: "Jun 2025", end: "Aug 2025",
        bullets: [
          { id: csId(), text: "Built a Kubernetes-based autoscaler prototype that cut staging cold-start time by 35%", provenance: { label: "Co-op · evaluation" } },
          { id: csId(), text: "Shipped two internal Go services consumed by three product teams", provenance: { label: "Co-op · evaluation" } },
        ],
      }],
    },
    {
      id: csId(), kind: "projects", title: "Projects", visible: true,
      entries: [
        {
          id: csId(), title: "Waypoint — AI coaching companion", subtitle: "Personal project", start: "2026",
          bullets: [
            { id: csId(), text: "Designed a Hermes-backed roadmap engine that turned student evidence into personalized study plans", provenance: { label: "Project Waypoint · evaluation" } },
            { id: csId(), text: "Scored 92/100 on the final evaluation rubric for architecture and code quality", provenance: { label: "Project Waypoint · evaluation" } },
          ],
        },
        {
          id: csId(), title: "Crowd-density estimator", subtitle: "Course capstone, CV track", start: "2025",
          bullets: [
            { id: csId(), text: "Trained a lightweight CNN reaching 91% accuracy on a 10k-image Hajj crowd dataset", provenance: { label: "Project · evaluation" } },
          ],
        },
      ],
    },
    {
      id: csId(), kind: "skills", title: "Skills", visible: true,
      skills: [
        { id: csId(), label: "Languages", items: ["Python", "Go", "TypeScript", "C++"] },
        { id: csId(), label: "ML & data", items: ["PyTorch", "scikit-learn", "Pandas", "SQL"] },
        { id: csId(), label: "Systems", items: ["Docker", "Kubernetes", "FastAPI", "PostgreSQL"] },
      ],
    },
    {
      id: csId(), kind: "certificates", title: "Certificates", visible: true,
      certificates: [
        { id: csId(), name: "Linear Algebra for Machine Learning", issuer: "Waypoint Roadmap", date: "2025", provenance: { label: "Roadmap · completed node" } },
        { id: csId(), name: "AWS Cloud Practitioner", issuer: "AWS", date: "2025", provenance: { label: "Evidence · reviewed CV" } },
      ],
    },
    {
      id: csId(), kind: "activities", title: "Activities", visible: true,
      entries: [{
        id: csId(), title: "Team lead, Nova", subtitle: "Group Projects · campus hackathon team", start: "2025", end: "2026",
        bullets: [
          { id: csId(), text: "Led a 4-person team to a top-3 finish building a campus wayfinding app", provenance: { label: "Group Project · Nova" } },
        ],
      }],
    },
    {
      id: csId(), kind: "languages", title: "Languages", visible: true,
      languages: [
        { id: csId(), name: "Arabic", level: "Native" },
        { id: csId(), name: "English", level: "Fluent (IELTS 7.5)" },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------------------------
// Medicine persona
// ---------------------------------------------------------------------------------------------

const medId = uid("med")

const MED_CV: CvDocument = {
  template: "classic",
  theme: { accent: "#1e3a5f", font: "serif" },
  contact: {
    name: "Sara Al-Ghamdi",
    headline: "Medicine Student · King Saud University, Class of 2028",
    email: "sara.ghamdi@ksu.edu.sa",
    city: "Riyadh, Saudi Arabia",
  },
  sections: [
    {
      id: medId(), kind: "summary", title: "Summary", visible: true,
      summary: "Fourth-year medical student with clinical rotation experience in internal medicine and a growing research interest in public health. Reliable under pressure, comfortable in multidisciplinary teams.",
    },
    {
      id: medId(), kind: "education", title: "Education", visible: true,
      entries: [{
        id: medId(), title: "M.B.B.S.", subtitle: "King Saud University, College of Medicine",
        location: "Riyadh", start: "2023", end: "2028 (expected)",
        bullets: [
          { id: medId(), text: "GPA 3.9/4.0", provenance: { label: "Profile · transcript" } },
          { id: medId(), text: "Relevant coursework: Internal Medicine, Pharmacology, Public Health, Clinical Diagnostics", provenance: { label: "Roadmap · completed nodes" } },
        ],
      }],
    },
    {
      id: medId(), kind: "experience", title: "Experience / Co-op", visible: true,
      entries: [{
        id: medId(), title: "Clinical Rotation Co-op — Internal Medicine", subtitle: "King Faisal Specialist Hospital",
        location: "Riyadh", start: "Jun 2025", end: "Sep 2025",
        bullets: [
          { id: medId(), text: "Rotated through 4 inpatient wards, presenting on 20+ patient cases during rounds", provenance: { label: "Co-op · evaluation" } },
          { id: medId(), text: "Assisted attending physicians with history-taking and documentation for a 30-bed unit", provenance: { label: "Co-op · evaluation" } },
        ],
      }],
    },
    {
      id: medId(), kind: "projects", title: "Projects", visible: true,
      entries: [{
        id: medId(), title: "Diabetes risk factors in young adults", subtitle: "Research assistantship", start: "2025",
        bullets: [
          { id: medId(), text: "Co-authored a retrospective cohort study on 400 patient records, presented at a student research day", provenance: { label: "Project · evaluation" } },
        ],
      }],
    },
    {
      id: medId(), kind: "skills", title: "Skills", visible: true,
      skills: [
        { id: medId(), label: "Clinical", items: ["History-taking", "Patient care", "Clinical documentation", "Basic life support"] },
        { id: medId(), label: "Research", items: ["Public health", "Biostatistics basics", "Literature review"] },
      ],
    },
    {
      id: medId(), kind: "certificates", title: "Certificates", visible: true,
      certificates: [
        { id: medId(), name: "Basic Life Support (BLS)", issuer: "Saudi Heart Association", date: "2025", provenance: { label: "Evidence · reviewed CV" } },
        { id: medId(), name: "Clinical Diagnostics", issuer: "Waypoint Roadmap", date: "2025", provenance: { label: "Roadmap · completed node" } },
      ],
    },
    {
      id: medId(), kind: "activities", title: "Activities", visible: true,
      entries: [{
        id: medId(), title: "Volunteer, campus health awareness drive", subtitle: "Student Health Committee", start: "2024", end: "2025",
        bullets: [
          { id: medId(), text: "Organized a blood donation drive with 150+ participants", provenance: { label: "Evidence · reviewed CV" } },
        ],
      }],
    },
    {
      id: medId(), kind: "languages", title: "Languages", visible: true,
      languages: [
        { id: medId(), name: "Arabic", level: "Native" },
        { id: medId(), name: "English", level: "Fluent (IELTS 7.0)" },
      ],
    },
  ],
}

export const CV_FIXTURES: Record<CvPersona, CvDocument> = { cs: CS_CV, medicine: MED_CV }

// ---------------------------------------------------------------------------------------------
// Mock co-op offers for "Tailor to a co-op offer"
// ---------------------------------------------------------------------------------------------

export const CV_OFFERS: Record<CvPersona, CvOffer[]> = {
  cs: [
    {
      id: "offer-sdaia", company: "SDAIA", title: "AI/ML Co-op Engineer",
      keywords: ["Python", "PyTorch", "Machine Learning", "Kubernetes", "Data pipelines"],
      tailoredSummary: "AI/CS undergraduate focused on applied machine learning and production ML pipelines, with project experience training and shipping PyTorch models alongside Kubernetes-based services.",
    },
    {
      id: "offer-stc", company: "stc", title: "Software Engineering Intern — Cloud Platform",
      keywords: ["Go", "Kubernetes", "Docker", "Backend", "Distributed Systems"],
      tailoredSummary: "AI/CS undergraduate with backend and cloud infrastructure experience, including Go services and Kubernetes autoscaling work from a prior co-op.",
    },
    {
      id: "offer-kaust", company: "KAUST", title: "Data Science Co-op",
      keywords: ["Python", "SQL", "Research", "Pandas", "Machine Learning"],
      tailoredSummary: "AI/CS undergraduate with a research-leaning profile, combining data analysis coursework with hands-on machine learning project work.",
    },
  ],
  medicine: [
    {
      id: "offer-kfsh", company: "King Faisal Specialist Hospital", title: "Clinical Research Coordinator Trainee",
      keywords: ["Clinical research", "Biostatistics", "Patient care", "Documentation"],
      tailoredSummary: "Medicine student combining clinical rotation experience with hands-on research coordination on a retrospective cohort study.",
    },
    {
      id: "offer-kaust-health", company: "KAUST Health", title: "Research Assistant — Public Health",
      keywords: ["Public health", "Research", "Biostatistics", "Literature review"],
      tailoredSummary: "Medicine student with a growing public health research interest, including a co-authored cohort study and relevant coursework.",
    },
    {
      id: "offer-sfda", company: "SFDA", title: "Pharmacy Co-op Trainee",
      keywords: ["Regulatory", "Documentation", "Patient care", "Clinical"],
      tailoredSummary: "Medicine student with strong clinical documentation habits from inpatient rotations and an interest in regulatory and patient-safety work.",
    },
  ],
}

function allText(doc: CvDocument): string {
  const parts: string[] = [doc.contact.name, doc.contact.headline]
  for (const section of doc.sections) {
    if (section.summary) parts.push(section.summary)
    for (const entry of section.entries ?? []) {
      parts.push(entry.title, entry.subtitle ?? "")
      for (const bullet of entry.bullets) parts.push(bullet.text)
    }
    for (const group of section.skills ?? []) parts.push(...group.items)
    for (const cert of section.certificates ?? []) parts.push(cert.name)
  }
  return parts.join(" \n ").toLowerCase()
}

/** Mock Jev-style fit score: keyword overlap between the offer and everything on the CV. */
export function computeFit(doc: CvDocument, offer: CvOffer): CvFit {
  const haystack = allText(doc)
  const matched: string[] = []
  const missing: CvFitMissing[] = []
  for (const keyword of offer.keywords) {
    if (haystack.includes(keyword.toLowerCase())) matched.push(keyword)
    else missing.push({ keyword, suggestion: `Add a bullet or skill mentioning "${keyword}" if you have related experience.` })
  }
  const score = Math.round((matched.length / Math.max(1, offer.keywords.length)) * 100)
  return { score, matched, missing }
}

function mentionsAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase()
  return keywords.some((keyword) => lower.includes(keyword.toLowerCase()))
}

/**
 * Mock "tailor" rewrite: swaps the summary for the offer-specific variant and brings bullets /
 * skills that mention a matched keyword to the front of their list. A real Phase B version would
 * run this through a tool-less Hermes prompt instead of a deterministic sort.
 */
export function tailorDocument(doc: CvDocument, offer: CvOffer): CvDocument {
  const keywords = offer.keywords
  const sections = doc.sections.map((section): CvSection => {
    if (section.kind === "summary") return { ...section, summary: offer.tailoredSummary }
    if (section.entries) {
      return {
        ...section,
        entries: section.entries.map((entry) => ({
          ...entry,
          bullets: [...entry.bullets].sort((a, b) => Number(mentionsAny(b.text, keywords)) - Number(mentionsAny(a.text, keywords))),
        })),
      }
    }
    if (section.skills) {
      return {
        ...section,
        skills: section.skills.map((group) => ({
          ...group,
          items: [...group.items].sort((a, b) => Number(mentionsAny(b, keywords)) - Number(mentionsAny(a, keywords))),
        })),
      }
    }
    return section
  })
  return { ...doc, sections }
}

/** Reads `?mock=cv&persona=cs|medicine` — dev-only preview, never active in production. */
export function readMockCvParams(search: string): { active: boolean; persona: CvPersona } {
  const params = new URLSearchParams(search)
  const active = params.get("mock") === "cv"
  const persona = params.get("persona") === "medicine" ? "medicine" : "cs"
  return { active, persona }
}
