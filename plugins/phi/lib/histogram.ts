const PLOT_H = 136
const GUTTER_W = 40
const LABEL_H = 28
const PLOT_BOX_H = PLOT_H + LABEL_H

function wrapAxisTitle(text: string): string {
  const parts = text.trim().split(/\s+/)
  if (parts.length >= 2) {
    return `<span>${parts.slice(0, -1).join(" ")}</span><span>${parts[parts.length - 1]}</span>`
  }
  return `<span>${text}</span>`
}

function stackSlotLabel(label: string): string {
  const m = /^(P|B)(\d+)$/i.exec(label.trim())
  if (!m) return label
  return `<span>${m[1]}</span><span>${m[2]}</span>`
}

export function layoutHistogram(html: string): string {
  const plot = PLOT_H
  let out = html.replace(
    /<div class="histogram-summary">\s*<p(?: class="histogram-avg-label")?>([^<]*)<\/p>\s*<p>([^<]*)<\/p>\s*<\/div>/,
    (_m, label: string, avg: string) =>
      `<div class="histogram-summary" style="text-align:right;flex:none;min-width:140px;">` +
      `<p class="histogram-avg-label" style="font-size:12px;color:rgba(255,255,255,0.75);">${label}</p>` +
      `<p style="font-size:24px;color:#ffffff;font-family:Aldrich,PHI;">${avg}</p></div>`,
  )
  out = out.replace(
    /<div class="histogram-chart">/g,
    `<div class="histogram-chart" style="position:relative;width:100%;height:178px;padding-top:8px;overflow:hidden;">`,
  )
  out = out.replace(
    /<div class="histogram-plot">/g,
    `<div class="histogram-plot" style="position:relative;width:100%;height:${PLOT_BOX_H}px;overflow:hidden;">`,
  )
  out = out.replace(
    /<div class="histogram-y-ticks">/g,
    `<div class="histogram-y-ticks" style="position:absolute;left:0;top:0;width:${GUTTER_W}px;height:${plot}px;">`,
  )
  out = out.replace(
    /<div class="histogram-scale">/g,
    `<div class="histogram-scale" style="position:absolute;left:${GUTTER_W}px;right:0;top:0;height:${plot}px;">`,
  )
  out = out.replace(
    /<div class="histogram-bars">/g,
    `<div class="histogram-bars" style="position:absolute;left:${GUTTER_W}px;right:3px;top:0;height:${PLOT_BOX_H}px;display:flex;flex-direction:row;align-items:stretch;">`,
  )
  out = out.replace(
    /class="histogram-bar ([^"]+)" style="height:\s*([0-9.]+)%;?"/g,
    (_m, kind: string, pct: string) => {
      const h = Math.max(3, Math.round((Number(pct) / 100) * plot))
      return `class="histogram-bar ${kind}" style="height:${h}px;width:72%;min-height:3px;"`
    },
  )
  out = out.replace(
    /<div class="histogram-grid-line" style="bottom:\s*([0-9.]+)%;?">\s*(?:<p>[^<]*<\/p>\s*)?<\/div>/g,
    (_m, pct: string) => {
      const bottom = Math.round((Number(pct) / 100) * plot)
      return `<div class="histogram-grid-line" style="position:absolute;left:0;right:0;bottom:${bottom}px;border-top:1px dashed rgba(255,255,255,0.28);"></div>`
    },
  )
  out = out.replace(
    /<p class="histogram-y-tick" style="bottom:\s*([0-9.]+)%;?">([^<]*)<\/p>/g,
    (_m, pct: string, label: string) => {
      const bottom = Math.round((Number(pct) / 100) * plot)
      return `<p class="histogram-y-tick" style="position:absolute;right:2px;bottom:${bottom}px;margin:0;padding:0;width:36px;text-align:right;white-space:nowrap;font-size:10px;line-height:1;color:rgba(255,255,255,0.75);">${label}</p>`
    },
  )
  out = out.replace(
    /<div class="average-marker" style="bottom:\s*([0-9.]+)%;?">\s*<p>([^<]*)<\/p>\s*<\/div>/g,
    (_m, pct: string, label: string) => {
      const bottom = Math.round((Number(pct) / 100) * plot)
      return (
        `<div class="average-marker" style="position:absolute;left:0;right:0;bottom:${bottom}px;height:2px;background:#ffffff;">` +
        `<p style="position:absolute;top:-14px;right:4px;margin:0;padding:0;white-space:nowrap;font-size:9px;line-height:1;color:#ffffff;">${label}</p></div>`
      )
    },
  )
  out = out.replace(
    /<div class="histogram-y-label">([^<]*)<\/div>/g,
    (_m, text: string) =>
      `<div class="histogram-y-label" style="position:absolute;left:0;top:${plot}px;width:${GUTTER_W}px;height:${LABEL_H}px;display:flex;flex-direction:column;justify-content:center;align-items:flex-end;overflow:visible;writing-mode:horizontal-tb;font-size:8px;line-height:1.15;color:rgba(255,255,255,0.52);">${wrapAxisTitle(text)}</div>`,
  )
  out = out.replace(
    /<p class="histogram-slot-label">([^<]*)<\/p>/g,
    (_m, label: string) =>
      `<p class="histogram-slot-label" style="display:flex;flex-direction:column;align-items:center;justify-content:flex-start;height:24px;width:100%;font-size:7px;line-height:1;margin:0;padding:2px 0 0;transform:none;">${stackSlotLabel(label)}</p>`,
  )
  return out
}
