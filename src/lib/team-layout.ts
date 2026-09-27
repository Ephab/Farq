/** Studio layout sizes; keep in sync with `.tm-studio` in teams.css. */
export const RAIL_WIDTH = 220
export const STUDIO_GAPS = 28
export const CENTER_MIN = 360
export const DOCK_MIN = 300
export const DOCK_DEFAULT = 360
const DOCK_WIDTH_STORAGE_KEY = "waypoint.team-chat-width"

/** A chat width that fits: at least DOCK_MIN, and never squeezing the board below CENTER_MIN. */
export function clampDockWidth(requested: number, available: number): number {
  const max = available - RAIL_WIDTH - STUDIO_GAPS - CENTER_MIN
  return Math.round(Math.max(DOCK_MIN, Math.min(requested, max)))
}

export function readDockWidth(): number {
  try {
    const saved = Number(window.localStorage.getItem(DOCK_WIDTH_STORAGE_KEY))
    return Number.isFinite(saved) && saved >= DOCK_MIN ? saved : DOCK_DEFAULT
  } catch {
    return DOCK_DEFAULT
  }
}

export function saveDockWidth(width: number): void {
  try {
    window.localStorage.setItem(DOCK_WIDTH_STORAGE_KEY, String(width))
  } catch {
    // Storage unavailable (private mode): the width just isn't remembered.
  }
}
