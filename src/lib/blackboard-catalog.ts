import { API_BASE, getCurrentStudentId, identityHeaders } from "./waypoint-api"

export type CourseStatus = "current" | "past" | "upcoming" | "completed" | "unknown"
export interface BlackboardFile {
  id: string; title: string; filename: string; mime_type: string; size: number | null
  path: string; text_indexed: boolean; course_id: string; course: string
  term: string; term_id: string; status: CourseStatus; is_slide: boolean
}
export interface CollectedCourse {
  id: string; external_id: string; code: string; title: string; term: string; term_id: string
  status: CourseStatus; is_current: boolean; source_kind: string; url: string
  instructors: { name: string; email?: string }[]; grade_summary: Record<string, unknown>
  metadata: Record<string, unknown>; files: BlackboardFile[]
  items: { id: string; title: string; type: string; text: string; filename: string; url: string; due_at: string | null; source_ref: string }[]
  grades: { id: string; title: string; score: number | null; possible: number | null; percentage: number | null; status: string; feedback: string }[]
}
export interface BlackboardCollection {
  courses: CollectedCourse[]; events: Record<string, unknown>[]; diagnostics: Record<string, unknown>
  snapshot: Record<string, unknown>; exported_at: string | null; has_file_catalog: boolean
}
export function blackboardFileTitle(title: string, filename: string): string {
  return !title || /^ultra[\s_-]*document[\s_-]*body$/i.test(title.trim()) ? filename : title
}
export async function fetchBlackboardFile(file: BlackboardFile, signal?: AbortSignal): Promise<File> {
  const response = await fetch(`${API_BASE}/api/students/${getCurrentStudentId()}/blackboard/files/${file.id}/download`, {
    headers: identityHeaders(), cache: "no-store", signal,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.detail || `Download failed (${response.status})`)
  }
  return new File([await response.blob()], file.filename, { type: response.headers.get("content-type") || file.mime_type })
}
