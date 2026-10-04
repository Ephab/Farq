"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronDown, GraduationCap, Loader2, Search } from "lucide-react";
import { api, getCurrentStudentId } from "@/lib/waypoint-api";
import { type BlackboardFile } from "@/lib/blackboard-catalog";
import { materialKind } from "@/lib/blackboard-materials";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { SlideDeck } from "@/lib/quiz-store";

interface QuizSidebarProps {
  decks: SlideDeck[];
  selectedDeckIds: string[];
  onToggleLecture: (file: BlackboardFile) => void;
  busyLectureIds: string[];
}

function isQuizable(file: BlackboardFile): boolean {
  if (!/\.(pdf|pptx)$/i.test(file.filename)) return false;
  return materialKind(file) === "lectures";
}

export function QuizSidebar({ decks, selectedDeckIds, onToggleLecture, busyLectureIds }: QuizSidebarProps) {
  const { t } = useI18n();
  const [files, setFiles] = useState<BlackboardFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let stopped = false;
    setLoading(true);
    setLoadError(null);
    api<{ files: BlackboardFile[] }>(`/api/students/${getCurrentStudentId()}/blackboard/slides`)
      .then((res) => {
        if (!stopped) setFiles(Array.isArray(res.files) ? res.files : []);
      })
      .catch((e) => {
        if (!stopped) setLoadError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!stopped) setLoading(false);
      });
    return () => {
      stopped = true;
    };
  }, []);

  const lectures = useMemo(() => files.filter(isQuizable), [files]);

  const terms = useMemo(
    () => [...new Set(lectures.map((f) => f.term || f.term_id))].sort().reverse(),
    [lectures],
  );

  // Default to the term holding the current courses; fall back to the newest term.
  useEffect(() => {
    if (term || terms.length === 0) return;
    const current = terms.find((v) =>
      lectures.some((f) => (f.term || f.term_id) === v && f.status === "current"),
    );
    setTerm(current ?? terms[0]);
  }, [terms, lectures, term]);

  const deckByName = useMemo(() => {
    const map = new Map<string, SlideDeck>();
    for (const d of decks) {
      if (!map.has(d.fileName)) map.set(d.fileName, d);
    }
    return map;
  }, [decks]);

  const selectedDeckSet = useMemo(() => new Set(selectedDeckIds), [selectedDeckIds]);
  const busySet = useMemo(() => new Set(busyLectureIds), [busyLectureIds]);

  const termLectures = useMemo(
    () => lectures.filter((f) => !term || (f.term || f.term_id) === term),
    [lectures, term],
  );

  const courses = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byCourse = new Map<string, { id: string; name: string; term: string; files: BlackboardFile[] }>();
    for (const f of termLectures) {
      if (q && !`${f.filename} ${f.title} ${f.course}`.toLowerCase().includes(q)) continue;
      const key = f.course_id || f.course;
      const entry = byCourse.get(key) ?? { id: key, name: f.course, term: f.term || f.term_id, files: [] };
      entry.files.push(f);
      byCourse.set(key, entry);
    }
    return [...byCourse.values()]
      .map((c) => ({ ...c, files: c.files.sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true })) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [termLectures, query]);

  // Expand the first subject by default when the term (or course list) changes.
  useEffect(() => {
    if (courses.length === 0) return;
    setExpanded((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      return { [courses[0].id]: true };
    });
  }, [courses, term]);

  useEffect(() => {
    setExpanded({});
  }, [term]);

  const lectureSelected = (f: BlackboardFile): boolean => {
    const deck = deckByName.get(f.filename);
    return deck ? selectedDeckSet.has(deck.id) : false;
  };

  const selectedInTerm = termLectures.filter(lectureSelected).length;

  const toggleCourse = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const retry = () => {
    setLoading(true);
    setLoadError(null);
    api<{ files: BlackboardFile[] }>(`/api/students/${getCurrentStudentId()}/blackboard/slides`)
      .then((res) => setFiles(Array.isArray(res.files) ? res.files : []))
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  return (
    <aside
      aria-label={t("quiz.sidebar.title")}
      className="w-full shrink-0 rounded-2xl border border-border bg-background lg:sticky lg:top-4 lg:w-80"
    >
      <div className="border-b border-border p-4">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <GraduationCap className="size-4 text-primary" aria-hidden="true" />
          {t("quiz.sidebar.title")}
        </h2>
        {selectedInTerm > 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("quiz.sidebar.selectedCount", { count: selectedInTerm })}
          </p>
        ) : null}
        <label className="mt-3 block">
          <span className="sr-only">{t("quiz.sidebar.termAria")}</span>
          <select
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            aria-label={t("quiz.sidebar.termAria")}
            className="h-9 w-full appearance-none rounded-xl border border-border bg-background px-3 text-[13px] font-medium outline-none focus:ring-2 focus:ring-ring"
          >
            {terms.map((v) => (
              <option key={v} value={v}>
                {v || t("quiz.sidebar.unknownTerm")}
              </option>
            ))}
          </select>
        </label>
        <label className="relative mt-2 block">
          <span className="sr-only">{t("quiz.sidebar.searchAria")}</span>
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("quiz.sidebar.searchPlaceholder")}
            className="h-9 w-full rounded-xl border border-border bg-background ps-9 pe-3 text-[13px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
        </label>
      </div>

      <div className="max-h-[60vh] overflow-y-auto p-2 lg:max-h-[calc(100vh-24rem)]">
        {loading ? (
          <p className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {t("quiz.sidebar.loading")}
          </p>
        ) : loadError ? (
          <div role="alert" className="m-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[13px]">
            <p>{loadError}</p>
            <button
              type="button"
              onClick={retry}
              className="mt-2 h-8 rounded-xl border border-border bg-background px-3 text-[13px] font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("quiz.sidebar.retry")}
            </button>
          </div>
        ) : courses.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
            {lectures.length === 0 ? t("quiz.sidebar.empty") : t("quiz.sidebar.noMatch")}
          </p>
        ) : (
          courses.map((course) => {
            const open = !!expanded[course.id];
            const picked = course.files.filter(lectureSelected).length;
            return (
              <div key={course.id} className="mb-1 overflow-hidden rounded-xl border border-border">
                <button
                  type="button"
                  onClick={() => toggleCourse(course.id)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-2 bg-muted/40 px-3 py-2.5 text-start outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <BookOpen className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold" dir="auto">
                      {course.name}
                    </span>
                    <span className="block text-xs tabular-nums text-muted-foreground">
                      {t("quiz.sidebar.lectureCount", { count: course.files.length })}
                      {picked > 0 ? ` · ${t("quiz.sidebar.pickedCount", { count: picked })}` : ""}
                    </span>
                  </span>
                  <ChevronDown
                    className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
                    aria-hidden="true"
                  />
                </button>
                {open ? (
                  <ul className="flex flex-col gap-0.5 p-1.5">
                    {course.files.map((f) => {
                      const deck = deckByName.get(f.filename);
                      const checked = deck ? selectedDeckSet.has(deck.id) : false;
                      const busy = busySet.has(f.id);
                      return (
                        <li key={f.id}>
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={checked}
                            aria-label={t("quiz.sidebar.toggleLecture", { name: f.filename })}
                            disabled={busy}
                            onClick={() => onToggleLecture(f)}
                            className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-start outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                          >
                            <span
                              aria-hidden="true"
                              className={cn(
                                "grid size-5 shrink-0 place-items-center rounded-md border text-[11px] font-bold",
                                checked
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border text-transparent",
                              )}
                            >
                              ✓
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-medium" dir="ltr">
                                {f.filename}
                              </span>
                              {f.title && f.title !== f.filename ? (
                                <span className="block truncate text-xs text-muted-foreground" dir="auto">
                                  {f.title}
                                </span>
                              ) : null}
                            </span>
                            {busy ? (
                              <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {!loading && !loadError && lectures.length > 0 ? (
        <p className="border-t border-border px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
          {t("quiz.sidebar.hint")}
        </p>
      ) : null}
    </aside>
  );
}
