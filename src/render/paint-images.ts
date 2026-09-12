import sharp from "sharp"

/** Song tiles are ~95px CSS (~190px at 2×). 640px is still oversampled. */
export const TILE_MAX_EDGE = 640
/** Blurred backgrounds already sit around 1800px and cover the full card. */
export const BG_MAX_EDGE = 2048
const BG_SRC = /illBlur|phi-web-ill-blur|phi-ill-blur|Star[12]\.png/i

export type PaintImage = {
  src: string
  data: Uint8Array
}

export function maxEdgeFor(src: string) {
  return BG_SRC.test(src) ? BG_MAX_EDGE : TILE_MAX_EDGE
}

export async function fitPaintImages(images: PaintImage[]): Promise<PaintImage[]> {
  if (!images.length) return images
  const out = new Array<PaintImage>(images.length)
  let next = 0
  const workers = Math.min(8, images.length)
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (;;) {
        const i = next++
        if (i >= images.length) return
        out[i] = await fitOne(images[i]!)
      }
    }),
  )
  return out
}

async function fitOne(image: PaintImage): Promise<PaintImage> {
  const maxEdge = maxEdgeFor(image.src)
  try {
    const meta = await sharp(image.data, { failOn: "none" }).metadata()
    if (meta.format === "svg" || meta.format === "gif") return image
    const w = meta.width ?? 0
    const h = meta.height ?? 0
    if (!w || !h || Math.max(w, h) <= maxEdge) return image
    const data = new Uint8Array(
      await sharp(image.data, { failOn: "none" })
        .rotate()
        .resize({
          width: maxEdge,
          height: maxEdge,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png({ compressionLevel: 1 })
        .toBuffer(),
    )
    return { ...image, data }
  } catch {
    return image
  }
}
