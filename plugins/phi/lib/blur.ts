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
  await sharp(file).rotate().resize({ width: 1800, height: 1800, fit: "cover" }).blur(sigma).modulate({ brightness: 0.62 }).png().toFile(out)
  return out
}

export async function blurCardBackgrounds(html: string): Promise<string> {
  const blockRe = /<div\b[^>]*class="[^"]*\bbackground\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi
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
      const blurred = await blurredFile(im[2]!)
      block = `${block.slice(0, at)}${im[1]}${blurred}${im[3]}${block.slice(at + im[0].length)}`
    }
    out += block
    last = start + m[0].length
  }
  return out + html.slice(last)
}

/** Mean 0.4 treated a navy glow as “light” and painted black on dark cards. */
const LIGHT_LUMA = 0.62

function ink(lightBg: boolean) {
  return lightBg
    ? {
        color: "#141414",
        shadow: "0 1px 2px rgba(255,255,255,0.9), 0 0 10px rgba(255,255,255,0.55)",
      }
    : {
        color: "#f4f4f4",
        shadow: "0 1px 2px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.55)",
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
  // rand/clg paint a full-bleed .ill illustration over the background div, so
  // that image — not the hidden background — is what sits behind the ink.
  const ill = /<div class="ill">\s*<img\b[^>]*\bsrc="([^"]+)"/i.exec(html)?.[1]
  if (ill) return ill
  const star = /<img class="star-base"[^>]*src="([^"]+)"/i.exec(html)?.[1]
  if (star) return star
  const block = /<div\b[^>]*class="[^"]*\bbackground\b[^"]*"[^>]*>[\s\S]*?<\/div>/i.exec(html)?.[0]
  return block ? /<img\b[^>]*\bsrc="([^"]+)"/i.exec(block)?.[1] : undefined
}

function inkCss(sel: string, lightBg: boolean) {
  const { color, shadow } = ink(lightBg)
  return `${sel} { color: ${color} !important; text-shadow: ${shadow} !important; }`
}

/** Date sits on the top of the ill; Tip sits on the bottom — sample each, prefer white. */
export async function contrastOverBackground(html: string): Promise<string> {
  const src = backgroundSrc(html)
  const file = src ? localFile(src) : undefined
  let topLight = false
  let bottomLight = false
  if (file) {
    try {
      topLight = (await sampleBandMedian(file, 0, 0.12)) >= LIGHT_LUMA
      bottomLight = (await sampleBandMedian(file, 0.88, 1)) >= LIGHT_LUMA
    } catch {
      topLight = false
      bottomLight = false
    }
  }
  const css = `<style>
    ${inkCss(".playerInfo .date p, .row-date p, .descTip p", topLight)}
    ${inkCss(".tips p", bottomLight)}
  </style>`
  if (html.includes("</head>")) return html.replace("</head>", `${css}</head>`)
  return css + html
}
