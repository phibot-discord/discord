import { existsSync, readFileSync } from "node:fs"
import { extname, isAbsolute, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import template from "art-template"

function configureArt() {
  const defaults = (template as unknown as { defaults: Record<string, unknown> }).defaults
  if (!defaults) return
  defaults.escape = true
  defaults.cache = true
  defaults.debug = false
  const origWarn = console.warn.bind(console)
  console.warn = (...args: unknown[]) => {
    const text = args.map(a => (typeof a === "string" ? a : String(a))).join(" ")
    if (text.includes("Template upgrade:")) return
    origWarn(...(args as Parameters<typeof origWarn>))
  }
}

configureArt()

export function compileArt(file: string, data: Record<string, unknown>): string {
  if (!existsSync(file)) throw new Error(`template not found: ${file}`)
  return (template as unknown as (file: string, data: object) => string)(file, data)
}

const SRC_RE = /\b(?:src|href)=["']([^"']+)["']/gi

export type ImageAsset = { src: string; data: Buffer }

export function rewriteLocalUrls(
  html: string,
  baseDir: string,
): { html: string; images: ImageAsset[] } {
  const images: ImageAsset[] = []
  const seen = new Set<string>()
  const html2 = html.replace(SRC_RE, (m, spec: string) => {
    if (/^(data:|https?:|cid:|#)/i.test(spec)) return m
    let file = spec.startsWith("file://") ? decodeURIComponent(spec.replace(/^file:\/\//, "")) : spec
    if (!isAbsolute(file)) file = resolve(baseDir, file)
    if (!existsSync(file)) return m
    const url = pathToFileURL(file).href
    if (!seen.has(url) && isImage(file)) {
      seen.add(url)
      images.push({ src: url, data: readFileSync(file) })
    }
    return m.replace(spec, url)
  })
  return { html: html2, images }
}

function isImage(file: string) {
  return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp"].includes(extname(file).toLowerCase())
}
