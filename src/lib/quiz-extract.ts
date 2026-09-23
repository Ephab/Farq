// Client-side slide text extraction (PDF + PPTX). No uploads, no server.
// pdfjs + jszip are dynamically imported so they only load when the
// Quizzes tab parses a file — not on initial app boot.

export interface ExtractedSource {
  fileName: string;
  kind: "pdf" | "pptx";
  /** Joined slide/page text with unit headers ("[Slide 2]\n..."). */
  text: string;
  units: number;
  truncated: boolean;
  chars: number;
}

export const MAX_FILE_MB = 25;
const MAX_UNITS = 60; // pages/slides parsed max
const MAX_CHARS = 60_000; // local cap before AI truncation

function checkSize(file: File) {
  const mb = file.size / (1024 * 1024);
  if (mb > MAX_FILE_MB) {
    throw new Error(`File is ${mb.toFixed(1)}MB — keep it under ${MAX_FILE_MB}MB for in-browser parsing.`);
  }
}

export async function extractPdf(file: File): Promise<ExtractedSource> {
  checkSize(file);
  let pdfjs: typeof import("pdfjs-dist");
  try {
    pdfjs = await import("pdfjs-dist");
    const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  } catch {
    throw new Error("PDF engine failed to start. Reload the page and try again.");
  }
  let buf: ArrayBuffer;
  try {
    buf = await file.arrayBuffer();
  } catch {
    throw new Error(`Couldn't read “${file.name}”. The file may be locked or corrupted.`);
  }
  let loadingTask: ReturnType<typeof pdfjs.getDocument>;
  try {
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buf),
      useSystemFonts: true,
    });
  } catch {
    throw new Error(`“${file.name}” doesn't look like a valid PDF.`);
  }
  // NOTE: in pdfjs-dist v5+, destroy() lives on the loading task,
  // not on the document proxy.
  let pdf: Awaited<typeof loadingTask.promise>;
  try {
    pdf = await loadingTask.promise;
  } catch {
    try {
      await loadingTask.destroy();
    } catch {
      // ignore cleanup errors
    }
    throw new Error(`Couldn't parse “${file.name}”. Password-protected or image-only PDFs aren't supported yet.`);
  }
  const pages = Math.min(pdf.numPages, MAX_UNITS);
  const parts: string[] = [];
  for (let i = 1; i <= pages; i++) {
    let strings = "";
    try {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      strings = content.items
        .map((it) => ("str" in it ? (it as { str: string }).str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    } catch {
      // Skip unreadable pages instead of failing the whole file.
    }
    if (strings) parts.push(`[Page ${i}]\n${strings}`);
  }
  const result = finalize(file.name, "pdf", parts, pdf.numPages);
  try {
    await loadingTask.destroy();
  } catch {
    // Cleanup is best-effort; extraction already succeeded.
  }
  return result;
}

export async function extractPptx(file: File): Promise<ExtractedSource> {
  checkSize(file);
  let zip: import("jszip");
  try {
    const { default: JSZip } = await import("jszip");
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error(`Couldn't open “${file.name}”. It may be corrupted or not a real .pptx (old .ppt isn't supported).`);
  }
  // Collect slide XMLs in numeric order: ppt/slides/slide1.xml, slide2.xml, ...
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      return na - nb;
    })
    .slice(0, MAX_UNITS);

  if (slidePaths.length === 0) throw new Error("No slides found — is this a valid .pptx?");

  const parser = new DOMParser();
  const parts: string[] = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const xml = await zip.files[slidePaths[i]].async("text");
    const doc = parser.parseFromString(xml, "application/xml");
    // DrawingML text runs live in <a:t> nodes.
    const runs = Array.from(doc.getElementsByTagName("a:t"))
      .map((el) => el.textContent?.trim() ?? "")
      .filter(Boolean);
    // Fallback: any namespaced variant (some exporters differ).
    if (runs.length === 0) {
      const all = Array.from(doc.getElementsByTagName("*")).filter((el) =>
        el.tagName.endsWith(":t"),
      );
      for (const el of all) {
        const t = el.textContent?.trim();
        if (t) runs.push(t);
      }
    }
    const text = runs.join(" ").replace(/\s+/g, " ").trim();
    if (text) parts.push(`[Slide ${i + 1}]\n${text}`);
  }
  return finalize(file.name, "pptx", parts, slidePaths.length);
}

export async function extractSource(file: File): Promise<ExtractedSource> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) return extractPdf(file);
  if (lower.endsWith(".pptx")) return extractPptx(file);
  throw new Error("Unsupported file — upload a .pdf or .pptx.");
}

function finalize(
  fileName: string,
  kind: "pdf" | "pptx",
  parts: string[],
  totalUnits: number,
): ExtractedSource {
  const full = parts.join("\n\n");
  const truncated = totalUnits > MAX_UNITS || full.length > MAX_CHARS;
  const text = full.slice(0, MAX_CHARS);
  if (!text.trim()) throw new Error("No readable text found — scanned images need OCR, not supported yet.");
  return {
    fileName,
    kind,
    text,
    units: parts.length,
    truncated,
    chars: text.length,
  };
}
