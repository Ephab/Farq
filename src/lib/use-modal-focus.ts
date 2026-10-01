import { useEffect, type RefObject } from "react"

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"

/** Modal dialog keyboard behavior: focus moves into the dialog, Tab stays inside it, Escape
 *  closes it, and focus returns to whatever opened it. */
export function useModalFocus(container: RefObject<HTMLElement | null>, onClose: () => void, initial?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = initial?.current ?? container.current?.querySelector<HTMLElement>(FOCUSABLE) ?? container.current
    first?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== "Tab" || !container.current) return
      const focusable = Array.from(container.current.querySelectorAll<HTMLElement>(FOCUSABLE))
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
      previous?.focus?.({ preventScroll: true })
    }
    // Run once per opening; onClose changing identity must not steal focus back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
