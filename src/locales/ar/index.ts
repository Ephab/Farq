// Modern Standard Arabic for a university app. Product and model names (Waypoint, Hermes,
// Gemini) stay in Latin script; students know them by those names.
import { core } from "./core"
import { onboarding } from "./onboarding"
import { dashboard } from "./dashboard"
import { roadmap } from "./roadmap"
import { coach } from "./coach"
import { emails } from "./emails"
import { teams } from "./teams"
import { quiz } from "./quiz"
import { slides } from "./slides"
import { connections } from "./connections"

export const ar = { ...core, onboarding, dashboard, roadmap, coach, emails, teams, quiz, slides, connections }
