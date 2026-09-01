import { ALL_LEVEL, MAX_DIFFICULTY } from "./const.ts"
import { fCompute } from "./fcompute.ts"
import type { LevelRecordInfo } from "./level-record.ts"
import type { Save } from "./save.ts"

type ScoreDetail = [string | number, number, string | Date, boolean]
type Dated<T> = { date: Date; value: T }
type DatedRaw<T> = { date: string | Date; value: T }
type SaveHistoryRaw = {
  scoreHistory?: Record<string, Partial<Record<string, ScoreDetail[]>>>
  data?: DatedRaw<number[]>[]
  rks?: DatedRaw<number>[]
  challengeModeRank?: DatedRaw<number>[]
  version?: number
}

function createHistory(acc: number, score: number, date: Date, fc: boolean): ScoreDetail {
  return [acc.toFixed(4), score, date.toISOString(), fc]
}

function openHistory(data: ScoreDetail) {
  return {
    acc: Number(data[0]),
    score: Number(data[1]),
    date: new Date(data[2]),
    fc: Boolean(data[3]),
  }
}

function checkValue(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a)) return Object.is(a, b)
  if (!a || !b) return false
  const bb = b as unknown[]
  for (const i in a) if (!Object.is(a[i], bb[i as unknown as number])) return false
  return true
}

function merge<T>(m: Dated<T>[], n: Dated<T>[]) {
  const t = m.concat(n).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  let i = 1
  while (i < t.length - 1) {
    if (checkValue(t[i]!.value, t[i - 1]!.value) && checkValue(t[i]!.value, t[i + 1]!.value)) t.splice(i, 1)
    else ++i
  }
  return t
}

export class SaveHistory {
  version: number
  scoreHistory: Record<string, Partial<Record<string, ScoreDetail[]>>>
  data: Dated<number[]>[]
  rks: Dated<number>[]
  challengeModeRank: Dated<number>[]

  constructor(raw: SaveHistoryRaw | null | undefined) {
    const data = raw || {}
    const ids = Object.keys(data.scoreHistory || {})
    for (const id of ids) {
      const record = data.scoreHistory?.[id]
      if (!record) continue
      for (const level of ALL_LEVEL) {
        if (!record[level]) continue
        for (const item of record[level]) item[2] = new Date(item[2])
      }
    }
    this.scoreHistory = data.scoreHistory || {}
    this.data = (data.data || []).map(item => ({ date: new Date(item.date), value: item.value }))
    this.rks = (data.rks || []).map(item => ({ date: new Date(item.date), value: item.value }))
    this.challengeModeRank = (data.challengeModeRank || []).map(item => ({
      date: new Date(item.date),
      value: item.value,
    }))
    this.version = data.version ?? 0
    if (!this.version || this.version < 2) {
      if (this.scoreHistory) {
        for (const i in this.scoreHistory) {
          if (!i.includes(".0")) this.scoreHistory = {}
          break
        }
      }
      this.version = 2
    }
    if (this.version < 3) {
      this.challengeModeRank = []
      this.version = 3
    }
  }

  add(other: SaveHistory) {
    this.data = merge(this.data, other.data)
    this.rks = merge(this.rks, other.rks)
    this.challengeModeRank = merge(this.challengeModeRank, other.challengeModeRank)
    for (const id of Object.keys(other.scoreHistory || {})) {
      this.scoreHistory[id] ||= {}
      for (const dif of ALL_LEVEL) {
        if (this.scoreHistory[id]![dif]) {
          if (other.scoreHistory[id]?.[dif]) {
            this.scoreHistory[id]![dif] = [...this.scoreHistory[id]![dif]!, ...other.scoreHistory[id]![dif]!]
            this.scoreHistory[id]![dif]!.sort((a, b) => openHistory(a).date.getTime() - openHistory(b).date.getTime())
          }
        } else {
          this.scoreHistory[id]![dif] = other.scoreHistory[id]?.[dif]
        }
        if (!this.scoreHistory[id]![dif]) continue
        let i = 1
        while (i < this.scoreHistory[id]![dif]!.length) {
          const last = openHistory(this.scoreHistory[id]![dif]![i - 1]!)
          const now = openHistory(this.scoreHistory[id]![dif]![i]!)
          if (last.score === now.score && last.acc === now.acc && last.fc === now.fc) {
            this.scoreHistory[id]![dif]!.splice(i, 1)
          } else ++i
        }
      }
    }
  }

  update(save: Save) {
    const ids = Object.keys(save.gameRecord || {})
    for (const id of ids) {
      this.scoreHistory[id] ||= {}
      for (const i in save.gameRecord[id]) {
        const level = ALL_LEVEL[Number(i)]!
        let now = save.gameRecord[id]![Number(i)] as (LevelRecordInfo & { date?: Date }) | null
        if (!now) continue
        now.date = save.saveInfo.modifiedAt.iso
        if (!this.scoreHistory[id]![level]?.length) {
          this.scoreHistory[id]![level] = [createHistory(now.acc, now.score, save.saveInfo.modifiedAt.iso, now.fc)]
          continue
        }
        for (let idx = this.scoreHistory[id]![level]!.length - 1; idx >= 0; --idx) {
          const old = openHistory(this.scoreHistory[id]![level]![idx]!)
          if (old.score === now.score && old.acc === now.acc && old.fc === now.fc) {
            now = null
            break
          }
          if (old.date < new Date(now.date ?? save.saveInfo.modifiedAt.iso)) {
            if (old.acc !== Number(now.acc.toFixed(4)) || old.score !== now.score || old.fc !== now.fc) {
              this.scoreHistory[id]![level]!.splice(idx, 0, createHistory(now.acc, now.score, save.saveInfo.modifiedAt.iso, now.fc))
            }
            now = null
            break
          }
        }
        if (now) {
          this.scoreHistory[id]![level]!.unshift(createHistory(now.acc, now.score, save.saveInfo.modifiedAt.iso, now.fc))
        }
        let j = 1
        while (j < this.scoreHistory[id]![level]!.length) {
          const last = openHistory(this.scoreHistory[id]![level]![j - 1]!)
          const cur = openHistory(this.scoreHistory[id]![level]![j]!)
          if (last.score === cur.score && last.acc === cur.acc && last.fc === cur.fc) this.scoreHistory[id]![level]!.splice(j, 1)
          else ++j
        }
      }
    }
    const iso = save.saveInfo.modifiedAt.iso
    for (let i = this.rks.length - 1; i >= 0; i--) {
      if (iso > new Date(this.rks[i]!.date)) {
        if (!this.rks[i + 1] || this.rks[i]!.value !== save.saveInfo.summary.rankingScore || this.rks[i + 1]?.value !== save.saveInfo.summary.rankingScore) {
          this.rks.splice(i + 1, 0, { date: iso, value: save.saveInfo.summary.rankingScore })
        }
        break
      }
    }
    if (!this.rks.length) this.rks.push({ date: iso, value: save.saveInfo.summary.rankingScore })
    for (let i = this.data.length - 1; i >= 0; i--) {
      if (iso > new Date(this.data[i]!.date)) {
        if (!this.data[i + 1] || (checkValue(this.data[i]!.value, save.gameProgress.money) && checkValue(this.data[i + 1]?.value, save.gameProgress.money))) {
          this.data.splice(i + 1, 0, { date: iso, value: save.gameProgress.money })
        }
        break
      }
    }
    if (!this.data.length) this.data.push({ date: iso, value: save.gameProgress.money })
    const clg = save.saveInfo.summary.challengeModeRank
    for (let i = this.challengeModeRank.length - 1; i >= 0; i--) {
      if (iso > new Date(this.challengeModeRank[i]!.date)) {
        if (clg !== this.challengeModeRank[i]!.value && this.challengeModeRank[i + 1]?.value !== clg) {
          this.challengeModeRank.splice(i + 1, 0, { date: iso, value: clg })
        }
        break
      }
    }
    if (!this.challengeModeRank.length) this.challengeModeRank.push({ date: iso, value: clg })
  }

  getRksLine() {
    const rks_history_: Dated<number>[] = []
    const user_rks_data = this.rks
    const rks_range = [MAX_DIFFICULTY, 0]
    const rks_date: [number, number] = [0, 0]
    const rks_history: number[][] = []
    if (user_rks_data.length) {
      rks_date[0] = new Date(user_rks_data[0]!.date).getTime()
      user_rks_data.forEach((item, i) => {
        item.date = new Date(item.date)
        if (i <= 1 || item.value !== rks_history_[rks_history_.length - 2]!.value) {
          rks_history_.push(item)
          rks_range[0] = Math.min(rks_range[0]!, item.value)
          rks_range[1] = Math.max(rks_range[1]!, item.value)
        } else {
          rks_history_[rks_history_.length - 1]!.date = item.date
        }
        rks_date[1] = item.date.getTime()
      })
      rks_history_.forEach((item, i) => {
        if (!rks_history_[i + 1]) return
        rks_history.push([
          fCompute.range(item.date.getTime(), rks_date),
          fCompute.range(item.value, rks_range),
          fCompute.range(rks_history_[i + 1]!.date.getTime(), rks_date),
          fCompute.range(rks_history_[i + 1]!.value, rks_range),
        ])
      })
      if (!rks_history.length) rks_history.push([0, 50, 100, 50])
    }
    return { rks_history, rks_range, rks_date }
  }

  getDataLine() {
    const data_history_: Dated<number>[] = []
    const user_data_data = this.data
    const data_range_num = [1e16, 0]
    const data_date: number[] = []
    const data_history: number[][] = []
    if (user_data_data.length) {
      data_date[0] = new Date(user_data_data[0]!.date).getTime()
      user_data_data.forEach((item, i) => {
        const value = item.value
        const totValue = (((value[4]! * 1024 + value[3]!) * 1024 + value[2]!) * 1024 + value[1]!) * 1024 + value[0]!
        item.date = new Date(item.date)
        const temObj = { date: item.date, value: totValue }
        if (i <= 1 || temObj.value !== data_history_[data_history_.length - 2]!.value) {
          data_history_.push(temObj)
          data_range_num[0] = Math.min(data_range_num[0]!, totValue)
          data_range_num[1] = Math.max(data_range_num[1]!, totValue)
        } else {
          data_history_[data_history_.length - 1]!.date = item.date
        }
        data_date[1] = item.date.getTime()
      })
      data_history_.forEach((item, i) => {
        if (!data_history_[i + 1]) return
        data_history.push([
          fCompute.range(item.date.getTime(), data_date),
          fCompute.range(item.value, data_range_num),
          fCompute.range(data_history_[i + 1]!.date.getTime(), data_date),
          fCompute.range(data_history_[i + 1]!.value, data_range_num),
        ])
      })
      if (!data_history.length) data_history.push([0, 50, 100, 50])
    }
    return { data_history, data_range: data_range_num, data_date }
  }

  getRksAndDataLine() {
    return { ...this.getRksLine(), ...this.getDataLine() }
  }
}
