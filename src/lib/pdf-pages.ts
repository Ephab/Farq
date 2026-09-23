// Client-side PDF page renderer: each page becomes a PNG data URL so decks
// can be previewed in-page and embedded into the exported .pptx.

export interface RenderedPdf {
  images: string[];
  /** Page size in px at the render scale. */
  width: number;
  height: number;
  truncated: boolean;
}

const MAX_PAGES = 60;

export async function renderPdfPages(file: File, targetWidth = 960): Promise<RenderedPdf> {
  const pdfjs = await import("pdfjs-dist");
  const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buf = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true });
  try {
    const pdf = await loadingTask.promise;
    const total = Math.min(pdf.numPages, MAX_PAGES);
    const images: string[] = [];
    let width = targetWidth;
    let height = Math.round((targetWidth * 9) / 16);
    for (let i = 1; i <= total; i++) {
      try {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1 });
        const scale = targetWidth / viewport.width;
        const scaled = page.getViewport({ scale });
        width = Math.round(scaled.width);
        height = Math.round(scaled.height);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, width, height);
        await page.render({ canvas, viewport: scaled }).promise;
        images.push(canvas.toDataURL("image/png"));
        page.cleanup();
      } catch {
        // Skip unreadable pages.
      }
    }
    if (images.length === 0) throw new Error("No readable pages found in this PDF.");
    return { images, width, height, truncated: pdf.numPages > MAX_PAGES };
  } finally {
    try {
      await loadingTask.destroy();
    } catch {
      // best-effort cleanup
    }
  }
}
