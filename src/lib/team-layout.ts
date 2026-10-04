/** Studio layout sizes; keep in sync with `.tm-studio` in teams.css. */
export const RAIL_WIDTH = 220
export const RAIL_MIN = 180
export const RAIL_MAX = 420
export const STUDIO_GAPS = 28
export const CENTER_MIN = 360
export const DOCK_MIN = 300
export const DOCK_DEFAULT = 360
const DOCK_WIDTH_STORAGE_KEY = "waypoint.team-chat-width"
const RAIL_WIDTH_STORAGE_KEY = "waypoint.team-rail-width"

/** A chat width that fits: at least DOCK_MIN, and never squeezing the board below CENTER_MIN. */
export function clampDockWidth(requested: number, available: number, rail: number = RAIL_WIDTH): number {
  const max = available - rail - STUDIO_GAPS - CENTER_MIN
  return Math.round(Math.max(DOCK_MIN, Math.min(requested, max)))
}

/** A rail width between RAIL_MIN and RAIL_MAX that never squeezes the board below CENTER_MIN. */
export function clampRailWidth(requested: number, available: number, dock: number): number {
  const max = Math.min(RAIL_MAX, available - dock - STUDIO_GAPS - CENTER_MIN)
  return Math.round(Math.max(RAIL_MIN, Math.min(requested, max)))
}

function readWidth(key: string, min: number, fallback: number): number {
  try {
    const saved = Number(window.localStorage.getItem(key))
    return Number.isFinite(saved) && saved >= min ? saved : fallback
  } catch {
    return fallback
  }
}

function saveWidth(key: string, width: number): void {
  try {
    window.localStorage.setItem(key, String(width))
  } catch {
    // Storage unavailable (private mode): the width just isn't remembered.
  }
}

export const readDockWidth = () => readWidth(DOCK_WIDTH_STORAGE_KEY, DOCK_MIN, DOCK_DEFAULT)
export const saveDockWidth = (width: number) => saveWidth(DOCK_WIDTH_STORAGE_KEY, width)
export const readRailWidth = () => Math.min(RAIL_MAX, readWidth(RAIL_WIDTH_STORAGE_KEY, RAIL_MIN, RAIL_WIDTH))
export const saveRailWidth = (width: number) => saveWidth(RAIL_WIDTH_STORAGE_KEY, width)
