// Client-side PPTX design parser: theme, slide size, per-slide shapes/images.
// Used to preview uploaded decks in-page and to style AI extension slides
// with the deck's own look (no server round-trip, files stay in memory).

export interface PptxTextRun {
  text: string;
  sizePt: number;
  bold: boolean;
  italic: boolean;
  color: string;
}

export interface PptxParagraph {
  runs: PptxTextRun[];
  align: "left" | "center" | "right" | "justify";
  level: number;
  /** Bullet marker (e.g. "•", "–", "1.") or null for plain paragraphs. */
  bullet: string | null;
}

export interface PptxShape {
  /** Fractions of slide width/height (0..1). */
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string | null;
  paragraphs: PptxParagraph[];
  isTitle: boolean;
}

export interface PptxSlideImage {
  x: number;
  y: number;
  w: number;
  h: number;
  src: string;
}

export interface PptxSlide {
  background: string | null;
  shapes: PptxShape[];
  images: PptxSlideImage[];
}

export interface PptxTheme {
  background: string;
  titleColor: string;
  bodyColor: string;
  accent: string;
  titleFont: string;
  bodyFont: string;
  dark: boolean;
}

export interface ParsedPptx {
  /** Slide size in px at 96dpi. */
  width: number;
  height: number;
  theme: PptxTheme;
  slides: PptxSlide[];
  /** Short design summary sent to the AI so new slides match the structure. */
  designHint: string;
  truncated: boolean;
}

const EMU_PER_INCH = 914400;
const MAX_SLIDES = 60;

type Scheme = Record<string, string>;

function directChildren(el: Element, tag: string): Element[] {
  const out: Element[] = [];
  for (const child of Array.from(el.children)) {
    if (child.tagName === tag) out.push(child);
  }
  return out;
}

function directChild(el: Element, tag: string): Element | null {
  for (const child of Array.from(el.children)) {
    if (child.tagName === tag) return child;
  }
  return null;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

function pctVal(el: Element, tag: string): number | null {
  const node = directChild(el, tag);
  if (!node) return null;
  const v = Number(node.getAttribute("val") ?? NaN);
  return Number.isFinite(v) ? v / 100000 : null;
}

/** Resolve a DrawingML color element (a:solidFill etc.) to a CSS hex color. */
export function resolveFillColor(fillEl: Element, scheme: Scheme, fallback: string): string {
  const srgb = directChild(fillEl, "a:srgbClr");
  if (srgb?.getAttribute("val")) return `#${srgb.getAttribute("val")!}`;
  const sys = directChild(fillEl, "a:sysClr");
  if (sys) {
    const last = sys.getAttribute("lastClr");
    if (last) return `#${last}`;
    const val = sys.getAttribute("val");
    if (val && /^[0-9a-fA-F]{6}$/.test(val)) return `#${val}`;
  }
  const sc = directChild(fillEl, "a:schemeClr");
  if (sc?.getAttribute("val")) {
    let [r, g, b] = hexToRgb(scheme[sc.getAttribute("val")!] ?? "#000000");
    const lumMod = pctVal(sc, "a:lumMod");
    const lumOff = pctVal(sc, "a:lumOff");
    if (lumMod !== null || lumOff !== null) {
      const [h, s, l] = rgbToHsl(r, g, b);
      const nl = Math.max(0, Math.min(1, l * (lumMod ?? 1) + (lumOff ?? 0)));
      [r, g, b] = hslToRgb(h, s, nl);
    }
    const tint = pctVal(sc, "a:tint");
    if (tint !== null) {
      r += (255 - r) * tint; g += (255 - g) * tint; b += (255 - b) * tint;
    }
    const shade = pctVal(sc, "a:shade");
    if (shade !== null) {
      r *= 1 - shade; g *= 1 - shade; b *= 1 - shade;
    }
    return rgbToHex(r, g, b);
  }
  return fallback;
}

function solidFillOf(spPr: Element | null, scheme: Scheme): string | null {
  if (!spPr) return null;
  const solid = directChild(spPr, "a:solidFill");
  if (solid) return resolveFillColor(solid, scheme, "#000000");
  const grad = directChild(spPr, "a:gradFill");
  if (grad) {
    // Approximate gradients with their first stop.
    const stop = grad.getElementsByTagName("a:gs")[0];
    const inner = stop ? directChild(stop, "a:srgbClr") ?? directChild(stop, "a:schemeClr") ?? directChild(stop, "a:sysClr") : null;
    if (stop && inner) {
      const wrapper = document.createElementNS("", "a:solidFill");
      wrapper.appendChild(inner.cloneNode(true));
      return resolveFillColor(wrapper, scheme, "#000000");
    }
  }
  return null;
}

function isNoFill(spPr: Element | null): boolean {
  return !!spPr && !!directChild(spPr, "a:noFill");
}

function emuToPx(emu: number): number {
  return (emu / EMU_PER_INCH) * 96;
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function parseParagraph(p: Element, scheme: Scheme, defaultColor: string, bodyFont: string): PptxParagraph {
  const pPr = directChild(p, "a:pPr");
  const algn = pPr?.getAttribute("algn") ?? "l";
  const align = algn === "ctr" ? "center" : algn === "r" ? "right" : algn === "just" ? "justify" : "left";
  const level = Number(pPr?.getAttribute("lvl") ?? 0) || 0;
  let bullet: string | null = null;
  if (pPr && !directChild(pPr, "a:buNone")) {
    const buChar = directChild(pPr, "a:buChar");
    const buAuto = directChild(pPr, "a:buAutoNum");
    const buBlip = directChild(pPr, "a:buBlip");
    if (buChar?.getAttribute("char")) bullet = buChar.getAttribute("char");
    else if (buAuto) bullet = "1.";
    else if (buBlip) bullet = "•";
  }
  const runs: PptxTextRun[] = [];
  for (const child of Array.from(p.children)) {
    if (child.tagName === "a:r") {
      const rPr = directChild(child, "a:rPr");
      const t = directChild(child, "a:t");
      const text = t?.textContent ?? "";
      if (!text) continue;
      let sizePt = 18;
      if (rPr?.getAttribute("sz")) sizePt = Math.max(8, Math.min(54, Number(rPr.getAttribute("sz")) / 100));
      let color = defaultColor;
      const solid = rPr ? directChild(rPr, "a:solidFill") : null;
      if (rPr && solid) color = resolveFillColor(solid, scheme, defaultColor);
      runs.push({
        text,
        sizePt,
        bold: rPr?.getAttribute("b") === "1",
        italic: rPr?.getAttribute("i") === "1",
        color,
      });
    } else if (child.tagName === "a:br") {
      runs.push({ text: "\n", sizePt: 18, bold: false, italic: false, color: defaultColor });
    }
  }
  // Default run for empty paragraphs (keeps spacing).
  if (runs.length === 0) {
    const sz = pPr?.getAttribute("sz");
    runs.push({
      text: "",
      sizePt: sz ? Math.max(8, Math.min(54, Number(sz) / 100)) : 18,
      bold: false,
      italic: false,
      color: defaultColor,
    });
  }
  void bodyFont;
  return { runs, align, level, bullet };
}

interface Geom { x: number; y: number; w: number; h: number; }

function readXfrm(spPr: Element | null): Geom | null {
  const xfrm = spPr ? directChild(spPr, "a:xfrm") : null;
  const off = xfrm ? directChild(xfrm, "a:off") : null;
  const ext = xfrm ? directChild(xfrm, "a:ext") : null;
  if (!off || !ext) return null;
  return {
    x: Number(off.getAttribute("x") ?? 0),
    y: Number(off.getAttribute("y") ?? 0),
    w: Number(off.getAttribute("cx") ?? ext.getAttribute("cx") ?? 0) || Number(ext.getAttribute("cx") ?? 0),
    h: Number(off.getAttribute("cy") ?? ext.getAttribute("cy") ?? 0) || Number(ext.getAttribute("cy") ?? 0),
  };
}

export interface GroupFrame { offX: number; offY: number; extCx: number; extCy: number; chCx: number; chCy: number; }

function parseShape(
  sp: Element,
  scheme: Scheme,
  slideW: number,
  slideH: number,
  defaultColor: string,
  bodyFont: string,
  group?: GroupFrame,
): PptxShape | null {
  const nvPr = sp.getElementsByTagName("p:nvPr")[0];
  const ph = nvPr ? directChild(nvPr, "p:ph") : null;
  const phType = ph?.getAttribute("type") ?? "";
  const isTitle = phType === "title" || phType === "ctrTitle";
  // Skip structural placeholders without direct text (inherited from layout).
  const txBody = directChild(sp, "p:txBody");
  if (!txBody) return null;
  const hasText = txBody.getElementsByTagName("a:t").length > 0;
  if (!hasText && ph) return null;

  const spPr = directChild(sp, "p:spPr");
  let geom = readXfrm(spPr);
  if (!geom) return null;
  if (group && group.chCx > 0 && group.chCy > 0 && group.extCx > 0 && group.extCy > 0) {
    // Child coords live in the group's child-extents space.
    const sx = group.extCx / group.chCx;
    const sy = group.extCy / group.chCy;
    geom = { x: group.offX + geom.x * sx, y: group.offY + geom.y * sy, w: geom.w * sx, h: geom.h * sy };
  }
  const fill = isNoFill(spPr) ? null : solidFillOf(spPr, scheme);
  const paragraphs: PptxParagraph[] = [];
  for (const p of directChildren(txBody, "a:p")) {
    const para = parseParagraph(p, scheme, defaultColor, bodyFont);
    if (para.runs.some((r) => r.text.trim() || r.text === "\n")) paragraphs.push(para);
  }
  if (paragraphs.length === 0) return null;
  return {
    x: geom.x / slideW,
    y: geom.y / slideH,
    w: geom.w / slideW,
    h: geom.h / slideH,
    fill,
    paragraphs,
    isTitle,
  };
}

export async function parsePptxDesign(file: File): Promise<ParsedPptx> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const readXml = async (path: string): Promise<Document | null> => {
    const entry = zip.files[path];
    if (!entry) return null;
    const parser = new DOMParser();
    return parser.parseFromString(await entry.async("text"), "application/xml");
  };

  // Slide size.
  const presentation = await readXml("ppt/presentation.xml");
  const sldSz = presentation?.getElementsByTagName("p:sldSz")[0];
  const slideW = Number(sldSz?.getAttribute("cx") ?? 12192000);
  const slideH = Number(sldSz?.getAttribute("cy") ?? 6858000);

  // Theme: color scheme + fonts.
  const scheme: Scheme = {};
  let majorFont = "Arial";
  let minorFont = "Arial";
  const themeFiles = Object.keys(zip.files).filter((p) => /^ppt\/theme\/theme\d+\.xml$/.test(p));
  if (themeFiles.length > 0) {
    const theme = await readXml(themeFiles[0]);
    const clrScheme = theme?.getElementsByTagName("a:clrScheme")[0];
    if (clrScheme) {
      for (const child of Array.from(clrScheme.children)) {
        const name = child.tagName.replace("a:", "");
        const srgb = directChild(child, "a:srgbClr");
        const sys = directChild(child, "a:sysClr");
        if (srgb?.getAttribute("val")) scheme[name] = `#${srgb.getAttribute("val")!}`;
        else if (sys?.getAttribute("lastClr")) scheme[name] = `#${sys.getAttribute("lastClr")!}`;
      }
    }
    const major = theme?.getElementsByTagName("a:majorFont")[0];
    const minor = theme?.getElementsByTagName("a:minorFont")[0];
    majorFont = major?.getElementsByTagName("a:latin")[0]?.getAttribute("typeface") ?? majorFont;
    minorFont = minor?.getElementsByTagName("a:latin")[0]?.getAttribute("typeface") ?? minorFont;
  }
  scheme.dk1 = scheme.dk1 ?? "#000000";
  scheme.lt1 = scheme.lt1 ?? "#FFFFFF";

  // Slide order via presentation rels.
  const presRels = await readXml("ppt/_rels/presentation.xml.rels");
  const relTarget: Record<string, string> = {};
  if (presRels) {
    for (const rel of Array.from(presRels.getElementsByTagName("Relationship"))) {
      const id = rel.getAttribute("Id") ?? "";
      const target = rel.getAttribute("Target") ?? "";
      if (id && target) relTarget[id] = target.replace(/^ppt\//, "").replace(/^\.\.\//, "").replace(/^\//, "");
    }
  }
  const sldIdLst = presentation?.getElementsByTagName("p:sldId")[0];
  const slidePaths: string[] = [];
  if (sldIdLst) {
    for (const sldId of directChildren(sldIdLst, "p:sldId")) {
      const rid = sldId.getAttribute("r:id") ?? sldId.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? "";
      const target = relTarget[rid];
      if (target) slidePaths.push(target.startsWith("slides/") ? `ppt/${target}` : `ppt/slides/${target.split("/").pop()}`);
    }
  }
  if (slidePaths.length === 0) {
    // Fallback: numeric slide files.
    Object.keys(zip.files)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => Number(a.match(/slide(\d+)\.xml/)?.[1] ?? 0) - Number(b.match(/slide(\d+)\.xml/)?.[1] ?? 0))
      .forEach((p) => slidePaths.push(p));
  }
  const limited = slidePaths.slice(0, MAX_SLIDES);

  const slides: PptxSlide[] = [];
  for (const path of limited) {
    const num = path.match(/slide(\d+)\.xml/)?.[1] ?? "";
    const doc = await readXml(path);
    if (!doc) continue;
    // Background first: runs without an explicit color inherit a
    // contrasting default so theme-styled text stays readable.
    let background: string | null = null;
    const bgPr = doc.getElementsByTagName("p:bgPr")[0];
    if (bgPr) {
      const solid = directChild(bgPr, "a:solidFill");
      if (solid) background = resolveFillColor(solid, scheme, "#FFFFFF");
    }
    const defaultColor = luminance(background ?? "#FFFFFF") < 0.25 ? "#F5F5F5" : "#1A1A1A";
    const shapes: PptxShape[] = [];
    const images: PptxSlideImage[] = [];
    const tree = doc.getElementsByTagName("p:spTree")[0];
    if (tree) {
      for (const node of Array.from(tree.children)) {
        if (node.tagName === "p:sp" || node.tagName === "p:cxnSp") {
          const shape = parseShape(node, scheme, slideW, slideH, defaultColor, minorFont);
          if (shape) shapes.push(shape);
        } else if (node.tagName === "p:grpSp") {
          const grpSpPr = node.getElementsByTagName("p:grpSpPr")[0];
          const grpXfrm = grpSpPr ? directChild(grpSpPr, "a:xfrm") : null;
          const grpOff = grpXfrm ? directChild(grpXfrm, "a:off") : null;
          const grpExt = grpXfrm ? directChild(grpXfrm, "a:ext") : null;
          const chExt = grpXfrm ? directChild(grpXfrm, "a:chExt") : null;
          const frame: GroupFrame | undefined =
            grpOff && grpExt && chExt
              ? {
                  offX: Number(grpOff.getAttribute("x") ?? 0),
                  offY: Number(grpOff.getAttribute("y") ?? 0),
                  extCx: Number(grpExt.getAttribute("cx") ?? 0),
                  extCy: Number(grpExt.getAttribute("cy") ?? 0),
                  chCx: Number(chExt.getAttribute("cx") ?? 0),
                  chCy: Number(chExt.getAttribute("cy") ?? 0),
                }
              : undefined;
          for (const sub of Array.from(node.getElementsByTagName("p:sp"))) {
            const shape = parseShape(sub, scheme, slideW, slideH, defaultColor, minorFont, frame);
            if (shape) shapes.push(shape);
          }
        } else if (node.tagName === "p:pic") {
          try {
            const blip = node.getElementsByTagName("a:blip")[0];
            const embed = blip?.getAttribute("r:embed") ?? "";
            const spPr = directChild(node, "p:spPr");
            const geom = readXfrm(spPr);
            if (embed && geom) {
              const rels = await readXml(`ppt/slides/_rels/slide${num}.xml.rels`);
              let target: string | null = null;
              if (rels) {
                for (const rel of Array.from(rels.getElementsByTagName("Relationship"))) {
                  const id = rel.getAttribute("Id") ?? "";
                  if (id === embed) {
                    target = rel.getAttribute("Target") ?? null;
                    break;
                  }
                }
              }
              if (target) {
                const mediaPath = `ppt/${target.replace(/^(\.\.\/)+/, "").replace(/^\//, "")}`;
                const media = zip.files[mediaPath];
                if (media) {
                  const ext = (mediaPath.split(".").pop() ?? "png").toLowerCase();
                  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : "image/png";
                  const b64 = await media.async("base64");
                  images.push({
                    x: geom.x / slideW, y: geom.y / slideH, w: geom.w / slideW, h: geom.h / slideH,
                    src: `data:${mime};base64,${b64}`,
                  });
                }
              }
            }
          } catch {
            // Skip undecodable pictures.
          }
        }
      }
    }
    slides.push({ background, shapes, images });
  }

  // Theme sampled from the deck itself.
  const bgCounts: Record<string, number> = {};
  const titleColors: Record<string, number> = {};
  const bodyColors: Record<string, number> = {};
  const titleSizes: number[] = [];
  let bulletParas = 0;
  let textShapes = 0;
  for (const slide of slides) {
    const bg = slide.background ?? "#FFFFFF";
    bgCounts[bg] = (bgCounts[bg] ?? 0) + 1;
    for (const shape of slide.shapes) {
      textShapes++;
      const first = shape.paragraphs[0]?.runs.find((r) => r.text.trim());
      if (shape.isTitle && first) {
        titleColors[first.color] = (titleColors[first.color] ?? 0) + 1;
        titleSizes.push(first.sizePt);
      } else if (first) {
        bodyColors[first.color] = (bodyColors[first.color] ?? 0) + 1;
        bulletParas += shape.paragraphs.length;
      }
    }
  }
  const top = (m: Record<string, number>, fb: string) => {
    let best = fb, n = -1;
    for (const [k, v] of Object.entries(m)) if (v > n) { n = v; best = k; }
    return best;
  };
  const background = top(bgCounts, "#FFFFFF");
  const dark = luminance(background) < 0.25;
  const titleColor = top(titleColors, scheme.accent1 ?? (dark ? "#FFFFFF" : "#111111"));
  const bodyColor = top(bodyColors, dark ? "#F5F5F5" : "#222222");
  const avgTitle = titleSizes.length ? Math.round(titleSizes.reduce((a, b) => a + b, 0) / titleSizes.length) : 32;
  const avgBullets = slides.length ? Math.max(1, Math.round(bulletParas / Math.max(1, slides.length))) : 4;
  const ratio = slideW / slideH;
  const shape = ratio > 1.7 ? "16:9 widescreen" : ratio > 1.4 ? "4:3 standard" : "custom ratio";

  const theme: PptxTheme = {
    background,
    titleColor,
    bodyColor,
    accent: scheme.accent1 ?? titleColor,
    titleFont: majorFont,
    bodyFont: minorFont,
    dark,
  };
  const designHint = [
    `${shape} slides`,
    `${dark ? "dark" : "light"} ${background} backgrounds`,
    `${avgTitle}pt bold ${majorFont} titles in ${titleColor}`,
    `${minorFont} body text in ${bodyColor} (~${avgBullets} bullets per slide)`,
  ].join("; ");

  return {
    width: Math.round(emuToPx(slideW)),
    height: Math.round(emuToPx(slideH)),
    theme,
    slides,
    designHint,
    truncated: slidePaths.length > MAX_SLIDES,
  };
}
