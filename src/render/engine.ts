import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { render, setGlyphCacheMaxBytes } from "takumi-js"
import { fromHtml } from "takumi-js/helpers/html"
import { Renderer } from "takumi-js/node"
import { logger } from "../logger.ts"
import type { FontEntry, RenderedImage, RenderFormat, TemplateDefinition } from "../sdk/index.ts"
import { collectRootVars, collectStylesheets, resolveCssVars, stripScripts, stripUnsupportedCss } from "./css.ts"
import { PHI_FONT_FAMILIES } from "./fonts.ts"
import { type ImageAsset, rewriteLocalUrls } from "./html.ts"
import { fitPaint, PIXEL_RATIO } from "./paint-budget.ts"
import { fitPaintImages } from "./paint-images.ts"

setGlyphCacheMaxBytes(64 * 1024 * 1024)
const RENDERER_CACHE_BYTES = 512 * 1024 * 1024
const MEASURE_VIEWPORT_H = 16_000
const cssTransformCache = new Map<string, string>()
const CSS_CACHE_MAX = 256

function wrapPixelRoot(html: string, cssWidth: number, ratio: number) {
  const scale = ratio === 1 ? "" : `transform:scale(${ratio});transform-origin:0 0;`
  const root = `<div class="phi-pixel-root" style="width:${cssWidth}px;${scale}">`
  if (/<body\b/i.test(html)) {
    const opened = html.replace(/<body\b([^>]*)>/i, `<body$1>${root}`)
    return /<\/body>/i.test(opened) ? opened.replace(/<\/body>/i, "</div></body>") : `${opened}</div>`
  }
  return `${root}${html}</div>`
}

function rootBoxCss(cssWidth: number) {
  return `html, body { position: relative !important; width: ${cssWidth}px !important; height: auto !important; min-height: min-content !important; overflow: visible !important; transform: none !important; }`
}

function pixelRootCss(cssWidth: number, transform?: string) {
  const reset = transform ? `transform: ${transform} !important; ` : ""
  return `.phi-pixel-root { width: ${cssWidth}px !important; ${reset}transform-origin: 0 0 !important; overflow: visible !important; }`
}

function fmtMs(ms: number) {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function mime(format: RenderFormat) {
  return format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png"
}

function ext(format: RenderFormat) {
  return format === "jpeg" ? "jpg" : format
}

function transformSheet(sheet: string, vars: Map<string, string>, varsKey: string): string {
  const key = createHash("sha1").update(varsKey).update("\0").update(sheet).digest("hex")
  const hit = cssTransformCache.get(key)
  if (hit !== undefined) {
    cssTransformCache.delete(key)
    cssTransformCache.set(key, hit)
    return hit
  }
  const out = stripUnsupportedCss(resolveCssVars(sheet, vars))
  if (cssTransformCache.size >= CSS_CACHE_MAX) {
    const oldest = cssTransformCache.keys().next().value
    if (oldest !== undefined) cssTransformCache.delete(oldest)
  }
  cssTransformCache.set(key, out)
  return out
}

function collectCssImages(css: string): ImageAsset[] {
  const out: ImageAsset[] = []
  const re = /url\("?(file:[^")]+)"?\)/gi
  const seen = new Set<string>()
  let m = re.exec(css)
  while (m) {
    const src = m[1]
    if (!src || seen.has(src)) {
      m = re.exec(css)
      continue
    }
    seen.add(src)
    const file = decodeURIComponent(src.replace(/^file:\/\//, ""))
    if (existsSync(file)) out.push({ src, data: readFileSync(file) })
    m = re.exec(css)
  }
  return out
}

function contentExtent(n: { height: number; transform?: number[]; children?: unknown[] }): number {
  const ty = n.transform?.[5] ?? 0
  let max = ty + (n.height || 0)
  for (const c of (n.children || []) as typeof n[]) max = Math.max(max, contentExtent(c))
  return max
}

export class RenderEngine {
  private renderer: InstanceType<typeof Renderer> | undefined
  private fonts: FontEntry[] = []
  private fontsRegistered = false

  async init() {
    this.renderer = new Renderer({ cacheMaxBytes: RENDERER_CACHE_BYTES })
  }

  registerFont(entry: FontEntry) {
    this.fonts.push(entry)
    this.fontsRegistered = false
  }

  private async ensureFonts() {
    if (!this.renderer) await this.init()
    if (this.fontsRegistered) return
    for (const f of this.fonts) {
      await this.renderer!.registerFont({
        name: f.name,
        data: f.data,
        weight: f.weight ?? 400,
        style: f.style ?? "normal",
      })
    }
    this.fontsRegistered = true
  }

  async renderHtml(
    rawHtml: string,
    opts: {
      width?: number
      height?: number
      format?: RenderFormat
      quality?: number
      baseDir?: string
      id?: string
    } = {},
  ): Promise<RenderedImage> {
    const started = performance.now()
    await this.ensureFonts()
    const width = opts.width ?? 1200
    const format = opts.format ?? "jpeg"
    const quality = opts.quality ?? 90
    const baseDir = opts.baseDir ?? process.cwd()
    const id = opts.id || "html"

    let html = stripScripts(rawHtml)
    const sheets = collectStylesheets(html, baseDir)
    html = sheets.html
    const rewritten = rewriteLocalUrls(html, baseDir)
    html = rewritten.html
    const inline: string[] = []
    html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_m, css: string) => {
      inline.push(css)
      return ""
    })

    const prepared = html
    const layoutTree = fromHtml(wrapPixelRoot(prepared, width, 1))
    const rawSheets = [
      ...sheets.sheets,
      ...(layoutTree.stylesheets || []),
      `.help_box, .line { overflow: visible !important; max-height: none !important; }`,
      ...inline,
    ]
    const vars = new Map<string, string>()
    for (const s of rawSheets) collectRootVars(s, vars)
    const varsKey = createHash("sha1").update([...vars].flat().join("\0")).digest("hex")
    const sharedSheets = rawSheets.map(s => transformSheet(s, vars, varsKey))
    const layoutCss = [...sharedSheets, rootBoxCss(width), pixelRootCss(width, "none")]
    const images = await fitPaintImages(
      [...rewritten.images, ...layoutCss.flatMap(collectCssImages)].map(i => ({
        src: i.src,
        data: new Uint8Array(i.data),
      })),
    )

    const fonts = this.fonts.map(f => ({
      name: f.name,
      data: f.data,
      weight: f.weight ?? 400,
      style: f.style ?? "normal",
    }))

    let height = opts.height
    if (!height) {
      const measured = await this.renderer!.measure(layoutTree.node, {
        width,
        height: MEASURE_VIEWPORT_H,
        stylesheets: layoutCss,
        images,
        fontFamilies: [...PHI_FONT_FAMILIES],
        lang: "zh-CN",
      })
      const boxH = measured.height || 0
      const extent = Math.max(1, Math.ceil(contentExtent(measured)))
      let raw = Math.max(boxH, extent)
      if (extent >= MEASURE_VIEWPORT_H - 1 && boxH > 64 && boxH + 24 < extent) {
        raw = boxH
      }
      height = Math.min(MEASURE_VIEWPORT_H, Math.max(1, Math.ceil(raw) + 24))
      logger.info(`measured box ${measured.width}x${measured.height} content ${extent} using ${height}`)
    }

    const paint = fitPaint(width, height)
    if (paint.ratio < PIXEL_RATIO) {
      logger.warn(
        `paint ${id} ${width}x${height} ratio ${paint.ratio.toFixed(3)} (Takumi ${paint.width}x${paint.height})`,
      )
    }
    const paintTree = fromHtml(wrapPixelRoot(prepared, width, paint.ratio))
    const paintCss = [...sharedSheets, rootBoxCss(width), pixelRootCss(width)]
    const bytes = Buffer.from(
      await render(paintTree.node, {
        renderer: this.renderer,
        width: paint.width,
        height: paint.height,
        format,
        quality,
        stylesheets: paintCss,
        fonts,
        images,
        emoji: "noto",
        fontFamilies: [...PHI_FONT_FAMILIES],
        lang: "zh-CN",
      } as Parameters<typeof render>[1]),
    )

    const ms = performance.now() - started
    const ratioLabel = paint.ratio === PIXEL_RATIO ? String(PIXEL_RATIO) : paint.ratio.toFixed(3)
    logger.ok(`card ${id} ${width}x${height} @${ratioLabel}x ${format} ${bytes.length}B in ${Math.round(ms)}ms`)
    return { bytes, mime: mime(format), ext: ext(format), width, height }
  }

  async renderTemplate(
    def: TemplateDefinition,
    data: Record<string, unknown>,
    helpers: { compileArt: (page: string, data: Record<string, unknown>) => string; resources: string },
  ): Promise<RenderedImage> {
    const started = performance.now()
    let img: RenderedImage
    if (typeof def.render === "function") {
      const node = await def.render(data, helpers)
      if (node && typeof node !== "string") {
        img = await this.renderJsx(node, def)
        logger.info(`renderTemplate ${def.id} total ${fmtMs(performance.now() - started)}`)
        return img
      }
      if (typeof node === "string") {
        img = await this.renderHtml(node, {
          width: def.width,
          height: def.height,
          format: def.format,
          quality: def.quality,
          baseDir: helpers.resources,
          id: def.id,
        })
        logger.info(`renderTemplate ${def.id} total ${fmtMs(performance.now() - started)}`)
        return img
      }
    }
    if (!def.html) throw new Error(`template ${def.id} has neither html() nor render()`)
    const html = await def.html(data, helpers)
    img = await this.renderHtml(html, {
      width: def.width,
      height: def.height,
      format: def.format,
      quality: def.quality,
      baseDir: helpers.resources,
      id: def.id,
    })
    logger.info(`renderTemplate ${def.id} total ${fmtMs(performance.now() - started)}`)
    return img
  }

  private async renderJsx(node: unknown, def: TemplateDefinition): Promise<RenderedImage> {
    const started = performance.now()
    await this.ensureFonts()
    const width = def.width ?? 1200
    const height = def.height ?? 1800
    const format = def.format ?? "jpeg"
    const quality = def.quality ?? 90
    const fonts = this.fonts.map(f => ({
      name: f.name,
      data: f.data,
      weight: f.weight ?? 400,
      style: f.style ?? "normal",
    }))
    const bytes = Buffer.from(
      await render(node as never, {
        renderer: this.renderer,
        width,
        height,
        format,
        quality,
        fonts,
        emoji: "noto",
      } as Parameters<typeof render>[1]),
    )
    logger.ok(`card ${def.id} ${width}x${height} ${format} ${bytes.length}B in ${Math.round(performance.now() - started)}ms`)
    return { bytes, mime: mime(format), ext: ext(format), width, height }
  }

  async close() {
    this.renderer = undefined
  }
}
