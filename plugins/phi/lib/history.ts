import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Kv } from "../../../src/sdk/index.ts"
import { cardCopy, fill, resolvePhiLocale } from "./card-i18n.ts"
import { kvKey } from "./const.ts"
import type { Catalog } from "./catalog.ts"
import type { LineSeg } from "./charts.ts"
import type { UserNotes } from "./notes.ts"
import type { PhiRuntime } from "./runtime.ts"
import type { Save } from "./save.ts"
import { SaveHistory } from "./save-history.ts"
import { moneyText } from "./saves.ts"
import ScoreHistory from "./score-history.ts"

const LEVELS = ["EZ", "HD", "IN", "AT"] as const
const HISTORY_DAY = 10
const HISTORY_DATE = 10
const HISTORY_TOT = 50

export type HisSnap = { t: number; rks: number; phi: { id: string; rank: string }[]; b27: { id: string; rank: string }[] }

function historyKey(token: string) {
  return kvKey("history", token)
}

function hisb30Key(userId: string) {
  return kvKey("hisb30", userId)
}

type SaveHistoryCtor = typeof SaveHistory

function saveHistoryClass(_rt: PhiRuntime): SaveHistoryCtor {
  return SaveHistory
}

function scoreHistoryMod(_rt?: PhiRuntime) {
  return { default: ScoreHistory }
}

function serializeHistory(h: {
  version: number
  scoreHistory: unknown
  rks: { date: Date | string; value: number }[]
  data: { date: Date | string; value: number[] }[]
  challengeModeRank: { date: Date | string; value: number }[]
}) {
  return {
    version: h.version || 3,
    scoreHistory: h.scoreHistory || {},
    rks: (h.rks || []).map(x => ({ date: x.date, value: x.value })),
    data: (h.data || []).map(x => ({ date: x.date, value: x.value })),
    challengeModeRank: (h.challengeModeRank || []).map(x => ({ date: x.date, value: x.value })),
  }
}

function fileHistoryPath(rt: PhiRuntime, token: string) {
  return join(rt.phiRoot, "saveData", token, "history.json")
}

export async function loadSaveHistory(rt: PhiRuntime, db: Kv, token: string) {
  const Ctor = saveHistoryClass(rt)
  const raw = await db.get(historyKey(token))
  if (raw) {
    try {
      return new Ctor(JSON.parse(raw))
    } catch {
      /* fall through */
    }
  }
  const file = fileHistoryPath(rt, token)
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"))
      const hist = new Ctor(parsed)
      await db.set(historyKey(token), JSON.stringify(serializeHistory(hist)))
      return hist
    } catch {
      /* empty */
    }
  }
  return new Ctor(null)
}

async function persistSaveHistory(db: Kv, token: string, history: Parameters<typeof serializeHistory>[0]) {
  await db.set(historyKey(token), JSON.stringify(serializeHistory(history)))
}

export async function applySaveToHistory(rt: PhiRuntime, db: Kv, token: string, save: Save) {
  const history = await loadSaveHistory(rt, db, token)
  history.update(save)
  await persistSaveHistory(db, token, history)
  return history
}

export async function loadHisb30Snaps(db: Kv, userId: string): Promise<HisSnap[]> {
  const raw = await db.get(hisb30Key(userId))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as HisSnap[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function rangePct(value: number, span: number[]) {
  const a = span[0] ?? 0
  const b = span[span.length - 1] ?? a
  if (a === b) return 50
  return Math.abs(((value - a) / (b - a)) * 100)
}

function fmtLineDate(t: number) {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** Port of phi-plugin `saveHistory.getRksLine` (order preserved, same collapse rule). */
function rksLineFromRecords(items: { date: Date | string | number; value: number }[]) {
  const data = items
    .map(item => ({ date: new Date(item.date), value: Number(item.value) }))
    .filter(item => Number.isFinite(item.value) && Number.isFinite(item.date.getTime()))
  if (!data.length) return { rks_history: [] as LineSeg[], rks_range: [0, 1], rks_date: ["", ""] as [string, string] }

  const kept: { date: Date; value: number }[] = []
  const rks_range = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]
  const rks_date: [number, number] = [data[0]!.date.getTime(), 0]
  for (let i = 0; i < data.length; i++) {
    const item = data[i]!
    if (i <= 1 || item.value !== kept[kept.length - 2]?.value) {
      kept.push(item)
      rks_range[0] = Math.min(rks_range[0]!, item.value)
      rks_range[1] = Math.max(rks_range[1]!, item.value)
    } else {
      kept[kept.length - 1]!.date = item.date
    }
    rks_date[1] = item.date.getTime()
  }

  const segs: LineSeg[] = []
  for (let i = 0; i < kept.length - 1; i++) {
    const a = kept[i]!
    const b = kept[i + 1]!
    if (a.date.getTime() === b.date.getTime() && a.value === b.value) continue
    segs.push([
      rangePct(a.date.getTime(), rks_date),
      rangePct(a.value, rks_range),
      rangePct(b.date.getTime(), rks_date),
      rangePct(b.value, rks_range),
    ])
  }
  if (!segs.length) segs.push([0, 50, 100, 50])
  if (rks_range[0] === rks_range[1]) {
    rks_range[0] = rks_range[0]! - 0.01
    rks_range[1] = rks_range[1]! + 0.01
  }
  return {
    rks_history: segs,
    rks_range,
    rks_date: [fmtLineDate(rks_date[0]), fmtLineDate(rks_date[1])] as [string, string],
  }
}

function rksLineFromPoints(points: { t: number; rks: number }[]) {
  return rksLineFromRecords(points.map(p => ({ date: p.t, value: p.rks })))
}

function fixtureRksPoints() {
  const t0 = Date.now() - 86400000 * 40
  return [
    { t: t0, rks: 15.21 },
    { t: t0 + 86400000 * 7, rks: 15.44 },
    { t: t0 + 86400000 * 14, rks: 15.71 },
    { t: t0 + 86400000 * 21, rks: 15.83 },
    { t: t0 + 86400000 * 28, rks: 15.96 },
    { t: t0 + 86400000 * 35, rks: 16.0104 },
  ]
}

function rksLineLooksSparse(line: { rks_history?: LineSeg[]; rks_date?: [string, string] }) {
  const segs = line.rks_history || []
  if (segs.length < 2) return true
  if (line.rks_date?.[0] && line.rks_date[0] === line.rks_date[1]) return true
  const ys = segs.flatMap(s => [s[1], s[3]])
  return Math.max(...ys) - Math.min(...ys) < 1
}

function formatHistoryDate(rt: PhiRuntime, value: unknown) {
  try {
    return rt.fCompute.formatDate(value as string | number | Date | undefined)
  } catch {
    const d = new Date(value as string | number | Date)
    return d.toISOString().slice(0, 19).replace("T", " ")
  }
}

export async function rksLineFor(rt: PhiRuntime, history: Awaited<ReturnType<typeof loadSaveHistory>>, snaps: HisSnap[]) {
  if (history.rks?.length) return rksLineFromRecords(history.rks)
  const fromHist = history.getRksLine()
  if (fromHist.rks_history?.length) {
    return {
      rks_history: fromHist.rks_history as LineSeg[],
      rks_range: fromHist.rks_range?.[0] === fromHist.rks_range?.[1] ? [fromHist.rks_range[0]! - 0.01, fromHist.rks_range[1]! + 0.01] : fromHist.rks_range,
      rks_date: [formatHistoryDate(rt, fromHist.rks_date[0]), formatHistoryDate(rt, fromHist.rks_date[1])] as [string, string],
    }
  }
  if (snaps.length) {
    return rksLineFromRecords(snaps.map(s => ({ date: s.t, value: Number(s.rks) || 0 })))
  }
  return { rks_history: [] as LineSeg[], rks_range: [0, 1], rks_date: ["", ""] as [string, string] }
}

function comWidth(num: number) {
  return num * 135 + 20 * num - 20
}

function sanitizeUpdateSong(info: Record<string, unknown>, rt: PhiRuntime, id: string) {
  const rks = Number(info.rks_new)
  const acc = Number(info.acc_new)
  return {
    ...info,
    illustration: info.illustration || rt.getInfo.getill?.(id) || "",
    rks_new: Number.isFinite(rks) ? rks : 0,
    acc_new: Number.isFinite(acc) ? acc : 0,
    score_new: info.score_new ?? info.score ?? 0,
  }
}

function randomColor(rt: PhiRuntime) {
  try {
    return String(rt.fCompute.getRandomBgColor())
  } catch {
    const n = Math.floor(Math.random() * 0xa0a0a0)
    return `#${n.toString(16).padStart(6, "0")}`
  }
}

export async function buildUpdateCard(
  rt: PhiRuntime,
  save: Save,
  catalog: Catalog,
  history: Awaited<ReturnType<typeof loadSaveHistory>>,
  notes: UserNotes,
  snaps: HisSnap[],
  extra: { fixture?: boolean; locale?: string } = {},
) {
  const t = cardCopy(resolvePhiLocale(notes.locale, extra.locale))
  const SH = scoreHistoryMod(rt)
  const timeVis: Record<string, number> = {}
  const tot: { date: string; color: string; update_num: number; song: Record<string, unknown>[] }[] = []
  const ids = Object.keys(history.scoreHistory || {})
  for (const id of ids) {
    const tem = history.scoreHistory[id]
    if (!tem) continue
    for (const level of LEVELS) {
      const rows = tem[level]
      if (!rows?.length) continue
      for (let i = 0; i < rows.length; i++) {
        const scoreDate = formatHistoryDate(rt, SH.default.date(rows[i]!))
        const info = SH.default.extend(id, level, rows[i]!, i ? rows[i - 1] : undefined)
        if (!info.illustration) info.illustration = rt.getInfo.getill?.(id)
        if (timeVis[scoreDate] == null) {
          timeVis[scoreDate] = tot.length
          tot.push({ date: scoreDate, color: randomColor(rt), update_num: 0, song: [] })
        }
        tot[timeVis[scoreDate]!]!.update_num++
        tot[timeVis[scoreDate]!]!.song.push(sanitizeUpdateSong(info, rt, id))
      }
    }
  }
  tot.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  let show = 0
  for (let date = 0; date < tot.length; date++) {
    if (date >= HISTORY_DATE || HISTORY_TOT < show + Math.min(HISTORY_DAY, tot[date]!.update_num)) {
      tot.splice(date)
      break
    }
    tot[date]!.song.sort((a, b) => Number(b.rks_new || 0) - Number(a.rks_new || 0))
    tot[date]!.song = tot[date]!.song.slice(0, Math.min(HISTORY_DAY, HISTORY_TOT - show))
    show += tot[date]!.song.length
  }

  const box_line: { date?: string; color: string; song: Record<string, unknown>[]; width: number; update_num?: number }[][] = []
  let lineNum = 5
  let flag = false
  const remaining = tot.map(x => ({ ...x, song: [...x.song] }))
  while (remaining.length) {
    if (lineNum === 5) {
      const take = remaining[0]!.song.splice(0, 5)
      box_line.push([flag ? { color: remaining[0]!.color, song: take, width: 0 } : { date: remaining[0]!.date, color: remaining[0]!.color, song: take, width: 0 }])
      const last = box_line[box_line.length - 1]!
      lineNum = last[last.length - 1]!.song.length
    } else {
      const last = box_line[box_line.length - 1]!
      const take = remaining[0]!.song.splice(0, 5 - lineNum)
      last.push(flag ? { color: remaining[0]!.color, song: take, width: 0 } : { date: remaining[0]!.date, color: remaining[0]!.color, song: take, width: 0 })
      lineNum += last[last.length - 1]!.song.length
    }
    const last = box_line[box_line.length - 1]!
    last[last.length - 1]!.width = comWidth(last[last.length - 1]!.song.length)
    flag = true
    if (!remaining[0]!.song.length) {
      last[last.length - 1]!.update_num = remaining[0]!.update_num
      remaining.shift()
      flag = false
    }
  }

  let line = await rksLineFor(rt, history, snaps)
  if (extra.fixture && rksLineLooksSparse(line)) line = rksLineFromPoints(fixtureRksPoints())

  const added: [string, string] = ["", ""]
  if (snaps.length >= 2) {
    const prev = snaps[snaps.length - 2]!
    const cur = snaps[snaps.length - 1]!
    const d = Number(cur.rks) - Number(prev.rks)
    if (Math.abs(d) >= 1e-4) added[0] = `${d > 0 ? "+" : ""}${d.toFixed(4)}`
  }

  const task_data = (notes.task || []).map(t => {
    const info = rt.getInfo.info?.(t.song, true)
    return {
      ...t,
      illustration: rt.getInfo.getill?.(t.song) || catalog.getill?.(t.song),
      song: info?.song || t.song,
      request: {
        ...t.request,
        value: t.request?.type === "acc" ? `${Number(t.request.value).toFixed(2)}%` : String(t.request?.value ?? "").padStart(6, "0"),
      },
    }
  })

  return {
    PlayerId: rt.fCompute.convertRichText(save.saveInfo.PlayerId),
    Rks: Number(save.saveInfo.summary.rankingScore).toFixed(4),
    Date: formatHistoryDate(rt, save.saveInfo.summary.updatedAt),
    ChallengeMode: Math.floor(save.saveInfo.summary.challengeModeRank / 100),
    ChallengeModeRank: save.saveInfo.summary.challengeModeRank % 100,
    background: catalog.randomIll("blur"),
    box_line,
    show,
    tips: (rt.getInfo.tips || [])[Math.floor(Math.random() * Math.max(1, (rt.getInfo.tips || []).length))] || "",
    task_data: task_data.length ? task_data : null,
    task_time: notes.task_time ? formatHistoryDate(rt, notes.task_time) : "",
    added_rks_notes: added,
    update_ans: show ? fill(t.updatedScores, { n: show }) : t.noNewScores,
    theme: notes.theme || "default",
    rks_date: line.rks_date,
    rks_history: line.rks_history,
    rks_range: [
      Number.isFinite(Number(line.rks_range?.[0])) ? Number(line.rks_range[0]) : 0,
      Number.isFinite(Number(line.rks_range?.[1])) ? Number(line.rks_range[1]) : 1,
    ],
  }
}

export async function buildHisb30Rows(
  rt: PhiRuntime,
  history: Awaited<ReturnType<typeof loadSaveHistory>>,
  snaps: HisSnap[],
) {
  const fromHist = await hisb30FromScoreHistory(rt, history)
  if (fromHist.length) return fromHist
  return hisb30FromSnaps(rt, snaps)
}

async function hisb30FromScoreHistory(rt: PhiRuntime, history: Awaited<ReturnType<typeof loadSaveHistory>>) {
  const SH = scoreHistoryMod(rt)
  const records: { id: string; level: string; acc: number; score: number; date: Date; fc: boolean; rks: number; rank: string }[] = []
  for (const id of Object.keys(history.scoreHistory || {})) {
    const songRecords = history.scoreHistory[id]
    if (!songRecords) continue
    for (const level of LEVELS) {
      const rows = songRecords[level]
      if (!rows) continue
      const info = rt.getInfo.info(id, true)
      const dif = info?.chart?.[level]?.difficulty
      if (dif == null) continue
      for (const row of rows) {
        const opened = SH.default.open(row)
        records.push({
          id,
          level,
          rank: level,
          acc: opened.acc,
          score: opened.score,
          date: opened.date,
          fc: opened.fc,
          rks: rt.fCompute.rks(opened.acc, dif),
        })
      }
    }
  }
  if (records.length < 2) return []
  const byTime: Record<string, typeof records> = {}
  for (const rec of records) {
    const k = `${rec.date.getTime()}`
    const bucket = byTime[k] ?? []
    byTime[k] = bucket
    bucket.push(rec)
  }
  const times = Object.keys(byTime).sort((a, b) => Number(a) - Number(b))
  let b30 = { phi: [] as typeof records, b27: [] as typeof records }
  const rows: { date: string; color: string; songs: Record<string, unknown>[] }[] = []
  for (const time of times) {
    const batch = byTime[time]!
    const newB30 = rt.fCompute.updateB30(b30, batch) as { phi: typeof records; b27: typeof records }
    const oldPhi = new Set(b30.phi.map(x => `${x.id}-${x.rank}`))
    const oldB27 = new Set(b30.b27.map(x => `${x.id}-${x.rank}`))
    const newPhi = new Set(newB30.phi.map(x => `${x.id}-${x.rank}`))
    const newB27 = new Set(newB30.b27.map(x => `${x.id}-${x.rank}`))
    const songs: Record<string, unknown>[] = []
    newB30.phi.forEach((item, index) => {
      const key = `${item.id}-${item.rank}`
      if (!oldPhi.has(key)) songs.push({ ill: rt.getInfo.getill(item.id, "low"), rank: item.rank, newPhi: index + 1 })
    })
    newB30.b27.forEach((item, index) => {
      const key = `${item.id}-${item.rank}`
      if (!oldB27.has(key)) songs.push({ ill: rt.getInfo.getill(item.id, "low"), rank: item.rank, newB27: index + 1 })
    })
    b30.phi.forEach(item => {
      const key = `${item.id}-${item.rank}`
      if (!newPhi.has(key)) songs.push({ ill: rt.getInfo.getill(item.id, "low"), rank: item.rank, exitPhi: true })
    })
    b30.b27.forEach(item => {
      const key = `${item.id}-${item.rank}`
      if (!newB27.has(key)) songs.push({ ill: rt.getInfo.getill(item.id, "low"), rank: item.rank, exitB27: true })
    })
    if (songs.length) {
      rows.push({
        date: formatHistoryDate(rt, Number(time)),
        songs,
        color: randomColor(rt),
      })
    }
    b30 = newB30
  }
  return rows.reverse().slice(0, 12)
}

function hisb30FromSnaps(rt: PhiRuntime, snaps: HisSnap[]) {
  const rows: { date: string; color: string; songs: Record<string, unknown>[] }[] = []
  for (let i = 1; i < snaps.length; i++) {
    const prev = snaps[i - 1]!
    const cur = snaps[i]!
    const oldPhi = new Set((prev.phi || []).map(x => `${x.id}-${x.rank}`))
    const oldB27 = new Set((prev.b27 || []).map(x => `${x.id}-${x.rank}`))
    const newPhi = new Set((cur.phi || []).map(x => `${x.id}-${x.rank}`))
    const newB27 = new Set((cur.b27 || []).map(x => `${x.id}-${x.rank}`))
    const songs: Record<string, unknown>[] = []
    ;(cur.phi || []).forEach((item, index) => {
      const key = `${item.id}-${item.rank}`
      if (!oldPhi.has(key)) songs.push({ ill: rt.getInfo.getill(item.id, "low"), rank: item.rank, newPhi: index + 1 })
    })
    ;(cur.b27 || []).forEach((item, index) => {
      const key = `${item.id}-${item.rank}`
      if (!oldB27.has(key)) songs.push({ ill: rt.getInfo.getill(item.id, "low"), rank: item.rank, newB27: index + 1 })
    })
    ;(prev.phi || []).forEach(item => {
      const key = `${item.id}-${item.rank}`
      if (!newPhi.has(key)) songs.push({ ill: rt.getInfo.getill(item.id, "low"), rank: item.rank, exitPhi: true })
    })
    ;(prev.b27 || []).forEach(item => {
      const key = `${item.id}-${item.rank}`
      if (!newB27.has(key)) songs.push({ ill: rt.getInfo.getill(item.id, "low"), rank: item.rank, exitB27: true })
    })
    if (songs.length) {
      rows.push({
        date: formatHistoryDate(rt, cur.t),
        songs,
        color: randomColor(rt),
      })
    }
  }
  return rows.slice(-12).reverse()
}

export async function songScoreHistory(rt: PhiRuntime, history: Awaited<ReturnType<typeof loadSaveHistory>>, songId: string) {
  const SH = scoreHistoryMod(rt)
  const rec = history.scoreHistory?.[songId]
  if (!rec) return []
  const out: Record<string, unknown>[] = []
  for (const level of LEVELS) {
    const rows = rec[level]
    if (!rows) continue
    for (let i = 0; i < rows.length; i++) {
      const tem = SH.default.extend(songId, level, rows[i]!, i ? rows[i - 1] : undefined)
      out.push({ ...tem, date_new: formatHistoryDate(rt, tem.date_new) })
    }
  }
  out.sort((a, b) => new Date(String(b.date_new)).getTime() - new Date(String(a.date_new)).getTime())
  return out.slice(0, 16)
}

export function accRksLines(save: Save) {
  const acc_rksRecord = [...(save.getRecord?.() || [])]
  const phi = acc_rksRecord.filter((r: { acc: number }) => r.acc === 100).slice(0, 3)
  let phi_rks = 0
  for (const r of phi) phi_rks += r.rks || 0
  const acc_rks_data: [number, number][] = []
  let acc_rks_range = [100, 0]
  const acc_rks_AccRange = [100]
  for (let i = 0; i < Math.min(acc_rksRecord.length, 27); i++) {
    acc_rks_AccRange[0] = Math.min(acc_rks_AccRange[0]!, acc_rksRecord[i]?.acc ?? 0)
  }
  const rec = [...acc_rksRecord]
  const startAcc = Number(acc_rks_AccRange[0])
  const from = Number.isFinite(startAcc) ? Math.max(0, Math.min(100, startAcc)) : 100
  for (let i = from; i <= 100; i += 0.5) {
    let sum = 0
    if (!rec[0]) break
    for (let j = 0; j < rec.length && j < 27; j++) {
      if ((rec[j]?.acc ?? 0) < i) acc_rks_AccRange.push(i)
      while (j < rec.length && (rec[j]?.acc ?? 0) < i) rec.splice(j, 1)
      if (rec[j]) sum += rec[j]?.rks ?? 0
      else break
    }
    const tem = (sum + phi_rks) / 30
    acc_rks_data.push([i, tem])
    acc_rks_range[0] = Math.min(acc_rks_range[0]!, tem)
    acc_rks_range[1] = Math.max(acc_rks_range[1]!, tem)
  }
  if (acc_rks_AccRange[acc_rks_AccRange.length - 1]! < 100) acc_rks_AccRange.push(100)
  const segs: LineSeg[] = []
  for (let i = 1; i < acc_rks_data.length; i++) {
    const prev = acc_rks_data[i - 1]!
    const cur = acc_rks_data[i]!
    if (segs.length && prev[1] === cur[1]) {
      segs[segs.length - 1]![2] = rangePct(cur[0], acc_rks_AccRange)
    } else {
      segs.push([rangePct(prev[0], acc_rks_AccRange), rangePct(prev[1], acc_rks_range), rangePct(cur[0], acc_rks_AccRange), rangePct(cur[1], acc_rks_range)])
    }
  }
  if (acc_rks_AccRange[0] === 100) acc_rks_AccRange[0] = 0
  const acc_length = 100 - (acc_rks_AccRange[0] || 0)
  const min_acc = acc_rks_AccRange[0] || 0
  while (acc_rks_AccRange.length > 2 && 100 - acc_rks_AccRange[acc_rks_AccRange.length - 2]! < acc_length / 10) {
    acc_rks_AccRange.splice(acc_rks_AccRange.length - 2, 1)
  }
  const positions: [number, number][] = [[acc_rks_AccRange[0] || 0, 0]]
  for (let i = 1; i < acc_rks_AccRange.length; i++) {
    while (i < acc_rks_AccRange.length && acc_rks_AccRange[i]! - acc_rks_AccRange[i - 1]! < acc_length / 10) {
      acc_rks_AccRange.splice(i, 1)
    }
    if (i >= acc_rks_AccRange.length) break
    positions.push([acc_rks_AccRange[i]!, ((acc_rks_AccRange[i]! - min_acc) / acc_length) * 100])
  }
  if (acc_rks_range[0] === 100 && acc_rks_range[1] === 0) acc_rks_range = [0, 1]
  return { acc_rks_data: segs, acc_rks_range, acc_rks_AccRange: positions }
}

export function playerBlock(rt: PhiRuntime, save: Save) {
  const money = save.gameProgress?.money || [0, 0, 0, 0, 0]
  return {
    avatar: rt.getInfo.idgetavatar(save.gameuser.avatar),
    ChallengeMode: Math.floor(save.saveInfo.summary.challengeModeRank / 100),
    ChallengeModeRank: save.saveInfo.summary.challengeModeRank % 100,
    rks: save.saveInfo.summary.rankingScore,
    data: moneyText(money),
    selfIntro: rt.fCompute.convertRichText(save.gameuser.selfIntro),
    PlayerId: rt.fCompute.convertRichText(save.saveInfo.PlayerId),
  }
}
