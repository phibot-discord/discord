/** Template helpers used inside phi `.art` files (`fCompute.*`). */
import { jaroWinklerDistance } from "./jaro.ts"

let backgroundOf = (_name: string): string => ""

export function bindBackground(fn: (name: string) => string) {
  backgroundOf = fn
}

export const fCompute = {
  rks(acc: number, difficulty: number) {
    if (acc === 100) return Number(difficulty)
    if (acc < 70) return 0
    return difficulty * (((acc - 55) / 45) * ((acc - 55) / 45))
  },
  rate(realScore: number, fc: boolean | number, totScore = 1_000_000) {
    if (realScore === totScore) return "phi"
    if (fc) return "FC"
    if (realScore >= totScore * 0.96) return "V"
    if (realScore >= totScore * 0.92) return "S"
    if (realScore >= totScore * 0.88) return "A"
    if (realScore >= totScore * 0.82) return "B"
    if (realScore >= totScore * 0.7) return "C"
    if (realScore > 0) return "F"
    return "NEW"
  },
  comJust1Good(score: number, maxc: number) {
    const tar = 900000 * (1 - 0.35 / maxc) + 100000
    return Math.abs(score - tar) <= 2
  },
  objectKeys<T extends Record<PropertyKey, unknown>>(record: T): (keyof T)[] {
    return Object.keys(record) as (keyof T)[]
  },
  randArray<T>(arr: T[]): T[] {
    return [...arr].sort(() => Math.random() - 0.5)
  },
  range(value: number, span: number[]) {
    const a = span[0] ?? 0
    const b = span[span.length - 1] ?? a
    if (a === b) return 50
    return Math.abs(((value - a) / (b - a)) * 100)
  },
  toHex(num: number) {
    return num < 16 ? `0${num.toString(16)}` : num.toString(16)
  },
  getRandomBgColor() {
    const red = Math.floor(Math.random() * 201)
    const green = Math.floor(Math.random() * 201)
    const blue = Math.floor(Math.random() * 201)
    return `#${fCompute.toHex(red)}${fCompute.toHex(green)}${fCompute.toHex(blue)}`
  },
  getBackground(saveBackground: string) {
    return backgroundOf(saveBackground)
  },
  fuzzySearch(str: string, data: Record<string, string[]>) {
    const result: { key: string; score: number; value: string }[] = []
    for (const [key, values] of Object.entries(data || {})) {
      const score = jaroWinklerDistance(str, key)
      if (score > 0.8) for (const value of values || []) result.push({ key, score, value })
    }
    return result.sort((a, b) => b.score - a.score)
  },
  updateB30<T extends { rks: number; acc: number; id: string; difficulty?: number }>(
    b30List: { phi: T[]; b27: T[] },
    incoming: T[],
  ) {
    let phi = [...b30List.phi]
    let b27 = [...b30List.b27]
    const newRecords = [...incoming].sort((a, b) => b.rks - a.rks)
    const newPhis = newRecords.filter(record => record.acc >= 100)
    const newPhiKeys = newPhis.map(item => `${item.id}-${item.difficulty}`)
    const newRecordKeys = newRecords.map(item => `${item.id}-${item.difficulty}`)
    phi = phi.filter(item => !newPhiKeys.includes(`${item.id}-${item.difficulty}`))
    b27 = b27.filter(item => !newRecordKeys.includes(`${item.id}-${item.difficulty}`))
    phi.push(...newPhis)
    phi = phi.sort((a, b) => b.rks - a.rks).slice(0, 3)
    b27.push(...newRecords)
    b27 = b27.sort((a, b) => b.rks - a.rks).slice(0, 27)
    return { phi, b27 }
  },
  convertRichText(richText?: string, onlyText = false) {
    if (!richText) return richText
    let out = richText.replace(/</g, "&lt;").replace(/>/g, "&gt;")
    const colorRe = /&lt;color\s*=\s*.*?&gt;(.*?)&lt;\/color&gt;/
    const italicRe = /&lt;i&gt;(.*?)&lt;\/i&gt;/
    const boldRe = /&lt;b&gt;(.*?)&lt;\/b&gt;/
    for (;;) {
      let matched = out.match(colorRe)
      if (matched?.[1]) {
        const color = matched[0].match(/&lt;color\s*=\s*(.*?)&gt;/)?.[1]?.replace(/[\s"]/g, "") || "inherit"
        out = out.replace(colorRe, onlyText ? matched[1] : `<span style="color:${color}">${matched[1]}</span>`)
        continue
      }
      matched = out.match(italicRe)
      if (matched) {
        out = out.replace(italicRe, onlyText ? matched[1]! : `<i>${matched[1]}</i>`)
        continue
      }
      matched = out.match(boldRe)
      if (matched) {
        out = out.replace(boldRe, onlyText ? matched[1]! : `<b>${matched[1]}</b>`)
        continue
      }
      break
    }
    return out.replace(/\n\r?/g, "<br>")
  },
  suggest(rks: number, difficulty: number, count?: number) {
    const ans = 45 * Math.sqrt(rks / difficulty) + 55
    if (ans >= 100) return count !== undefined ? "无法推分" : -1
    return count !== undefined ? `${ans.toFixed(count)}%` : ans
  },
  getValueFromRange(percent: number, range: [number, number]) {
    if (range[0] === range[1]) return range[0]
    return Math.round(((range[1] - range[0]) * percent) / 100 + range[0])
  },
  ped(num: number, cover: number) {
    return num.toString().padStart(cover, "0")
  },
  std_score(score: number) {
    const s1 = Math.floor(score / 1e6)
    const s2 = Math.floor(score / 1e3) % 1e3
    const s3 = score % 1e3
    return `${s1}'${fCompute.ped(s2, 3)}'${fCompute.ped(s3, 3)}`
  },
  formatDate(date?: Date | string | number, formater = "YYYY/MM/DD hh:mm:ss") {
    const d = date ? new Date(date) : new Date()
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(d)
        .map(p => [p.type, p.value]),
    )
    return formater
      .replace("YYYY", parts.year ?? "")
      .replace("MM", parts.month ?? "")
      .replace("DD", parts.day ?? "")
      .replace("hh", parts.hour ?? "")
      .replace("mm", parts.minute ?? "")
      .replace("ss", parts.second ?? "")
  },
  rgbaToGradient(rgba?: string) {
    if (!rgba) return undefined
    const parts = rgba.split(",")
    if (parts.length < 3) return undefined
    const r = parts[0]!.trim()
    const g = parts[1]!.trim()
    const b = parts[2]!.trim()
    return `linear-gradient(90deg, rgb(${r},${g},${b}) 95px, transparent 95px, rgba(${r},${g},${b},0.53) 105px, rgba(${r},${g},${b},0.53) 50%, transparent 100%)`
  },
}
