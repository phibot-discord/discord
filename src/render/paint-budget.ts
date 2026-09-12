/** Takumi 2.13 pixmap budget (`MAX_PIXMAP_PIXELS = 16 << 20`). */
export const MAX_PIXMAP_PIXELS = 16 << 20
export const PIXEL_RATIO = 2

export type PaintQuality = "high" | "fast"
export type PaintSize = {
  width: number
  height: number
  ratio: number
}

export function parsePaintQuality(raw: unknown): PaintQuality {
  return raw === "high" ? "high" : "fast"
}

/**
 * CSS-space layout → device pixmap. Under the 16M cap this is exact 2×.
 * Over it, `fast` paints at 1× CSS pixels; `high` fills the cap (sharper, slower).
 */
export function fitPaint(
  cssWidth: number,
  cssHeight: number,
  ratio = PIXEL_RATIO,
  quality: PaintQuality = "fast",
): PaintSize {
  const w = Math.max(1, cssWidth)
  const h = Math.max(1, cssHeight)
  if (w * h * ratio * ratio <= MAX_PIXMAP_PIXELS) {
    return {
      width: Math.max(1, Math.round(w * ratio)),
      height: Math.max(1, Math.round(h * ratio)),
      ratio,
    }
  }
  if (quality === "fast") {
    return { width: w, height: h, ratio: 1 }
  }
  const maxRatio = Math.sqrt(MAX_PIXMAP_PIXELS / (w * h))
  const target = Math.min(ratio, maxRatio)
  let pw = Math.max(1, Math.floor(w * target))
  let ph = Math.max(1, Math.floor(h * target))
  if (pw * ph > MAX_PIXMAP_PIXELS) {
    ph = Math.max(1, Math.floor(MAX_PIXMAP_PIXELS / pw))
  }
  const scale = Math.min(pw / w, ph / h)
  return { width: pw, height: ph, ratio: scale }
}
