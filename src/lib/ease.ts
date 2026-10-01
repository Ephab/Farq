// Waypoint motion tokens. One language across the app: things glide into place and settle, they
// never bounce. Lengths are deliberately a little unhurried (0.42s controls, 0.56s panels and pages).
// The CSS side of the same language lives in index.css (--ease-glide, .wp-* and .rm-* animations).
export const EASE_OUT = [0.22, 1, 0.36, 1] as const
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const

/** CSS string form of EASE_OUT for inline style transitions. */
export const EASE_OUT_CSS = "cubic-bezier(0.22, 1, 0.36, 1)"

/** Press feedback on buttons and other tappable surfaces. */
export const SPRING_PRESS = {
  type: "spring",
  visualDuration: 0.3,
  bounce: 0,
} as const

/** Content swaps — label/icon slots trading places inside a control. */
export const SPRING_SWAP = {
  type: "spring",
  visualDuration: 0.42,
  bounce: 0,
} as const

/** Overlay panel entrances — modals and sheets summoned by pointer. */
export const SPRING_PANEL = {
  type: "spring",
  visualDuration: 0.56,
  bounce: 0,
} as const

/** Shared-layout glides — pills, indicators and panels morphing between positions. */
export const SPRING_LAYOUT = {
  type: "spring",
  visualDuration: 0.5,
  bounce: 0,
} as const

/** Cursor-follow physics for decorative mouse tracking (magnetic, tilt, dock). */
export const SPRING_MOUSE = {
  stiffness: 140,
  damping: 22,
  mass: 0.4,
} as const

/** Dragged handles and fills (sliders) — critically damped `useSpring` config. */
export const SPRING_GLIDE = {
  stiffness: 700,
  damping: 50,
  mass: 0.5,
} as const
