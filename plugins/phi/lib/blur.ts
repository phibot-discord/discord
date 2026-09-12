import { createHash } from "node:crypto"
import { existsSync, mkdirSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"

const cacheDir = join(tmpdir(), "phi-ill-blur")

function localFile(src: string): string | undefined {
  if (!src || /^(https?:|data:|cid:)/i.test(src)) return undefined
  const file = src.startsWith("file://") ? decodeURIComponent(src.replace(/^file:\/\//, "")) : src
  if (!existsSync(file)) return undefined
  return file
}

/** Takumi only applies CSS filters to PNG, so pre-blur to a PNG cache instead. */
async function blurredFile(src: string, fallbackSigma = 10): Promise<string> {
  const file = localFile(src)
  if (!file) return src
  if (/[/\\]illBlur[/\\]/.test(file)) return file
  // Star theme assets must stay sharp: CSS blur on the 501px source
  // wipes the starfield after Takumi scales it to the tall card.
  if (/Star[12]\.png$/i.test(file)) return file
  const sigma = fallbackSigma
  mkdirSync(cacheDir, { recursive: true })
  const st = statSync(file)
  const key = createHash("sha1").update(`${file}:${st.mtimeMs}:${st.size}:${sigma}:cover`).digest("hex")
  const out = join(cacheDir, `${key}.png`)
  if (existsSync(out)) return out
  await sharp(file).rotate().resize({ width: 1800, height: 1800, fit: "cover" }).blur(sigma).modulate({ brightness: 0.62 }).png({ compressionLevel: 1 }).toFile(out)
  return out
}

export async function blurCardBackgrounds(html: string): Promise<string> {
  const blockRe = /<div\b[^>]*class="[^"]*\bbackground\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi
  const srcs = new Set<string>()
  for (const m of html.matchAll(blockRe)) {
    for (const im of m[0].matchAll(/(<img\b[^>]*\bsrc=")([^"]+)(")/gi)) {
      if (im[2]) srcs.add(im[2])
    }
  }
  const blurred = new Map<string, string>()
  await Promise.all(
    [...srcs].map(async src => {
      blurred.set(src, await blurredFile(src))
    }),
  )
  let out = ""
  let last = 0
  for (const m of html.matchAll(blockRe)) {
    const start = m.index ?? 0
    out += html.slice(last, start)
    let block = m[0]
    const imgs = [...block.matchAll(/(<img\b[^>]*\bsrc=")([^"]+)(")/gi)]
    for (let i = imgs.length - 1; i >= 0; i--) {
      const im = imgs[i]!
      const at = im.index ?? 0
      const next = blurred.get(im[2]!) ?? im[2]!
      block = `${block.slice(0, at)}${im[1]}${next}${im[3]}${block.slice(at + im[0].length)}`
    }
    out += block
    last = start + m[0].length
  }
  return out + html.slice(last)
}

/** Blurred ills are darkened ~0.62; 0.40 still treats navy as dark. */
const LIGHT_LUMA = 0.4
const lumaCache = new Map<string, { top: number; bottom: number }>()
const LUMA_CACHE_MAX = 256

function ink(lightBg: boolean) {
  return lightBg
    ? {
        color: "#000000",
        shadow: "0 0 6px rgba(255,255,255,0.85)",
      }
    : {
        color: "#ffffff",
        shadow: "0 0 6px rgba(0,0,0,0.75)",
      }
}

async function sampleBandMedian(file: string, y0: number, y1: number) {
  const meta = await sharp(file).rotate().metadata()
  const w = meta.width || 1
  const h = meta.height || 1
  const top = Math.max(0, Math.min(h - 1, Math.floor(h * y0)))
  const height = Math.max(8, Math.min(h - top, Math.floor(h * Math.max(0.04, y1 - y0))))
  const { data, info } = await sharp(file)
    .rotate()
    .extract({ left: 0, top, width: w, height })
    .resize(48, 12, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const values: number[] = []
  for (let i = 0; i < data.length; i += info.channels) {
    values.push(0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!)
  }
  if (!values.length) return 0.25
  values.sort((a, b) => a - b)
  return (values[Math.floor(values.length / 2)] ?? 64) / 255
}

function backgroundSrc(html: string) {
  const star = /<img class="star-base"[^>]*src="([^"]+)"/i.exec(html)?.[1]
  if (star) return star
  const block = /<div\b[^>]*class="[^"]*\bbackground\b[^"]*"[^>]*>[\s\S]*?<\/div>/i.exec(html)?.[0]
  const bg = block ? /<img\b[^>]*\bsrc="([^"]+)"/i.exec(block)?.[1] : undefined
  if (bg) return bg
  return /<div class="ill">\s*<img\b[^>]*\bsrc="([^"]+)"/i.exec(html)?.[1]
}

function inkCss(sel: string, lightBg: boolean) {
  const { color, shadow } = ink(lightBg)
  return `${sel} { color: ${color} !important; text-shadow: ${shadow} !important; }`
}

function stampInk(html: string, re: RegExp, light: boolean) {
  const { color, shadow } = ink(light)
  const extra = `color:${color};text-shadow:${shadow};`
  return html.replace(re, (_full, open: string, rest: string) => {
    if (/\sstyle="/i.test(rest)) {
      return `${open}${rest.replace(/style="/i, `style="${extra}`)}`
    }
    return `${open}${rest.replace(/>$/, ` style="${extra}">`)}`
  })
}

/** Date sits on the top of the card bg; Tip sits on the bottom. */
export async function contrastOverBackground(html: string): Promise<string> {
  const src = backgroundSrc(html)
  const file = src ? localFile(src) : undefined
  let topLight = false
  let bottomLight = false
  if (file) {
    try {
      const st = statSync(file)
      const key = `${file}|${st.mtimeMs}|${st.size}`
      let luma = lumaCache.get(key)
      if (!luma) {
        const [top, bottom] = await Promise.all([sampleBandMedian(file, 0, 0.12), sampleBandMedian(file, 0.88, 1)])
        luma = { top, bottom }
        if (lumaCache.size >= LUMA_CACHE_MAX) {
          const oldest = lumaCache.keys().next().value
          if (oldest !== undefined) lumaCache.delete(oldest)
        }
        lumaCache.set(key, luma)
      }
      topLight = luma.top >= LIGHT_LUMA
      bottomLight = luma.bottom >= LIGHT_LUMA
    } catch {
      topLight = false
      bottomLight = false
    }
  }
  let out = html
  out = stampInk(out, /(<div class="date">\s*<p)([^>]*>)/i, topLight)
  out = stampInk(out, /(<div class="tips(?:-abs)?"[^>]*>\s*<p)([^>]*>)/gi, bottomLight)
  const css = `<style>
    ${inkCss(".playerInfo .date p, .date p, .row-date p, .descTip p", topLight)}
    ${inkCss(".tips p, .tips-abs p", bottomLight)}
  </style>`
  if (out.includes("</head>")) return out.replace("</head>", `${css}</head>`)
  return css + out
}
