import type { QuizQuestion } from "./quiz-ai";

export interface QuizAnswer {
  given: string;
  correct: boolean;
  revealed: boolean;
  /** short_answer self-grade */
  selfMarked?: boolean;
  /** When it was checked, so the streak follows answer order, not question order. */
  answeredAt?: number;
}

/** A short answer counts only once the student grades it; until then it is neither right nor wrong. */
export function isGraded(question: QuizQuestion, answer: QuizAnswer | undefined): boolean {
  return Boolean(answer?.revealed) && (question.type !== "short_answer" || Boolean(answer?.selfMarked));
}

/** Display text for an option: True/False values are stored in English and shown in the UI language. */
export function optionLabel(question: QuizQuestion, value: string, t: (key: "quiz.runner.trueLabel" | "quiz.runner.falseLabel") => string): string {
  if (question.type !== "true_false") return value;
  return value === "True" ? t("quiz.runner.trueLabel") : value === "False" ? t("quiz.runner.falseLabel") : value;
}
