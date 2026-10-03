import type { BlackboardFile } from "./blackboard-catalog"

export const MATERIAL_KINDS = ["lectures", "assignments", "courseInfo", "documents"] as const
export type MaterialKind = typeof MATERIAL_KINDS[number]

/** Metadata only: browsing and filtering never downloads the original. */
export function materialKind(file: BlackboardFile): MaterialKind {
  const label = `${file.filename} ${file.title} ${file.path}`.toLowerCase().replace(/[_-]/g, " ")
  // Specific non-lecture labels win even inside a Lectures folder.
  if (/syllabus|course\s*(outline|specification|plan|description)|grading\s*policy|توصيف|خطة\s*المقرر|سياسة\s*التقييم/.test(label)) return "courseInfo"
  if (/assignment|homework|worksheet|exercise|rubric|\bquiz\b|\bexam\b|lab\s*(manual|sheet|task)|project\s*(brief|report|presentation|proposal)|تكليف|واجب|تمارين|اختبار|مشروع/.test(label)) return "assignments"
  if (/lectures?|slides?|\blec\s*\d|chapters?|\bch\s*\d|week\s*\d|محاضر|شرائح|الفصل\s*\d|الأسبوع/.test(label)
    || /\.pptx?$/i.test(file.filename)) return "lectures"
  return "documents"
}
