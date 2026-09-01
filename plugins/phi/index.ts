import { readdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { logger } from "../../src/logger.ts"
import { type App, definePlugin, defineTemplate } from "../../src/sdk/index.ts"
import { blurCardBackgrounds, contrastOverBackground } from "./lib/blur.ts"
import { Catalog } from "./lib/catalog.ts"
import { kvKey } from "./lib/const.ts"
import { polishSvgCharts } from "./lib/charts.ts"
import { fCompute } from "./lib/fcompute.ts"
import { knobNum } from "./lib/knobs.ts"
import { bootPhiRuntime } from "./lib/runtime.ts"
import { readPhiVersion } from "./lib/version.ts"
import { cardCopy, resolvePhiLocale } from "./lib/card-i18n.ts"

const PHI_CSS = join(dirname(fileURLToPath(import.meta.url)), "css")

function cssLink(file: string) {
  return `<link rel="stylesheet" href="${pathToFileURL(join(PHI_CSS, file)).href}">`
}

function artPages(htmlRoot: string): { app: string; tpl: string }[] {
  const out: { app: string; tpl: string }[] = []
  let dirs: string[] = []
  try {
    dirs = readdirSync(htmlRoot)
  } catch {
    return out
  }
  for (const app of dirs) {
    const dir = join(htmlRoot, app)
    try {
      if (!statSync(dir).isDirectory()) continue
      for (const f of readdirSync(dir)) {
        if (f.endsWith(".art")) out.push({ app, tpl: f.slice(0, -4) })
      }
    } catch {
      /* skip */
    }
  }
  return out
}

function stripDivsWithClass(html: string, className: string): string {
  const openRe = new RegExp(`<div\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`, "i")
  let out = html
  for (;;) {
    const m = openRe.exec(out)
    if (!m) break
    const start = m.index
    let i = start + m[0].length
    let depth = 1
    while (i < out.length && depth > 0) {
      const nextDiv = out.indexOf("<div", i)
      const nextClose = out.indexOf("</div>", i)
      if (nextClose < 0) break
      if (nextDiv !== -1 && nextDiv < nextClose) {
        depth++
        i = nextDiv + 4
      } else {
        depth--
        i = nextClose + 6
      }
    }
    out = `${out.slice(0, start)}${out.slice(i)}`
    openRe.lastIndex = 0
  }
  return out
}

function pickTip(tips: string[]): string {
  const list = tips.map(t => t.trim()).filter(Boolean)
  if (!list.length) return ""
  return list[Math.floor(Math.random() * list.length)]!
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function ensureTipFooter(html: string, tip: string): string {
  if (!tip.trim() || /class="[^"]*\btips\b/.test(html)) return html
  const block = `<div class="tips tips-abs"><p>Tip:${escapeHtml(tip)}</p></div>`
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${block}</body>`) : html + block
}

function polishCardHtml(html: string, tip = "") {
  const extra = [
    cssLink("knobs.css"),
    cssLink("takumi.css"),
    html.includes("playerInfo") ? cssLink("player.css") : "",
    html.includes("phi_song") || html.includes('class="b19"') ? cssLink("b30.css") : "",
    html.includes("rks_line") && html.includes("record_box") ? cssLink("update.css") : "",
    html.includes("Player_Info") ? cssLink("userinfo.css") : "",
    html.includes("full-box") && html.includes("left-mid") ? cssLink("userinfo-old.css") : "",
    html.includes("changeTag") || html.includes("descTip") || html.includes("hisb30") ? cssLink("hisb30.css") : "",
    html.includes("list_box") ? cssLink("listcard.css") : "",
    html.includes("setting-group") ? cssLink("myset.css") : "",
    html.includes('class="song song_') ? cssLink("chap.css") : "",
    html.includes("progress_bar-in-phi") ? cssLink("lvsco.css") : "",
    html.includes("Constant Table") ? cssLink("tablecard.css") : "",
  ].join("")
  let out = html.replace(/<title>[^<]*<\/title>/gi, "<title>phi</title>")
  out = stripInlineFilters(out)
  out = out.replace(/\s*filter:\s*none;?/gi, "")
  out = out.replace(/<canvas\b[^>]*>[\s\S]*?<\/canvas>/gi, "")
  out = out.replace(/&ensp;/g, "&nbsp;")
  out = stripDivsWithClass(out, "snow-box")
  out = stripDivsWithClass(out, "createdbox")
  out = ensureTipFooter(out, tip)
  out = tagStarBackgrounds(out)
  out = layoutFlowLines(out)
  out = convertSheetToTable(out)
  out = liftAvatarOverRks(out)
  out = layoutHistogram(out)
  out = layoutGradeWithScore(out)
  out = wrapB30Info(out)
  out = shrinkSongTitles(out)
  out = layoutHistoryB30(out)
  out = layoutInfoPanels(out)
  out = layoutUpdateCard(out)
  out = polishSvgCharts(out)
  if (out.includes("</head>")) return out.replace("</head>", `${extra}</head>`)
  return extra + out
}

function tagStarBackgrounds(html: string) {
  return html.replace(/<div class="background theme-background">([\s\S]*?)<\/div>/i, (_m, inner: string) => {
    let n = 0
    const tagged = inner.replace(/<img\b/gi, () => {
      n += 1
      if (n === 1) return `<img class="star-base"`
      if (n === 2) return `<img class="star-overlay"`
      return `<img`
    })
    return `<div class="background theme-background">${tagged}</div>`
  })
}

function layoutFlowLines(html: string) {
  const widths = {
    l: ["50%", "25%", "12.5%", "6.25%", "3.125%", "1.5625%"],
    r: ["1.5625%", "3.125%", "6.25%", "12.5%", "25%", "50%"],
  }
  return html.replace(
    /<div class="flow_line_box_(l|r)">((?:\s*<div class="flow_line"><\/div>)*)\s*<\/div>/g,
    (_m, side: "l" | "r", inner: string) => {
      let i = 0
      const body = inner.replace(/<div class="flow_line"><\/div>/g, () => {
        const w = widths[side][i++] ?? "8%"
        return `<div class="flow_line" style="width:${w};flex:none;height:15px;background:#ffffff;"></div>`
      })
      return `<div class="flow_line_box_${side}">${body}</div>`
    },
  )
}

function stripInlineFilters(html: string) {
  return html.replace(/\sstyle="([^"]*)"/gi, (_m, style: string) => {
    const next = style
      .replace(/filter\s*:[^;"]*;?/gi, "")
      .replace(/backdrop-filter\s*:[^;"]*;?/gi, "")
      .replace(/;{2,}/g, ";")
      .trim()
      .replace(/^;|;$/g, "")
    return next ? ` style="${next}"` : ""
  })
}

function liftAvatarOverRks(html: string) {
  return html.replace(
    /(<div class="avatar clip-box">\s*<img\b[^>]*>\s*<\/div>)\s*(<div class="playerId">[\s\S]*?<\/div>)\s*(<div class="rks clip-box">[\s\S]*?<\/div>)/g,
    "$2$3$1",
  )
}

function convertSheetToTable(html: string) {
  const marker = '<div class="sheet">'
  const start = html.indexOf(marker)
  if (start < 0) return html
  let i = start + marker.length
  let depth = 1
  while (i < html.length && depth > 0) {
    const nextDiv = html.indexOf("<div", i)
    const nextClose = html.indexOf("</div>", i)
    if (nextClose < 0) break
    if (nextDiv !== -1 && nextDiv < nextClose) {
      depth++
      i = nextDiv + 4
    } else {
      depth--
      i = nextClose + 6
    }
  }
  const block = html.slice(start, i)
  const texts = [...block.matchAll(/<div class="poz"[^>]*>\s*<p>([\s\S]*?)<\/p>/g)].map(m => {
    const t = m[1]!.replace(/&amp;/g, "&").trim()
    return t === "\\" || t === "/" || t === "\\\\" ? "" : t
  })
  const cols = 5
  if (texts.length < cols * 2 || texts.length % cols !== 0) return html
  const labW = Math.round(knobNum("--b30-stats-lab-width", 48))
  const valW = Math.round(knobNum("--b30-stats-val-width", 48))
  const colLeft = (i: number) => (i === 0 ? 0 : labW + (i - 1) * valW)
  const cell = (kind: "lab" | "val", text: string, i: number) => {
    const w = kind === "lab" ? labW : valW
    return (
      `<div class="stats-${kind}" style="position:absolute;left:${colLeft(i)}px;top:0;width:${w}px;height:24px;` +
      `display:flex;justify-content:center;align-items:center;text-align:center;box-sizing:border-box;">${text || "&nbsp;"}</div>`
    )
  }
  const rows: string[] = []
  for (let r = 0; r < texts.length / cols; r++) {
    const cells = texts.slice(r * cols, r * cols + cols)
    rows.push(
      `<div class="stats-row stats-row-${r}" style="position:relative;height:24px;width:${labW + valW * 4}px;">` +
        cells.map((c, ci) => cell(ci === 0 ? "lab" : "val", c, ci)).join("") +
        `</div>`,
    )
  }
  const table = `<div class="stats-table">${rows.join("")}</div>`
  return `${html.slice(0, start)}${table}${html.slice(i)}`
}

function layoutHistogram(html: string) {
  const plot = 136
  let out = html.replace(
    /<div class="histogram-summary">\s*<p(?: class="histogram-avg-label")?>([^<]*)<\/p>\s*<p>([^<]*)<\/p>\s*<\/div>/,
    (_m, label: string, avg: string) =>
      `<div class="histogram-summary" style="text-align:right;flex:none;min-width:160px;">` +
      `<p class="histogram-avg-label" style="font-size:12px;color:rgba(255,255,255,0.75);">${label}</p>` +
      `<p style="font-size:24px;color:#ffffff;font-family:Aldrich,PHI;">${avg}</p></div>`,
  )
  out = out.replace(
    /class="histogram-bar ([^"]+)" style="height:\s*([0-9.]+)%;?"/g,
    (_m, kind: string, pct: string) => {
      const h = Math.max(3, Math.round((Number(pct) / 100) * plot))
      return `class="histogram-bar ${kind}" style="height:${h}px;width:72%;min-height:3px;"`
    },
  )
  out = out.replace(
    /class="histogram-grid-line" style="bottom:\s*([0-9.]+)%;?"/g,
    (_m, pct: string) => {
      const bottom = Math.round((Number(pct) / 100) * plot)
      return `class="histogram-grid-line" style="position:absolute;left:0;right:0;bottom:${bottom}px;border-top:1px dashed rgba(255,255,255,0.28);"`
    },
  )
  out = out.replace(
    /class="average-marker" style="bottom:\s*([0-9.]+)%;?"/g,
    (_m, pct: string) => {
      const bottom = Math.round((Number(pct) / 100) * plot)
      return `class="average-marker" style="position:absolute;left:29px;right:0;bottom:${bottom}px;height:2px;background:#ffffff;"`
    },
  )
  return out
}

function layoutGradeWithScore(html: string) {
  return html.replace(
    /<div class="songinfo">\s*<div class="Rating">([\s\S]*?)<\/div>\s*<div class="chengji">\s*<div class="score">([\s\S]*?)<\/div>/g,
    `<div class="songinfo"><div class="chengji"><div class="score-line"><div class="Rating">$1</div><div class="score">$2</div></div>`,
  )
}

function wrapB30Info(html: string) {
  if (!html.includes("phi_song") && !html.includes('class="b19"')) return html
  const openRe = /<div class="info-(?:AT|IN|HD|EZ)">/g
  let out = ""
  let last = 0
  for (;;) {
    const m = openRe.exec(html)
    if (!m) break
    const start = m.index
    const innerStart = start + m[0].length
    const end = closeDiv(html, start)
    const inner = html.slice(innerStart, end - 6)
    out += `${html.slice(last, start)}${m[0]}<div class="info-mid">${inner}</div></div>`
    last = end
    openRe.lastIndex = end
  }
  return out + html.slice(last)
}

function textUnits(s: string) {
  let units = 0
  for (const ch of s) units += ch.charCodeAt(0) <= 0xff ? 0.55 : 1
  return Math.max(units, 1)
}

function layoutInfoPanels(html: string) {
  if (!html.includes("Player_Info") || !html.includes('<div class="right">')) return html
  let out = html
  out = out.replace(
    '<div class="left">',
    `<div class="left" style="position:relative;left:auto;top:auto;width:680px;min-height:1100px;flex:none;z-index:2;">`,
  )
  out = out.replace(
    '<div class="right">',
    `<div class="right" style="position:relative;right:auto;top:auto;width:1140px;flex:none;z-index:2;display:flex;flex-direction:column;align-items:center;transform:none;">`,
  )
  out = out.replace(
    '<div class="Player_Id-box">',
    `<div class="Player_Id-box" style="flex:1 1 auto;min-width:0;max-width:520px;height:83px;overflow:hidden;">`,
  )
  out = out.replace(
    /(<div class="Player_profile_box">\s*<p )([^>]*)(>)([\s\S]*?)(<\/p>)/,
    (_m, open: string, attrs: string, gt: string, text: string, close: string) => {
      const units = textUnits(decodeHtmlText(text.replace(/<br\s*\/?>/gi, " ")).trim())
      // fit into ~640x230: f^2 * 1.3 * units <= area
      const px = Math.min(44, Math.max(16, Math.floor(Math.sqrt((640 * 230) / (1.3 * Math.max(units, 1))))))
      return `${open}${attrs} style="font-size:${px}px;line-height:1.3;overflow:hidden;"${gt}${text}${close}`
    },
  )
  out = out.replace(
    /(<div class="Player_Id-right">\s*<p name="pvis")([^>]*)(>)([\s\S]*?)(<\/p>)/,
    (_m, open: string, attrs: string, gt: string, text: string, close: string) => {
      const plain = decodeHtmlText(text.replace(/<[^>]+>/g, " ")).trim()
      let units = 0
      for (const ch of plain) units += ch.charCodeAt(0) <= 0xff ? 0.75 : 1.1
      const px = Math.min(40, Math.max(16, Math.floor(500 / Math.max(units, 1))))
      return `${open}${attrs} style="font-size:${px}px;white-space:nowrap;overflow:hidden;line-height:1.15;width:100%;max-width:100%;"${gt}${text}${close}`
    },
  )
  return out
}

function titleFontPx(name: string) {
  let units = 0
  for (const ch of name) units += ch.charCodeAt(0) <= 0xff ? 0.46 : 0.95
  const avail = 158
  return Math.min(15, Math.max(10, Math.floor(avail / Math.max(units, 1))))
}

function shrinkSongTitles(html: string) {
  return html.replace(/<div class="songname">\s*<p name="pvis">([^<]*)<\/p>/g, (_m, raw: string) => {
    const px = titleFontPx(decodeHtmlText(raw).trim())
    return `<div class="songname"><p name="pvis" style="font-size:${px}px;white-space:nowrap;overflow:hidden;">${raw}</p>`
  })
}

function closeDiv(html: string, openIdx: number) {
  const gt = html.indexOf(">", openIdx)
  if (gt < 0) return html.length
  let i = gt + 1
  let depth = 1
  while (i < html.length && depth > 0) {
    const nextDiv = html.indexOf("<div", i)
    const nextClose = html.indexOf("</div>", i)
    if (nextClose < 0) return html.length
    if (nextDiv !== -1 && nextDiv < nextClose) {
      depth++
      i = nextDiv + 4
    } else {
      depth--
      i = nextClose + 6
    }
  }
  return i
}

function hisb30PackLines(songCounts: number[]) {
  const wideN = knobNum("--hisb30-wide-row-songs", 4)
  const lines: number[][] = []
  let cur: number[] = []
  let slots = 0
  songCounts.forEach((n, i) => {
    const need = n >= wideN ? 2 : 1
    if (slots && slots + need > 2) {
      lines.push(cur)
      cur = []
      slots = 0
    }
    cur.push(i)
    slots += need
    if (slots >= 2) {
      lines.push(cur)
      cur = []
      slots = 0
    }
  })
  if (cur.length) lines.push(cur)
  return lines
}

function hisb30RowMinHeight(n: number, wide: boolean) {
  const minH = knobNum("--hisb30-row-min-height", 230)
  if (!wide) return minH
  const cols = knobNum("--hisb30-wide-cols", 4)
  const jacketLines = Math.max(1, Math.ceil(n / Math.max(cols, 1)))
  return Math.max(
    minH,
    knobNum("--hisb30-songs-margin-top", 68) +
      knobNum("--hisb30-songs-pad", 20) * 2 +
      jacketLines * (knobNum("--hisb30-ill-height", 90) + knobNum("--hisb30-song-gap-y", 30)) +
      knobNum("--hisb30-row-pad-bottom", 24),
  )
}

function styleHisb30Tags(html: string) {
  const openRe = /<div class="tag-box">/g
  let tagged = ""
  let last = 0
  for (;;) {
    const m = openRe.exec(html)
    if (!m) break
    const start = m.index
    const end = closeDiv(html, start)
    const inner = html.slice(start + m[0].length, end - 6)
    let idx = 0
    const body = inner.replace(/<div class="changeTag ([^"]+)">/g, (_t, cls: string) => {
      const n = idx++
      return `<div class="changeTag ${cls} tag-${n}">`
    })
    tagged += `${html.slice(last, start)}<div class="tag-box">${body}</div>`
    last = end
    openRe.lastIndex = end
  }
  return tagged + html.slice(last)
}

function styleHisb30Row(rowHtml: string, songCount: number) {
  const color = /--row-color:\s*([^;"'\s]+)/.exec(rowHtml)?.[1] || "#00aaff"
  const wide = songCount >= knobNum("--hisb30-wide-row-songs", 4)
  const kind = wide ? "his-wide" : "his-short"
  const minH = hisb30RowMinHeight(songCount, wide)
  const songsMin = Math.max(160, minH - knobNum("--hisb30-songs-margin-top", 68))
  let row = rowHtml.replace(
    /<div class="row" style="--row-color:\s*([^"]+)">\s*<div class="date-box">\s*<div class="upLine"><\/div>\s*<div class="midCirc">\s*<div class="circInner"><\/div>\s*<\/div>\s*<div class="downLine"><\/div>/,
    `<div class="row ${kind}" style="--row-color:${color};min-height:${minH}px;">` +
      `<div class="date-box">` +
      `<div class="upLine" style="background-color:${color};"></div>` +
      `<div class="midCirc">` +
      `<div class="circInner" style="background-color:${color};"></div>` +
      `</div>` +
      `<div class="downLine" style="background-color:${color};"></div>`,
  )
  row = row.replace(/<div class="songs-box">/, `<div class="songs-box" style="min-height:${songsMin}px;">`)
  row = row.replace(
    /<div class="row-date">\s*<p>([^<]*)<\/p>\s*<div class="underLine"><\/div>/,
    `<div class="row-date"><p>$1</p><div class="underLine" style="background-color:${color};"></div>`,
  )
  return styleHisb30Tags(row)
}

function layoutHistoryB30(html: string) {
  if (!html.includes("changeTag") && !html.includes("descTip") && !html.includes("main-box")) return html
  const mainM = /<div class="main-box"[^>]*>/.exec(html)
  if (!mainM) return html
  const mainStart = mainM.index
  const innerStart = mainStart + mainM[0].length
  const mainEnd = closeDiv(html, mainStart)
  const inner = html.slice(innerStart, mainEnd - 6)
  const rows: string[] = []
  const rowOpenRe = /<div class="row" style="--row-color:/g
  for (;;) {
    const m = rowOpenRe.exec(inner)
    if (!m) break
    const end = closeDiv(inner, m.index)
    rows.push(inner.slice(m.index, end))
    rowOpenRe.lastIndex = end
  }
  if (!rows.length) return html
  const counts = rows.map(r => (r.match(/class="s-song"/g) || []).length)
  const styled = rows.map((r, i) => styleHisb30Row(r, counts[i]!))
  const packed = hisb30PackLines(counts)
  const lines = packed.map((idxs, lineI) => {
    const tuck = lineI === 0 ? "" : " his-tuck"
    const body = idxs.map(i => styled[i]!).join("")
    return `<div class="his-line${tuck}">${body}</div>`
  })
  return `${html.slice(0, innerStart)}${lines.join("")}${html.slice(mainEnd - 6)}`
}

function decodeHtmlText(raw: string) {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_n, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_n, h: string) => String.fromCharCode(parseInt(h, 16)))
}

function updateTitleFontPx(name: string) {
  let units = 0
  for (const ch of name) units += ch.charCodeAt(0) <= 0xff ? 0.52 : 1
  return Math.min(12, Math.max(8, Math.floor(108 / Math.max(units, 1))))
}

function layoutUpdateCard(html: string) {
  if (!(html.includes("rks_line") && html.includes("record_box"))) return html
  let out = html
  out = out.replace(
    /<div class="value_box">\s*<p>([^<]*)<\/p>\s*<p>([^<]*)<\/p>/,
    `<div class="value_box" style="height:102px;width:52px;display:flex;flex-direction:column;justify-content:space-between;align-items:flex-end;flex:none;margin:0;">` +
      `<p style="font-size:10px;margin:0;color:#fff;">$1</p>` +
      `<p style="font-size:10px;margin:0;color:#fff;">$2</p>`,
  )
  out = out.replace(
    /<div class="date_box">\s*<p>([^<]*)<\/p>\s*<p>([^<]*)<\/p>/,
    `<div class="date_box" style="width:100%;height:20px;display:flex;flex-direction:row;justify-content:space-between;align-items:center;overflow:visible;">` +
      `<p style="font-size:8px;margin:0;white-space:nowrap;color:#fff;">$1</p>` +
      `<p style="font-size:8px;margin:0;white-space:nowrap;color:#fff;">$2</p>`,
  )
  out = out.replace(
    /<div class="title_box">/g,
    `<div class="title_box" style="display:flex;flex-direction:row;align-items:flex-end;justify-content:flex-start;width:780px;overflow:visible;">`,
  )
  out = out.replace(
    /<div class="box_title" style="width:\s*([0-9.]+)px[^"]*">/g,
    (_m, w: string) =>
      `<div class="box_title" style="flex:0 0 ${w}px;width:${w}px;max-width:${w}px;min-width:${w}px;height:32px;position:relative;display:flex;flex-direction:row;align-items:center;margin:0 10px;overflow:visible;clip-path:none;">`,
  )
  out = out.replace(
    /<div class="box_title-left" style="background-color:\s*([^;"']+)[^"]*">\s*<p[^>]*>([^<]*)<\/p>/g,
    (_m, color: string, date: string) =>
      `<div class="box_title-left" style="background-color:${color};width:auto;min-width:160px;height:24px;padding:0 10px;display:flex;align-items:center;justify-content:center;overflow:visible;border-radius:4px;z-index:1;">` +
      `<p name="pvis" style="font-size:11px;white-space:nowrap;color:#fff;margin:0;">${date}</p>`,
  )
  out = out.replace(
    /<div class="box_title-right">\s*<p[^>]*>([^<]*)<\/p>/g,
    `<div class="box_title-right" style="position:absolute;right:4px;top:0;width:auto;height:22px;display:flex;align-items:center;z-index:1;">` +
      `<p name="pvis" style="font-size:10px;white-space:nowrap;color:#fff;margin:0;">$1</p>`,
  )
  out = out.replace(
    /<div class="box_title-right-down" style="background-color:\s*([^;"']+)[^"]*">\s*<\/div>/g,
    `<div class="box_title-right-down" style="background-color:$1;position:absolute;left:0;right:0;bottom:0;height:4px;min-height:4px;width:100%;border-radius:2px;overflow:hidden;line-height:4px;font-size:1px;color:$1;">.</div>`,
  )
  out = out.replace(
    /<div class="song_box"[^>]*>/g,
    `<div class="song_box" style="display:flex;flex-direction:row;justify-content:flex-start;flex-wrap:nowrap;overflow:visible;padding:8px 0 14px;width:780px;">`,
  )
  out = out.replace(
    /<div class="abox">/g,
    `<div class="abox" style="width:135px;height:104px;flex:none;position:relative;margin:0 10px;overflow:hidden;border-radius:5px;background:rgba(0,0,0,0.45);">`,
  )
  out = out.replace(
    /<div class="imgbox">/g,
    `<div class="imgbox" style="width:135px;height:72px;position:relative;overflow:hidden;">`,
  )
  out = out.replace(
    /(<div class="imgbox"[^>]*>)\s*<img /g,
    `$1<img style="width:135px;height:72px;object-fit:cover;display:block;" `,
  )
  out = out.replace(
    /<div class="infobox">/g,
    `<div class="infobox" style="position:absolute;top:0;left:0;width:135px;height:104px;display:flex;flex-direction:column;justify-content:space-between;">`,
  )
  out = out.replace(
    /<div class="namebox">/g,
    `<div class="namebox" style="height:20px;width:135px;flex:none;display:flex;flex-direction:row;align-items:center;padding:0 3px;box-sizing:border-box;background:rgba(0,0,0,0.62);">`,
  )
  out = out.replace(
    /<div class="namebox_ed">/g,
    `<div class="namebox_ed" style="height:20px;width:135px;flex:none;display:flex;flex-direction:row;align-items:center;background:rgba(255,217,0,0.72);">`,
  )
  out = out.replace(
    /<div class="namebox_un">/g,
    `<div class="namebox_un" style="height:20px;width:135px;flex:none;display:flex;flex-direction:row;align-items:center;background:rgba(255,0,0,0.72);">`,
  )
  out = out.replace(
    /<div class="new-box">/g,
    `<div class="new-box" style="width:18px;height:18px;flex:none;display:flex;align-items:center;justify-content:center;">`,
  )
  out = out.replace(/<div class="songsname">\s*<p name="pvis">([^<]*)<\/p>/g, (_m, raw: string) => {
    const px = Math.min(10, updateTitleFontPx(decodeHtmlText(raw).trim()))
    return (
      `<div class="songsname" style="position:relative;width:auto;flex:1;height:18px;min-width:0;display:flex;align-items:center;justify-content:center;">` +
      `<p name="pvis" style="font-size:${px}px;white-space:nowrap;overflow:hidden;margin:0;text-align:center;color:#fff;">${raw}</p>`
    )
  })
  out = out.replace(
    /<div class="songsinfo">/g,
    `<div class="songsinfo" style="height:32px;width:135px;flex:none;margin-top:auto;position:relative;background:rgba(0,0,0,0.78);display:flex;flex-direction:row;flex-wrap:wrap;align-items:center;padding:2px 4px;box-sizing:border-box;">`,
  )
  out = out.replace(
    /<div class="songsinfo_ed">/g,
    `<div class="songsinfo_ed" style="height:32px;width:135px;flex:none;margin-top:auto;position:relative;background:rgba(255,217,0,0.78);display:flex;flex-direction:row;flex-wrap:wrap;align-items:center;padding:2px 4px;box-sizing:border-box;">`,
  )
  out = out.replace(
    /<div class="songsinfo_un">/g,
    `<div class="songsinfo_un" style="height:32px;width:135px;flex:none;margin-top:auto;position:relative;background:rgba(255,0,0,0.78);display:flex;flex-direction:row;flex-wrap:wrap;align-items:center;padding:2px 4px;box-sizing:border-box;">`,
  )
  out = out.replace(
    /<div class="rank">\s*<p>([^<]*)<\/p>/g,
    `<div class="rank" style="position:static;transform:none;flex:none;margin-right:4px;"><p style="font-size:11px;color:rgba(255,255,255,0.8);margin:0;line-height:1.1;">$1</p>`,
  )
  out = out.replace(
    /<div class="score">\s*<p>([^<]*)<\/p>/g,
    `<div class="score" style="position:static;width:auto;flex:none;"><p style="font-size:11px;margin:0;color:#fff;line-height:1.1;">$1</p>`,
  )
  out = out.replace(
    /<div class="acc">/g,
    `<div class="acc" style="position:static;display:flex;flex-direction:row;align-items:flex-end;margin-left:auto;">`,
  )
  out = out.replace(
    /<div class="rks">\s*<p>([^<]*)<\/p>/g,
    `<div class="rks" style="position:static;left:auto;height:auto;min-width:0;min-height:0;width:auto;padding:0;overflow:visible;flex:none;margin-left:6px;"><p style="font-size:9px;margin:0;color:#fff;line-height:1.1;">$1</p>`,
  )
  out = out.replace(
    /<div class="songsinfo"[^>]*>\s*<div class="rank"[^>]*>\s*<p[^>]*>([^<]*)<\/p>\s*<\/div>\s*<div class="score"[^>]*>\s*<p[^>]*>([^<]*)<\/p>\s*<\/div>\s*<div class="acc"[^>]*>\s*<div class="acc_1"[^>]*>\s*<p[^>]*>([^<]*)<\/p>\s*<\/div>\s*<div class="acc_2"[^>]*>\s*<p[^>]*>([^<]*)<\/p>\s*<\/div>\s*<\/div>\s*(?:<div class="rks"[^>]*>\s*<p[^>]*>([^<]*)<\/p>\s*<\/div>\s*)?<\/div>/g,
    (_m, rank: string, score: string, acc1: string, acc2: string, rks?: string) =>
      `<div style="height:32px;width:135px;background:rgba(0,0,0,0.82);display:flex;flex-direction:column;justify-content:center;padding:2px 5px;box-sizing:border-box;">` +
      `<p style="margin:0;padding:0;font-size:11px;color:#ffffff;line-height:14px;">${rank}  ${score}</p>` +
      `<p style="margin:0;padding:0;font-size:10px;color:#ffffff;line-height:13px;">${acc1}${acc2}${rks ? `  ${rks}` : ""}</p></div>`,
  )
  return out
}

const TEMPLATE_WIDTH: Record<string, number> = {
  userinfo: 1920,
  "userinfo-old": 1800,
  score: 1920,
  update: 800,
  list: 800,
  lvsco: 2400,
  chap: 2048,
  table: 960,
  userSetting: 1080,
  historyB30: 1200,
  suggest: 1200,
}

function screenshotTheme(theme: unknown) {
  const t = String(theme || "default")
  if (t === "snow" || t === "topText" || t === "foolsDay") return "default"
  return t
}

export default definePlugin({
  name: "phi",
  description: "Phigros query plugin",
  async setup(app: App) {
    const resources = app.config.paths.phiResources
    const fontDir = join(resources, "html/common/font")
    await app.fonts.fromDir(fontDir)

    const catalog = new Catalog(resources).load()
    const extraNicks = await app.db.get(kvKey("nicklist"))
    if (extraNicks) {
      try {
        catalog.loadExtraNicks(JSON.parse(extraNicks) as Record<string, string[]>)
      } catch {
        /* ignore */
      }
    }
    app.service("phi.catalog", catalog)
    app.service("phi.resources", resources)
    logger.ok(`phi catalog: ${catalog.songs.size} songs`)
    try {
      const rt = await bootPhiRuntime(app)
      app.service("phi.runtime", rt)
    } catch (err) {
      logger.error(`phi runtime failed: ${err instanceof Error ? err.message : err}`)
    }

    const Version = readPhiVersion()
    const scale = app.config.render.scale || 1
    const pages = artPages(join(resources, "html"))
    const format = app.config.render.format
    const quality = app.config.render.quality
    const width = app.config.render.width
    const res = resources.replace(/\\/g, "/")

    for (const { app: kind, tpl } of pages) {
      const id = `phi/${kind}/${tpl}`
      app.template(
        defineTemplate({
          id,
          width: TEMPLATE_WIDTH[tpl] || TEMPLATE_WIDTH[kind] || width,
          format: ["b19", "update", "historyB30", "userinfo", "score"].includes(kind) ? "png" : format,
          quality,
          html: async (data, helpers) => {
            const d = data as { theme?: unknown; tips?: unknown; locale?: unknown }
            const locale = resolvePhiLocale(d.locale)
            const t = cardCopy(locale)
            const tips = String(d.tips || pickTip(catalog.tips))
            return contrastOverBackground(
              await blurCardBackgrounds(
                polishCardHtml(
                  helpers.compileArt(`${kind}/${tpl}`, {
                    isMaster: false,
                    cmdHead: "phi",
                    _plugin: "phi",
                    Version,
                    sys: {
                      scale: `style="transform:scale(${scale})"`,
                      copyright: "",
                    },
                    Math,
                    fCompute,
                    themeInfo: null,
                    _imgPath: `${res}/html/otherimg/`,
                    ...data,
                    locale,
                    lang: locale === "zh" ? "zh-cn" : "en",
                    t,
                    tips,
                    theme: screenshotTheme(d.theme),
                  }),
                  tips,
                ),
              ),
            )
          },
        }),
      )
    }
    logger.ok(`phi templates: ${pages.length} art pages (takumi)`)
  },
})
