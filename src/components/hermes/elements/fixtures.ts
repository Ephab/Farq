// Dev-only fixtures for the `?mock=elements` preview (see MockElementsThread.tsx).
// Never imported by production code paths — only by the dev-gated mock harness.
import type { ChatElement, QuizElement } from "@/components/hermes/elements/types"

/** Titles the loader cycles through while "generating" the probability quiz. */
export const MOCK_LOADER_TITLES = [
  "Checking your courses…",
  "Reviewing quiz history…",
  "Generating questions…",
]

export const MOCK_QUIZ_ELEMENT: QuizElement = {
  kind: "quiz",
  id: "mock-quiz-probability",
  title: "Probability — 5 questions",
  questions: [
    {
      id: "p1",
      type: "mcq",
      stem: "You flip a fair coin twice. What is the probability of getting exactly one head?",
      options: ["1/4", "1/2", "3/4", "1/3"],
      answer: "1/2",
      explanation: "Two of the four equally likely outcomes (HT, TH) have exactly one head: 2/4 = 1/2.",
      difficulty: "easy",
      time_limit_s: 60,
    },
    {
      id: "p2",
      type: "true_false",
      stem: "If two events are independent, then P(A and B) = P(A) · P(B).",
      answer: "True",
      explanation: "That's the definition of independence for two events.",
      difficulty: "easy",
      time_limit_s: 45,
    },
    {
      id: "p3",
      type: "mcq",
      stem: "A bag has 4 red and 6 blue marbles. One is drawn at random. What is P(red)?",
      options: ["0.4", "0.6", "0.1", "0.24"],
      answer: "0.4",
      explanation: "4 red out of 10 total marbles: 4/10 = 0.4.",
      difficulty: "easy",
      time_limit_s: 60,
    },
    {
      id: "p4",
      type: "mcq",
      stem: "Rolling two fair six-sided dice, what is the probability the sum is 7?",
      options: ["1/6", "1/12", "1/36", "1/8"],
      answer: "1/6",
      explanation: "6 of the 36 equally likely outcomes sum to 7 (1-6, 2-5, 3-4, 4-3, 5-2, 6-1): 6/36 = 1/6.",
      difficulty: "medium",
      time_limit_s: 90,
    },
    {
      id: "p5",
      type: "short_answer",
      stem: "In one sentence, what does Bayes' theorem let you do?",
      answer: "It lets you update the probability of a hypothesis given new evidence, using the prior probability and the likelihood of the evidence.",
      explanation: "P(H|E) = P(E|H)·P(H) / P(E) — it reverses a conditional probability.",
      difficulty: "medium",
      time_limit_s: 120,
    },
  ],
}

/** A second assistant message showcasing the rest of the element palette. */
export const MOCK_SHOWCASE_ELEMENTS: ChatElement[] = [
  {
    kind: "progress",
    id: "mock-progress-plan",
    title: "This week's study plan",
    style: "steps",
    current: 2,
    total: 4,
    steps: [
      { id: "s1", label: "Review probability basics", done: true },
      { id: "s2", label: "Take the practice quiz", done: true },
      { id: "s3", label: "Work through Bayes' theorem examples" },
      { id: "s4", label: "Mock exam under timed conditions" },
    ],
  },
  {
    kind: "timer",
    id: "mock-timer-focus",
    label: "Focused practice block",
    duration_s: 300,
    warning_s: 60,
    autostart: true,
  },
  {
    kind: "flashcards",
    id: "mock-flashcards-terms",
    title: "Key terms",
    cards: [
      { id: "f1", front: "Independent events", back: "P(A ∩ B) = P(A) · P(B) — one event's outcome doesn't affect the other." },
      { id: "f2", front: "Conditional probability", back: "P(A|B) = P(A ∩ B) / P(B) — the chance of A given B already happened." },
      { id: "f3", front: "Expected value", back: "The long-run average outcome: Σ (value × probability)." },
    ],
  },
  {
    kind: "checklist",
    id: "mock-checklist-session",
    title: "Before the exam",
    items: [
      { id: "c1", label: "Re-read the Bayes' theorem derivation", done: true },
      { id: "c2", label: "Redo yesterday's missed questions" },
      { id: "c3", label: "Time yourself on a 10-question set" },
    ],
  },
  {
    kind: "table",
    id: "mock-table-distributions",
    title: "Which distribution fits?",
    columns: ["Situation", "Distribution", "Use when"],
    rows: [
      ["Coin flips, fixed trials", "Binomial", "Counting successes in n independent trials"],
      ["Rare events over time", "Poisson", "Average rate known, events independent"],
      ["Continuous measurement", "Normal", "Many small independent effects sum up"],
    ],
    highlight_column: 1,
  },
  {
    kind: "callout",
    id: "mock-callout-tip",
    tone: "tip",
    title: "Quick tip",
    body: "When a question gives you \"at least one\", it's usually faster to compute 1 − P(none).",
  },
  {
    kind: "code",
    id: "mock-code-snippet",
    language: "python",
    caption: "Quick Monte Carlo check for the sum-of-two-dice question.",
    code: "import random\n\ntrials = 100_000\nhits = sum(\n    1 for _ in range(trials)\n    if random.randint(1, 6) + random.randint(1, 6) == 7\n)\nprint(hits / trials)  # ~0.1667\n",
  },
]
