// Persistent quiz library (localStorage prototype).
// Decks keep their extracted text so generation works without re-upload.
// Saved quizzes keep their questions so they can be retaken anytime.
// Hermes later: swap this file for server-backed storage, same types.

import type { ExtractedSource } from "./quiz-extract";
import type { QuizQuestion } from "./quiz-ai";

export interface SlideDeck {
  id: string;
  fileName: string;
  kind: "pdf" | "pptx";
  units: number;
  chars: number;
  text: string;
  uploadedAt: number;
}

export interface SavedQuiz {
  id: string;
  deckIds: string[];
  deckName: string;
  questions: QuizQuestion[];
  difficulty: string;
  model: string;
  createdAt: number;
}

export interface QuizLibrary {
  decks: SlideDeck[];
  quizzes: SavedQuiz[];
}

const STORAGE_KEY = "smartlearn-quiz-library-v1";

export const EMPTY_LIBRARY: QuizLibrary = { decks: [], quizzes: [] };

export function loadLibrary(): QuizLibrary {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_LIBRARY;
    const parsed = JSON.parse(raw) as Partial<QuizLibrary>;
    const quizzes = Array.isArray(parsed.quizzes) ? parsed.quizzes : [];
    return {
      decks: Array.isArray(parsed.decks) ? parsed.decks : [],
      // Migrate single-deck quizzes saved before multi-select.
      quizzes: quizzes.map((q) => {
        const legacy = q as SavedQuiz & { deckId?: string | null };
        if (Array.isArray(legacy.deckIds)) return legacy as SavedQuiz;
        return {
          ...legacy,
          deckIds: legacy.deckId ? [legacy.deckId] : [],
        } as SavedQuiz;
      }),
    };
  } catch {
    return EMPTY_LIBRARY;
  }
}

/** Returns false when the browser quota is exceeded. */
export function saveLibrary(lib: QuizLibrary): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
    return true;
  } catch {
    return false;
  }
}

export function makeId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `id-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }
}

export function deckFromSource(source: ExtractedSource): SlideDeck {
  return {
    id: makeId(),
    fileName: source.fileName,
    kind: source.kind,
    units: source.units,
    chars: source.chars,
    text: source.text,
    uploadedAt: Date.now(),
  };
}

export type DeckSort = "newest" | "oldest" | "name";

export function sortDecks(decks: SlideDeck[], sort: DeckSort): SlideDeck[] {
  const copy = [...decks];
  if (sort === "name") copy.sort((a, b) => a.fileName.localeCompare(b.fileName));
  else if (sort === "oldest") copy.sort((a, b) => a.uploadedAt - b.uploadedAt);
  else copy.sort((a, b) => b.uploadedAt - a.uploadedAt);
  return copy;
}

export function formatDeckDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

/** Short display label for a set of decks: "a.pdf" or "a.pdf + 2 more". */
export function decksLabel(decks: SlideDeck[]): string {
  if (decks.length === 0) return "";
  if (decks.length === 1) return decks[0].fileName;
  return `${decks[0].fileName} + ${decks.length - 1} more`;
}

/** Join deck texts with file headers so the model can cite sources. */
export function combineDeckTexts(decks: SlideDeck[]): string {
  return decks.map((d) => `=== FILE: ${d.fileName} ===\n${d.text}`).join("\n\n");
}
