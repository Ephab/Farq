import { useEffect, type RefObject } from "react"

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
const modalStack: HTMLElement[] = []

/** Modal dialog keyboard behavior: focus moves into the dialog, Tab stays inside it, Escape
 *  closes it, and focus returns to whatever opened it. */
export function useModalFocus(container: RefObject<HTMLElement | null>, onClose: () => void, initial?: RefObject<HTMLElement | null>, returnFocus?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const modal = container.current
    if (modal) modalStack.push(modal)
    const previous = returnFocus?.current ?? document.activeElement as HTMLElement | null
    const first = initial?.current ?? container.current?.querySelector<HTMLElement>(FOCUSABLE) ?? container.current
    first?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      // A sheet can open another sheet (for example an invitation code).
      // Only the top dialog may trap focus or consume Escape.
      if (!modal || modalStack[modalStack.length - 1] !== modal) return
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== "Tab" || !container.current) return
      const focusable = Array.from(container.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(element => element.getClientRects().length > 0)
      if (focusable.length === 0) return
      const head = focusable[0]
      const tail = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault()
        tail.focus()
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault()
        head.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("keydown", onKey)
      const index = modal ? modalStack.indexOf(modal) : -1
      if (index !== -1) modalStack.splice(index, 1)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
    // Run once per opening; onClose changing identity must not steal focus back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
