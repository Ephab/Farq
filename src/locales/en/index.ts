// English is the source catalog and fallback. One file per feature namespace; add keys to the
// English file first, then the Arabic file with the same name must match (CatalogShape fails tsc).
// `core` is spread to the top level so shared keys read as common.*, nav.*, header.*, settings.*.
import { core } from "./core"
import { onboarding } from "./onboarding"
import { dashboard } from "./dashboard"
import { roadmap } from "./roadmap"
import { coach } from "./coach"
import { emails } from "./emails"
import { teams } from "./teams"
import { quiz } from "./quiz"
import { slides } from "./slides"

export const en = { ...core, onboarding, dashboard, roadmap, coach, emails, teams, quiz, slides } as const
