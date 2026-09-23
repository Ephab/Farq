export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ""

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try {
      const payload = await response.json() as { detail?: string }
      if (payload.detail) message = payload.detail
    } catch {
      // Keep the HTTP status when the server did not return JSON.
    }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

export const DEMO_STUDENT_ID = "demo-student"

