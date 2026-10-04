import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Download, FolderOpen, LoaderCircle, Presentation, RefreshCw, X } from "lucide-react"
import { api, getCurrentStudentId } from "@/lib/waypoint-api"
import { blackboardFileTitle, fetchBlackboardFile, type BlackboardFile } from "@/lib/blackboard-catalog"
import { useI18n } from "@/lib/i18n/context"
import { parsePptxDesign } from "@/lib/pptx-design"
import { renderPdfPages } from "@/lib/pdf-pages"
import { NEUTRAL_THEME, type ViewerSlide } from "@/lib/deck-viewer"
import { DeckPreview, SlideFrame } from "./DeckPreview"
import { MATERIAL_KINDS, materialKind, type MaterialKind } from "@/lib/blackboard-materials"

export function BlackboardFiles({ files: supplied, onUse }: { files?: BlackboardFile[]; onUse?: (file: File) => void }) {
  const { t, fmt } = useI18n()
  const [files, setFiles] = useState<BlackboardFile[]>(supplied || [])
  const [loading, setLoading] = useState(!supplied)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [term, setTerm] = useState("")
  const [course, setCourse] = useState(supplied?.length && supplied.every((f) => f.course_id === supplied[0].course_id) ? supplied[0].course_id : "")
  const [kind, setKind] = useState<MaterialKind | "all">(supplied ? "all" : "lectures")
  const [format, setFormat] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [opened, setOpened] = useState<{ id: string; file: File; slides: ViewerSlide[]; width: number; aspect: number } | null>(null)
  const [covers, setCovers] = useState<Record<string, { slide: ViewerSlide; width: number; aspect: number }>>({})
  const ctrl = useRef<AbortController | null>(null)
  const previewCtrl = useRef<AbortController | null>(null)
  const cards = useRef(new Map<string, HTMLButtonElement>())
  const toolbarAnchor = useRef<HTMLDivElement>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  const panelContent = useRef<HTMLDivElement>(null)
  const [floatingToolbar, setFloatingToolbar] = useState(false)
  const [panelInView, setPanelInView] = useState(true)
  const [previewProgress, setPreviewProgress] = useState<{ done: number; total: number } | null>(null)
  const [previewNote, setPreviewNote] = useState("")
  const viewerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const anchor = toolbarAnchor.current
    if (!anchor) return
    const observer = new IntersectionObserver(([entry]) => {
      setFloatingToolbar(!entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0))
    })
    observer.observe(anchor)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const content = panelContent.current
    if (!content) return
    // Observe the panel's normal content, excluding the sticky controls themselves.
    const observer = new IntersectionObserver(([entry]) => setPanelInView(entry.isIntersecting))
    observer.observe(content)
    return () => observer.disconnect()
  }, [])
  useEffect(() => () => { ctrl.current?.abort(); previewCtrl.current?.abort() }, [])
  useEffect(() => {
    ctrl.current?.abort(); setBusy(null); setOpened(null)
    previewCtrl.current?.abort(); setPreviewProgress(null); setPreviewNote("")
  }, [course, term, kind, format, query, supplied])
  async function refresh() {
    setLoading(true); setError(null)
    try { setFiles((await api<{ files: BlackboardFile[] }>(`/api/students/${getCurrentStudentId()}/blackboard/slides`)).files) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }
  useEffect(() => { if (supplied) setFiles(supplied); else void refresh() }, [supplied])
  async function open(item: BlackboardFile) {
    previewCtrl.current?.abort(); setPreviewProgress(null)
    ctrl.current?.abort()
    const request = new AbortController(); ctrl.current = request
    setBusy(item.id); setError(null); setOpened(null)
    try {
      const file = await fetchBlackboardFile(item, request.signal)
      if (request.signal.aborted) return
      // Keep just one opened original in memory. A reload releases it.
      setOpened({ id: item.id, file, slides: [], width: 960, aspect: 16 / 9 })
      let slides: ViewerSlide[] = [], width = 960, aspect = 16 / 9
      if (/\.pdf$/i.test(file.name)) {
        const pdf = await renderPdfPages(file)
        width = pdf.width; aspect = pdf.width / pdf.height
        slides = pdf.images.map((src, i) => ({ key: `${item.id}-${i}`, label: t("slides.preview.pageLabel", { n: i + 1 }),
          isNew: false, background: "#fff", rasterSrc: src, theme: NEUTRAL_THEME }))
      } else if (/\.pptx$/i.test(file.name)) {
        const deck = await parsePptxDesign(file)
        width = deck.width; aspect = deck.width / deck.height
        slides = deck.slides.map((slide, i) => ({ key: `${item.id}-${i}`, label: t("slides.preview.slideLabel", { n: i + 1 }),
          isNew: false, background: slide.background || deck.theme.background, shapes: slide.shapes, images: slide.images, theme: deck.theme }))
      }
      if (request.signal.aborted) return
      setOpened({ id: item.id, file, slides, width, aspect })
      if (slides[0]) setCovers((prev) => ({ ...prev, [item.id]: { slide: slides[0], width, aspect } }))
      window.requestAnimationFrame(() => viewerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }))
    } catch (e) { if (!request.signal.aborted) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (!request.signal.aborted) setBusy(null) }
  }
  function save() {
    if (!opened) return
    const url = URL.createObjectURL(opened.file), link = document.createElement("a")
    link.href = url; link.download = opened.file.name; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const terms = [...new Set(files.map((f) => f.term || f.term_id))].sort().reverse()
  const termFiles = files.filter((f) => !term || (f.term || f.term_id) === term)
  const courses = [...new Map(termFiles.map((f) => [f.course_id, f.course])).entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }))
  const matching = termFiles.filter((f) => (!course || f.course_id === course)
    && (!format || f.filename.toLowerCase().endsWith(`.${format}`))
    && `${f.filename} ${f.title} ${f.course} ${f.path}`.toLowerCase().includes(query.trim().toLowerCase()))
  const visible = matching.filter((f) => kind === "all" || materialKind(f) === kind)
    .sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }))
  const folders = courses.map(([id, name]) => ({ id, name, files: visible.filter((f) => f.course_id === id) })).filter((c) => c.files.length)
  const selectedCourse = courses.find(([id]) => id === course)?.[1]
  const groups = MATERIAL_KINDS.map((value) => ({ kind: value, files: visible.filter((f) => materialKind(f) === value) })).filter((g) => g.files.length)
  async function loadScreenPreviews() {
    const toolbarBottom = toolbar.current?.getBoundingClientRect().bottom ?? 0
    const targets = visible.filter((f) => {
      const rect = cards.current.get(f.id)?.getBoundingClientRect()
      return !covers[f.id] && /\.(pdf|pptx)$/i.test(f.filename) && rect
        && rect.bottom > Math.max(0, toolbarBottom) && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth
    })
    if (!targets.length) { setPreviewNote(t("blackboard.library.previewsReady")); return }
    const request = new AbortController(); previewCtrl.current = request
    setPreviewProgress({ done: 0, total: targets.length }); setPreviewNote("")
    let failed = 0
    // Snapshot the viewport at the click; scrolling never fetches additional files.
    // Process one original at a time and retain only its first-slide preview.
    for (let i = 0; i < targets.length; i++) {
      if (request.signal.aborted) return
      const item = targets[i]
      try {
        const file = await fetchBlackboardFile(item, request.signal)
        if (request.signal.aborted) return
        let slide: ViewerSlide | undefined, width = 960, aspect = 16 / 9
        if (/\.pdf$/i.test(file.name)) {
          const pdf = await renderPdfPages(file, 480, 1)
          width = pdf.width; aspect = pdf.width / pdf.height
          slide = { key: `${item.id}-cover`, label: item.filename, isNew: false, background: "#fff", rasterSrc: pdf.images[0], theme: NEUTRAL_THEME }
        } else {
          const deck = await parsePptxDesign(file, 1), first = deck.slides[0]
          width = deck.width; aspect = deck.width / deck.height
          if (first) slide = { key: `${item.id}-cover`, label: item.filename, isNew: false, background: first.background || deck.theme.background, shapes: first.shapes, images: first.images, theme: deck.theme }
        }
        if (request.signal.aborted) return
        if (slide) setCovers((prev) => ({ ...prev, [item.id]: { slide, width, aspect } }))
        else failed++
      } catch { if (request.signal.aborted) return; failed++ }
      setPreviewProgress({ done: i + 1, total: targets.length })
    }
    if (!request.signal.aborted) {
      setPreviewProgress(null)
      setPreviewNote(t(failed ? "blackboard.library.previewsFailed" : "blackboard.library.previewsLoaded", { count: failed || targets.length }))
    }
  }
  return <section className="rounded-2xl border border-border bg-card p-4 sm:p-6">
    <div ref={toolbarAnchor} className="h-px" aria-hidden="true" />
    <div ref={toolbar} data-blackboard-toolbar data-floating={floatingToolbar} className={`bb-floating-toolbar sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 transition-[background-color,border-color,box-shadow] ${floatingToolbar && !panelInView ? "invisible pointer-events-none" : ""} ${floatingToolbar ? "border-border bg-card/95 shadow-lg backdrop-blur-sm" : "border-transparent bg-card"}`}>
      <h2 className="flex items-center gap-2 text-lg font-semibold"><Presentation className="size-5" />{t("blackboard.library.title")} <span className="text-sm text-muted-foreground">{fmt.number(files.length)}</span></h2>
      <div className="flex flex-wrap items-center gap-2">
        {previewProgress ? <button onClick={() => { previewCtrl.current?.abort(); setPreviewProgress(null) }} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"><LoaderCircle className="size-4 animate-spin" />{t("blackboard.library.previewProgress", previewProgress)} · {t("blackboard.library.stopPreviews")}</button>
        : <button onClick={() => void loadScreenPreviews()} title={t("blackboard.library.previewHint")} disabled={!course || !!busy || loading || !visible.length} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm disabled:opacity-60"><Presentation className="size-4" />{t("blackboard.library.loadPreviews")}</button>}
        {!supplied && <button onClick={() => void refresh()} disabled={loading} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"><RefreshCw className="size-4" />{t("blackboard.library.refresh")}</button>}
      </div>
    </div>
    <div ref={panelContent} data-blackboard-panel-content>
    <p className="mt-2 text-sm text-muted-foreground">{t("blackboard.library.hint")}</p>
    <div className="mt-4 flex flex-wrap gap-2">
      <input aria-label={t("blackboard.collection.search")} placeholder={t("blackboard.collection.search")} value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 basis-full rounded-xl border bg-background px-3 py-2 text-sm sm:flex-1 sm:basis-48" />
      <select aria-label={t("blackboard.collection.term")} value={term} onChange={(e) => { setTerm(e.target.value); setCourse("") }} className="max-w-full rounded-xl border bg-background px-3 py-2 text-sm"><option value="">{t("blackboard.collection.allTerms")}</option>{terms.map((v) => <option key={v} value={v}>{v || t("blackboard.collection.unknownTerm")}</option>)}</select>
      <select aria-label={t("blackboard.collection.course")} value={course} onChange={(e) => setCourse(e.target.value)} className="max-w-full rounded-xl border bg-background px-3 py-2 text-sm"><option value="">{t("blackboard.collection.allCourses")}</option>{courses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      <select aria-label={t("blackboard.library.format")} value={format} onChange={(e) => setFormat(e.target.value)} className="max-w-full rounded-xl border bg-background px-3 py-2 text-sm"><option value="">{t("blackboard.library.allFormats")}</option>{["pdf", "pptx", "ppt"].map((v) => <option key={v} value={v}>{v.toUpperCase()}</option>)}</select>
    </div>
    <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t("blackboard.library.materialType")}>
      {(["all", ...MATERIAL_KINDS] as const).map((value) => <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)} className={`rounded-full px-3 py-2 text-xs font-medium ${kind === value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
        {t(`blackboard.library.kinds.${value}`)} <span className="ms-1 tabular-nums">{fmt.number(value === "all" ? matching.length : matching.filter((f) => materialKind(f) === value).length)}</span>
      </button>)}
    </div>
    <p className="mt-2 text-xs text-muted-foreground">{t("blackboard.library.classificationHint")}</p>
    {loading && <LoaderCircle className="mt-4 size-5 animate-spin" />}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    {!loading && !visible.length && <p className="mt-5 text-sm text-muted-foreground">{t("blackboard.library.empty")}</p>}
    {!course && folders.length > 0 && <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {folders.map((folder) => <button key={folder.id} onClick={() => setCourse(folder.id)} className="flex items-start gap-3 rounded-2xl border border-border bg-background p-4 text-start transition hover:border-primary hover:bg-muted/30">
        <FolderOpen className="mt-0.5 size-6 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0"><h3 className="break-words text-sm font-semibold" dir="auto">{folder.name}</h3><p className="mt-1 text-xs text-muted-foreground" dir="auto">{folder.files[0].term || folder.files[0].term_id || t("blackboard.collection.unknownTerm")}</p><p className="mt-2 text-xs text-primary">{t("blackboard.library.fileCount", { count: folder.files.length })}</p></div>
      </button>)}
    </div>}
    {course && <div className="mt-4"><div className="flex flex-wrap items-center gap-3"><button onClick={() => setCourse("")} className="inline-flex items-center gap-2 text-sm font-medium text-primary"><ArrowLeft className="size-4 rtl:rotate-180" />{t("blackboard.library.backToSubjects")}</button>
      <h3 className="text-base font-semibold" dir="auto">{selectedCourse}</h3></div>{previewNote && <p className="mt-1 text-xs text-muted-foreground" role="status">{previewNote}</p>}</div>}
    {course && groups.map((group) => <div key={group.kind} className="mt-4">
      <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">{t(`blackboard.library.kinds.${group.kind}`)} <span className="text-xs font-normal text-muted-foreground">{fmt.number(group.files.length)}</span></h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {group.files.map((f) => { const cover = covers[f.id]; return <button key={f.id} ref={(el) => { if (el) cards.current.set(f.id, el); else cards.current.delete(f.id) }} data-blackboard-file={f.id} onClick={() => void open(f)} disabled={!!busy} className="overflow-hidden rounded-2xl border border-border text-start transition hover:border-primary hover:shadow-sm disabled:opacity-60">
        <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-primary/10 via-muted to-primary/5">
          {cover ? <SlideFrame slide={cover.slide} deckWidthPx={cover.width} titleFont={cover.slide.theme.titleFont} bodyFont={cover.slide.theme.bodyFont} /> : <div className="flex h-full flex-col justify-between p-4"><span className="flex items-center gap-2 text-xs font-semibold uppercase text-primary"><Presentation className="size-4" />{f.filename.split(".").pop()}</span><span className="line-clamp-2 text-base font-semibold" dir="auto">{blackboardFileTitle(f.title, f.filename)}</span><span className="text-xs text-muted-foreground">{t("blackboard.library.cover")}</span></div>}
        </div>
        <div className="p-3"><p className="truncate text-sm font-semibold" dir="auto">{f.filename}</p><p className="mt-1 line-clamp-2 text-xs text-muted-foreground" dir="auto">{f.course} · {f.term || f.term_id || t("blackboard.collection.unknownTerm")}</p>
          <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary">{busy === f.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}{t(busy === f.id ? "blackboard.library.loading" : "blackboard.library.open")}{f.size != null && <span className="ms-auto text-muted-foreground">{fmt.number(f.size / (f.size < 1024 * 1024 ? 1024 : 1024 * 1024), { maximumFractionDigits: 1 })} {f.size < 1024 * 1024 ? "KB" : "MB"}</span>}</p></div>
      </button> })}
      </div>
    </div>)}
    {opened && <div ref={viewerRef} className="mt-5 rounded-2xl border bg-background p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2"><h3 className="min-w-0 flex-1 break-words font-semibold" dir="auto">{opened.file.name}</h3>
        <button onClick={save} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"><Download className="size-4" />{t("blackboard.library.save")}</button>
        {onUse && /\.(pdf|pptx)$/i.test(opened.file.name) && <button onClick={() => onUse(opened.file)} className="rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground">{t("blackboard.library.use")}</button>}
        <button aria-label={t("blackboard.collection.close")} onClick={() => { ctrl.current?.abort(); setBusy(null); setOpened(null) }} className="rounded-xl p-2"><X className="size-4" /></button>
      </div>
      {opened.slides.length ? <DeckPreview key={opened.id} slides={opened.slides} deckWidthPx={opened.width} aspect={opened.aspect} /> : <p className="text-sm text-muted-foreground">{t(busy ? "blackboard.library.loading" : "blackboard.library.noPreview")}</p>}
    </div>}
    </div>
  </section>
}
