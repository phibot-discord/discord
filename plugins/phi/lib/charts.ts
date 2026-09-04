/** Static SVG charts for Takumi (scripts are stripped before paint). */

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import sharp from "sharp"

export type LineSeg = [number, number, number, number]

type ChartPoint = {
  x: number
  y: number
  xLabel?: string
  yLabel?: string
  visX?: boolean
  visY?: boolean
}

type ChartLine = {
  color?: string
  data: ChartPoint[]
}

type RadarWord = { name: string; value: number }

function n(v: number, d = 2) {
  return Number.isFinite(v) ? v.toFixed(d) : "0"
}

function lighten(hex: string, alpha = 0.4) {
  const h = hex.replace("#", "")
  if (h.length < 6) return `rgba(255,255,255,${alpha})`
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c)
}

/** Convert percent-space line segments to a painted SVG. Y is flipped (original CSS used scaleY(-1)). */
function percentLineChartSvg(segs: LineSeg[], opts: { stroke?: string; width?: number; height?: number } = {}) {
  const stroke = opts.stroke || "#ffffff"
  const w = opts.width ?? 100
  const h = opts.height ?? 100
  const parts: string[] = []
  const pts = new Map<string, { x: number; y: number }>()
  for (const [x1, y1, x2, y2] of segs) {
    const a = { x: x1, y: 100 - y1 }
    const b = { x: x2, y: 100 - y2 }
    parts.push(`M ${n(a.x)} ${n(a.y)} L ${n(b.x)} ${n(b.y)}`)
    pts.set(`${n(a.x)}:${n(a.y)}`, a)
    pts.set(`${n(b.x)}:${n(b.y)}`, b)
  }
  const circles = [...pts.values()]
    .map(p => `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="1.5" fill="${stroke}"/>`)
    .join("")
  return (
    `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" ` +
    `style="width:100%;height:100%;overflow:visible;display:block;transform:none;">` +
    `<path d="${parts.join(" ")}" fill="none" stroke="${stroke}" stroke-width="1.8" ` +
    `stroke-linejoin="round" stroke-linecap="round"/>${circles}</svg>`
  )
}

/** Port of default.art `drawDifficultyChart` — real path markup, no runtime JS. */
function difficultyChartSvg(lines: ChartLine[], width = 800, height = 250) {
  const margin = { top: 30, right: 30, bottom: 50, left: 60 }
  const innerW = width - margin.left - margin.right
  const innerH = height - margin.top - margin.bottom
  const all = lines.flatMap(l => l.data)
  if (!all.length) {
    return `<svg id="difficultyChart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"></svg>`
  }
  const xs = all.map(d => d.x)
  const ys = all.map(d => d.y)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  const xPad = (xMax - xMin) * 0.1 || 1
  const yPad = (yMax - yMin) * 0.1 || 1
  const x0 = xMin - xPad
  const x1 = xMax + xPad
  const y0 = yMin - yPad
  const y1 = yMax + yPad
  const xScale = (v: number) => ((v - x0) / (x1 - x0)) * innerW
  const yScale = (v: number) => innerH - ((v - y0) / (y1 - y0)) * innerH
  const bits: string[] = []
  bits.push(`<g transform="translate(${margin.left},${margin.top})">`)
  bits.push(`<line x1="0" y1="${innerH}" x2="${innerW}" y2="${innerH}" stroke="white" stroke-width="1"/>`)
  bits.push(`<line x1="0" y1="0" x2="0" y2="${innerH}" stroke="white" stroke-width="1"/>`)
  for (let i = 0; i <= 5; i++) {
    const xv = x0 + (i / 5) * (x1 - x0)
    const x = xScale(xv)
    bits.push(`<line x1="${n(x)}" y1="${innerH}" x2="${n(x)}" y2="${innerH + 6}" stroke="white"/>`)
    const yv = y0 + (i / 5) * (y1 - y0)
    const y = yScale(yv)
    bits.push(`<line x1="-6" y1="${n(y)}" x2="0" y2="${n(y)}" stroke="white"/>`)
  }
  for (const line of lines) {
    const data = line.data
    const color = line.color || "#64B5F6"
    const dash = lighten(color, 0.4)
    if (data.length > 1) {
      const d = data.map((p, i) => `${i ? "L" : "M"} ${n(xScale(p.x))} ${n(yScale(p.y))}`).join(" ")
      bits.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>`)
    }
    for (const p of data) {
      const x = xScale(p.x)
      const y = yScale(p.y)
      bits.push(`<circle cx="${n(x)}" cy="${n(y)}" r="4" fill="${color}"/>`)
      if (p.visX) {
        bits.push(
          `<line x1="${n(x)}" y1="${n(y)}" x2="${n(x)}" y2="${innerH}" stroke="${dash}" stroke-width="1" stroke-dasharray="4,2"/>`,
        )
        bits.push(
          `<text x="${n(x)}" y="${innerH + 15}" text-anchor="middle" font-size="11" fill="${color}">${esc(p.xLabel || "")}</text>`,
        )
      }
      if (p.visY) {
        bits.push(
          `<line x1="${n(x)}" y1="${n(y)}" x2="0" y2="${n(y)}" stroke="${dash}" stroke-width="1" stroke-dasharray="4,2"/>`,
        )
        bits.push(
          `<text x="-10" y="${n(y)}" text-anchor="end" dominant-baseline="middle" font-size="11" fill="${color}">${esc(p.yLabel || "")}</text>`,
        )
      }
    }
  }
  bits.push("</g>")
  return (
    `<svg id="difficultyChart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
    `style="width:${width}px;height:${height}px;overflow:visible;display:block;">${bits.join("")}</svg>`
  )
}

function radarSvg(words: RadarWord[], maxValue: number, size = 280) {
  const cx = size / 2
  const cy = size / 2
  const r = size * 0.34
  const nAxes = Math.max(3, words.length)
  const max = Math.max(1, maxValue)
  const pt = (i: number, t: number) => {
    const ang = -Math.PI / 2 + (i / nAxes) * Math.PI * 2
    return { x: cx + Math.cos(ang) * r * t, y: cy + Math.sin(ang) * r * t }
  }
  const grids: string[] = []
  for (const t of [0.25, 0.5, 0.75, 1]) {
    const pts = Array.from({ length: nAxes }, (_, i) => pt(i, t))
    grids.push(`<polygon points="${pts.map(p => `${n(p.x)} ${n(p.y)}`).join(" ")}" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="1"/>`)
  }
  const axes = Array.from({ length: nAxes }, (_, i) => {
    const p = pt(i, 1)
    return `<line x1="${n(cx)}" y1="${n(cy)}" x2="${n(p.x)}" y2="${n(p.y)}" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>`
  })
  const shapePts = words.map((w, i) => pt(i, Math.max(0.04, Math.min(1, w.value / max))))
  const labels = words.map((w, i) => {
    const p = pt(i, 1.22)
    const anchor = p.x < cx - 8 ? "end" : p.x > cx + 8 ? "start" : "middle"
    return (
      `<text x="${n(p.x)}" y="${n(p.y)}" text-anchor="${anchor}" fill="#fff" font-size="13" font-family="PHI">` +
      `${esc(w.name)} (${w.value})</text>`
    )
  })
  const shape =
    shapePts.length >= 3
      ? `<polygon points="${shapePts.map(p => `${n(p.x)} ${n(p.y)}`).join(" ")}" fill="rgba(100,200,255,0.28)" stroke="rgba(100,200,255,0.9)" stroke-width="2"/>` +
        shapePts.map(p => `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="3" fill="#fff"/>`).join("")
      : ""
  return (
    `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="display:block;margin:0 auto;">` +
    `${grids.join("")}${axes.join("")}${shape}${labels.join("")}</svg>`
  )
}


export type TagRadarPlot = {
  grids: string[]
  axes: { x: number; y: number }[]
  points: string
  categories: {
    name: string
    displayRks: string
    pointX: number
    pointY: number
    labelX: number
    labelY: number
    anchor: "start" | "middle" | "end"
  }[]
}

function labelShift(anchor: "start" | "middle" | "end") {
  if (anchor === "end") return "translate(-100%, -10px)"
  if (anchor === "start") return "translate(0, -10px)"
  return "translate(-50%, -10px)"
}

function radarLabels(radar: TagRadarPlot) {
  return radar.categories
    .map(category => {
      const score = esc(category.displayRks)
      return (
        `<div class="tag-radar-html-label is-${category.anchor}" style="position:absolute;left:${category.labelX}px;top:${category.labelY}px;transform:${labelShift(category.anchor)};">` +
        `<p class="tag-radar-html-name" style="margin:0;color:#ffffff;font-size:10px;line-height:1.15;white-space:nowrap;">${esc(category.name)}</p>` +
        `<p class="tag-radar-html-score" style="margin:2px 0 0;color:#00b7f0;font-size:8px;line-height:1;white-space:nowrap;">${score}</p>` +
        `</div>`
      )
    })
    .join("")
}

export function tagRadarPlotSvg(radar: TagRadarPlot, scale = 1) {
  const grids = radar.grids
    .map(grid => `<polygon points="${grid}" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="1"/>`)
    .join("")
  const axes = radar.axes
    .map(axis => `<line x1="100" y1="92" x2="${axis.x}" y2="${axis.y}" fill="none" stroke="rgba(255,255,255,0.32)" stroke-width="1"/>`)
    .join("")
  const shape = radar.points
    ? `<polygon points="${radar.points}" fill="#ffffff" fill-opacity="0.92" stroke="#ffffff" stroke-width="2"/>`
    : ""
  const dots = radar.categories
    .map(category => `<circle cx="${category.pointX}" cy="${category.pointY}" r="3.2" fill="#ffffff" stroke="#ffffff" stroke-width="1"/>`)
    .join("")
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${200 * scale}" height="${184 * scale}" viewBox="0 0 200 184">` +
    `${grids}${axes}${shape}${dots}</svg>`
  )
}

export async function tagRadarPlotPng(radar: TagRadarPlot) {
  return sharp(Buffer.from(tagRadarPlotSvg(radar, 2))).png().toBuffer()
}

function radarPlotFileSrc(png: Buffer) {
  const dir = join(tmpdir(), "phi-tag-radar")
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${createHash("sha1").update(png).digest("hex").slice(0, 20)}.png`)
  if (!existsSync(file)) writeFileSync(file, png)
  return pathToFileURL(file).href
}

/** Plot is a PNG file so Takumi uses the same image path as song ills. */
export async function tagRadarHtml(radar: TagRadarPlot) {
  const png = await tagRadarPlotPng(radar)
  const src = radarPlotFileSrc(png)
  return (
    `<div class="tag-radar" style="width:200px;height:184px;position:relative;flex:none;overflow:visible;">` +
    `<img class="tag-radar-plot" width="200" height="184" src="${src}" style="width:200px;height:184px;max-width:200px;max-height:184px;display:block;flex:none;padding:0;margin:0;object-fit:fill;position:relative;z-index:2;top:auto;right:auto;bottom:auto;left:auto;transform:none;min-width:200px;min-height:184px;"/>` +
    radarLabels(radar) +
    `</div>`
  )
}

export function paintTagRadarSvg(html: string) {
  if (!html.includes("tag-radar")) return html
  return html.replace(/<svg\b[^>]*class="[^"]*\btag-radar\b[^"]*"[^>]*>[\s\S]*?<\/svg>/i, "")
}

export function polishSvgCharts(html: string) {
  let out = injectDifficultyChart(html)
  out = replacePercentSvgLines(out)
  out = injectRadarFromScript(out)
  out = paintTagRadarSvg(out)
  return out
}

function injectDifficultyChart(html: string) {
  if (!html.includes('id="difficultyChart"')) return html
  const m = html.match(/const sampleLines\s*=\s*(\[[\s\S]*?\]);/)
  if (!m?.[1]) return html
  try {
    const lines = JSON.parse(m[1]) as ChartLine[]
    const svg = difficultyChartSvg(Array.isArray(lines) ? lines : [], 800, 250)
    return html.replace(/<svg\b[^>]*id="difficultyChart"[^>]*>[\s\S]*?<\/svg>/i, svg)
  } catch {
    return html
  }
}

function replacePercentSvgLines(html: string) {
  return html.replace(/<svg\b[^>]*>([\s\S]*?)<\/svg>/g, (full, inner: string) => {
    const hits = [
      ...inner.matchAll(
        /<line\b[^>]*x1="([\d.]+)%"[^>]*y1="([\d.]+)%"[^>]*x2="([\d.]+)%"[^>]*y2="([\d.]+)%"[^>]*\/?\s*>/g,
      ),
    ]
    if (!hits.length) return full
    const segs: LineSeg[] = hits.map(h => [Number(h[1]), Number(h[2]), Number(h[3]), Number(h[4])])
    return percentLineChartSvg(segs)
  })
}

function injectRadarFromScript(html: string) {
  if (!html.includes('id="words"')) return html
  const names = [...html.matchAll(/indicators\.push\(\{name:\s*'([^']*)'/g)].map(m => m[1] || "")
  const values = [...html.matchAll(/values\.push\(([\d.]+)\)/g)].map(m => Number(m[1]))
  const maxM = html.match(/max:\s*([\d.]+)/)
  if (!names.length || names.length !== values.length) return html
  const words = names.map((name, i) => ({ name: name.replace(/\([^)]*\)\s*$/, "").trim() || name, value: values[i] || 0 }))
  const max = Number(maxM?.[1] || 1)
  const svg = radarSvg(words, max, 280)
  return html.replace(/<div class="words" id="words"><\/div>/, `<div class="words" id="words" style="width:100%;height:280px;display:flex;align-items:center;justify-content:center;">${svg}</div>`)
}
