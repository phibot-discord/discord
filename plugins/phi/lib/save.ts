import { logger } from "../../../src/logger.ts"
import { MAX_DIFFICULTY } from "./const.ts"
import { fCompute } from "./fcompute.ts"
import { getInfo } from "./get-info.ts"
import { LevelRecordInfo } from "./level-record.ts"
import { getRksRank } from "./rks-rank.ts"

type Limit =
  | { type: "acc" | "score" | "rks"; value: number[] }
  | { type: "custom"; value: (record: LevelRecordInfo) => boolean }

function checkLimit(record: LevelRecordInfo, limit: Limit[]) {
  for (const l of limit) {
    switch (l.type) {
      case "acc":
        if (record.acc < l.value[0]! || record.acc > l.value[1]!) return false
        break
      case "score":
        if (record.score < l.value[0]! || record.score > l.value[1]!) return false
        break
      case "rks":
        if (record.rks < l.value[0]! || record.rks > l.value[1]!) return false
        break
      case "custom":
        if (!l.value(record)) return false
        break
    }
  }
  return true
}

function checkIg(save: Save) {
  const rks = save.saveInfo?.summary?.rankingScore
  const clg = save.saveInfo?.summary?.challengeModeRank
  if (rks > MAX_DIFFICULTY) return true
  if (rks == null || Number.isNaN(rks)) return true
  if (clg % 100 > 51) return true
  if (clg < 0) return true
  if (clg % 100 === 0 && clg !== 0) return true
  if (Math.floor(clg / 100) === 0 && clg !== 0) return true
  if (clg % 1 !== 0) return true
  return false
}

export type SaveInfo = {
  PlayerId: string
  modifiedAt: { iso: Date }
  summary: {
    rankingScore: number
    challengeModeRank: number
    updatedAt: string | Date
    saveVersion?: number
    avatar?: string | number
  }
  gameFile?: { url?: string }
}

export type SaveGameUser = {
  name: string
  version: string | number
  showPlayerId: boolean
  selfIntro: string
  avatar: string
  background: string
}

export type SaveGameProgress = {
  money: number[]
} & Record<string, unknown>

export type SavePayload = {
  session: string
  global?: boolean
  apiId?: unknown
  playerInfo?: unknown
  saveInfo: SaveInfo
  Recordver?: unknown
  gameProgress?: Partial<SaveGameProgress>
  gameuser?: Partial<SaveGameUser>
  gameRecord?: Record<string, Array<{ fc?: boolean | number; score?: number; acc?: number } | null | undefined>>
}

export class Save {
  session: string
  global?: boolean
  apiId?: unknown
  playerInfo: unknown
  saveInfo: SaveInfo
  Recordver: unknown
  gameProgress: SaveGameProgress
  gameuser: SaveGameUser
  gameRecord: Record<string, (LevelRecordInfo | null)[]> = {}
  sortedRecord?: LevelRecordInfo[]
  B19List?: { phi: (LevelRecordInfo | undefined)[]; b19_list: LevelRecordInfo[] }
  b19_rks?: number
  b0_rks?: number

  constructor(data: SavePayload, ignore = false) {
    this.session = data.session
    this.global = data.global
    this.apiId = data.apiId
    this.playerInfo = data.playerInfo
    this.saveInfo = data.saveInfo
    if (this.saveInfo?.modifiedAt) {
      this.saveInfo.modifiedAt.iso = new Date(this.saveInfo.modifiedAt.iso)
    }
    this.Recordver = data.Recordver
    this.gameProgress = data.gameProgress
      ? { money: [0, 0, 0, 0, 0], ...data.gameProgress }
      : { money: [0, 0, 0, 0, 0] }
    this.gameuser = {
      name: data.gameuser?.name || "",
      version: data.gameuser?.version || "",
      showPlayerId: data.gameuser?.showPlayerId || false,
      selfIntro: data.gameuser?.selfIntro || "",
      avatar: data.gameuser?.avatar || "",
      background: data.gameuser?.background || "",
    }
    if (checkIg(this)) {
      void getRksRank?.delUserRks(this.session)
      logger.error(`banned tk ${this.session}`)
      throw new Error(`您的存档rks异常，该 token 已禁用，如有异议请联系机器人管理员。\n${this.session}`)
    }
    const idList = Object.keys(data.gameRecord || {})
    for (const id of idList) {
      const rows = data.gameRecord?.[id] || []
      this.gameRecord[id] = []
      for (const i in rows) {
        const level = Number(i)
        const rec = rows[level]
        if (!rec) {
          this.gameRecord[id]![level] = null
          continue
        }
        if (!ignore) {
          if ((rec.acc ?? 0) > 100 || (rec.acc ?? 0) < 0) {
            if (id === "Starduster.Quree.0" && level === 0 && (rec.acc ?? 0) <= 102.57 && (rec.acc ?? 0) >= 0) continue
            void getRksRank?.delUserRks(this.session)
            throw new Error(`您的存档 acc 异常，该 token 已禁用，如有异议请联系机器人管理员。\n${this.session}\n${id} ${level} ${rec.acc}`)
          }
          if ((rec.score ?? 0) > 1_000_000 || (rec.score ?? 0) < 0) {
            void getRksRank?.delUserRks(this.session)
            throw new Error(`您的存档 score 异常，该 token 已禁用，如有异议请联系机器人管理员。\n${this.session}\n${id} ${level} ${rec.score}`)
          }
        }
        this.gameRecord[id]![level] = new LevelRecordInfo(rec, id, level)
      }
    }
  }

  async init() {}

  getRecord() {
    if (this.sortedRecord) return this.sortedRecord
    const sortedRecord: LevelRecordInfo[] = []
    for (const id of Object.keys(this.gameRecord)) {
      this.gameRecord[id]!.forEach((recording, level) => {
        if (level === 4) return
        if (!recording?.score) return
        sortedRecord.push(recording)
      })
    }
    sortedRecord.sort((a, b) => b.rks - a.rks)
    this.sortedRecord = sortedRecord
    return sortedRecord
  }

  findAccRecord(acc: number, same = false) {
    const record: LevelRecordInfo[] = []
    for (const id of Object.keys(this.gameRecord)) {
      for (const level of [0, 1, 2, 3]) {
        const tem = this.gameRecord[id]?.[level]
        if (!tem) continue
        if (tem.acc >= acc) record.push(tem)
      }
    }
    record.sort((a, b) => b.rks - a.rks)
    if (same) {
      for (let i = 0; i < record.length - 1; i++) {
        if (record[i]!.rks !== record[i + 1]?.rks) return record.slice(0, i + 1)
      }
    }
    return record
  }

  minUpRks() {
    const minuprks = Math.floor(this.saveInfo.summary.rankingScore * 100) / 100 + 0.005 - this.saveInfo.summary.rankingScore
    return minuprks < 0 ? minuprks + 0.01 : minuprks
  }

  getSongsRecord(id: string) {
    return this.gameRecord[id] ? [...this.gameRecord[id]!] : undefined
  }

  async getB19(
    _e: unknown,
    num: number,
    option: { avgType?: string; color?: string; avgValue?: boolean; allPhi?: boolean } = {
      avgType: "all",
      color: "blue",
    },
  ) {
    let sum_rks = 0
    const philist = this.findAccRecord(100)
    for (let i = 0, j = 0; i < philist.length; ++i) {
      if (philist[i]!.rks < philist[j]!.rks) {
        if (i <= 3) {
          j = i
          continue
        }
        if (j < 3) {
          const tem = philist.slice(j, i - 1)
          philist.splice(j)
          philist.push(...fCompute.randArray(tem))
        }
        philist.splice(i)
        break
      }
    }
    const phi: (LevelRecordInfo | undefined)[] = []
    const phiNum = Math.max(option.allPhi ? philist.length : 3, 3)
    for (let i = 0; i < phiNum; ++i) {
      if (!philist[i]) {
        phi[i] = undefined
        continue
      }
      const x = philist[i]!
      if (x.rks) {
        const tem = { ...x } as LevelRecordInfo
        phi[i] = tem
        sum_rks += Number(tem.rks)
        tem.illustration = getInfo.getill(tem.id)
        tem.suggest = "无法推分"
      }
    }
    const rkslist = this.getRecord()
    const userrks = this.saveInfo.summary.rankingScore
    let minuprks = Math.floor(userrks * 100) / 100 + 0.005 - userrks
    if (minuprks < 0) minuprks += 0.01
    const b19_list: LevelRecordInfo[] = []
    for (let i = 0; i < num && i < rkslist.length; ++i) {
      const row = rkslist[i]!
      if (i < 27) sum_rks += Number(row.rks)
      row.num = i + 1
      if (row.acc < 100) {
        let suggest = fCompute.suggest(Number(i < 26 ? row.rks : rkslist[26]!.rks) + minuprks * 30, row.difficulty)
        if (suggest === -1 && (!phi[0] || row.rks > (phi[phi.length - 1]?.rks || 0))) suggest = 100
        if (suggest !== -1 && typeof suggest === "number") {
          row.suggest = `${suggest.toFixed(2)}%`
          if (suggest < 98.5) row.suggestType = 0
          else if (suggest < 99) row.suggestType = 1
          else if (suggest < 99.5) row.suggestType = 2
          else if (suggest < 99.7) row.suggestType = 3
          else if (suggest < 99.85) row.suggestType = 4
          else row.suggestType = 5
        } else {
          row.suggest = "无法推分"
        }
      } else {
        row.suggest = "无法推分"
      }
      row.illustration = getInfo.getill(row.id, "common")
      b19_list.push(row)
    }
    const com_rks = sum_rks / 30
    this.B19List = { phi, b19_list }
    this.b19_rks = b19_list[Math.min(b19_list.length - 1, 26)]?.rks || 0
    return { phi, b19_list, com_rks }
  }

  async getBestWithLimit(num: number, limit: Limit[], withPhi = true) {
    let sum_rks = 0
    const philist = this.findAccRecord(100)
    for (let i = 0; i < philist.length; ++i) {
      if (!checkLimit(philist[i]!, limit)) {
        philist.splice(i, 1)
        i--
      }
    }
    let phi: (LevelRecordInfo | undefined)[] | undefined
    if (withPhi) {
      phi = philist.splice(0, Math.min(philist.length, 3))
      for (let i = 0; i < 3; ++i) {
        if (!phi[i]) {
          phi[i] = undefined
          continue
        }
        const x = phi[i]!
        if (x.rks) {
          const tem = { ...x } as LevelRecordInfo
          phi[i] = tem
          sum_rks += Number(tem.rks)
          tem.illustration = getInfo.getill(tem.id)
          tem.suggest = "无法推分"
        }
      }
    }
    const rkslist = this.getRecord()
    const userrks = this.saveInfo.summary.rankingScore
    let minuprks = Math.floor(userrks * 100) / 100 + 0.005 - userrks
    if (minuprks < 0) minuprks += 0.01
    for (let i = 0; i < rkslist.length; ++i) {
      if (!checkLimit(rkslist[i]!, limit)) {
        rkslist.splice(i, 1)
        i--
      }
    }
    const b19_list: LevelRecordInfo[] = []
    for (let i = 0; i < num && i < rkslist.length; ++i) {
      const x = rkslist[i]!
      if (!x.rks) continue
      if (i < (withPhi ? 27 : 30)) sum_rks += Number(x.rks)
      x.num = i + 1
      if (x.acc < 100) {
        x.suggest = String(fCompute.suggest(Number(i < 26 ? x.rks : rkslist[26]!.rks) + minuprks * 30, x.difficulty, 2))
        if (x.suggest.includes("无") && (!phi?.[0] || x.rks > (phi[phi.length - 1]?.rks || 0)) && x.rks < 100) {
          x.suggest = "100.00%"
        }
      } else {
        x.suggest = "无法推分"
      }
      x.illustration = getInfo.getill(x.id, "common")
      b19_list.push(x)
    }
    return { phi, b19_list, com_rks: sum_rks / 30 }
  }

  getRks() {
    return Number(this.saveInfo.summary.rankingScore)
  }

  getSessionToken() {
    return this.session
  }

  getPlayerInfo() {
    const money = this.gameProgress?.money || [0, 0, 0, 0, 0]
    return {
      avatar: getInfo.idgetavatar(this.gameuser.avatar),
      ChallengeMode: Math.floor(this.saveInfo.summary.challengeModeRank / 100),
      ChallengeModeRank: this.saveInfo.summary.challengeModeRank % 100,
      rks: this.saveInfo.summary.rankingScore,
      data: `${money[4] ? `${money[4]}PiB ` : ""}${money[3] ? `${money[3]}TiB ` : ""}${money[2] ? `${money[2]}GiB ` : ""}${money[1] ? `${money[1]}MiB ` : ""}${money[0] ? `${money[0]}KiB ` : ""}`.trim() || "0KiB",
      selfIntro: this.gameuser.selfIntro,
      backgroundUrl: fCompute.getBackground(this.gameuser.background),
      PlayerId: fCompute.convertRichText(this.saveInfo.PlayerId),
      date: fCompute.formatDate(this.saveInfo.summary.updatedAt),
    }
  }

  getSuggest(id: string, lv: number, count: undefined, difficulty: number): number
  getSuggest(id: string, lv: number, count: number, difficulty: number): string
  getSuggest(id: string, lv: number, count: number | undefined, difficulty: number): string | number
  getSuggest(id: string, lv: number, count: number | undefined, difficulty: number): string | number {
    if (this.b19_rks === undefined || this.b0_rks === undefined) {
      const record = this.getRecord()
      this.b19_rks = record.length > 26 ? record[26]!.rks : 0
      this.b0_rks = this.findAccRecord(100, true)[0]?.rks
    }
    const b19 = this.b19_rks ?? 0
    const b0 = this.b0_rks ?? 0
    let suggest: number | string
    if (!this.gameRecord[id]?.[lv]?.rks) {
      suggest = fCompute.suggest(Math.max(b19, 0) + this.minUpRks() * 30, difficulty)
    } else {
      suggest = fCompute.suggest(Math.max(b19, this.gameRecord[id]![lv]!.rks) + this.minUpRks() * 30, difficulty)
    }
    if (suggest === -1 && difficulty > b0 + this.minUpRks() * 30) suggest = 100
    if (count == null) return suggest
    return suggest !== -1 && typeof suggest === "number" ? `${suggest.toFixed(count)}%` : "无法推分"
  }

  async getStats() {
    const tot = [0, 0, 0, 0]
    const stats_ = { title: "", Rating: "", unlock: 0, tot: 0, cleared: 0, fc: 0, phi: 0, real_score: 0, tot_score: 0, highest: 0, lowest: 18 }
    const stats = [{ ...stats_ }, { ...stats_ }, { ...stats_ }, { ...stats_ }]
    const Level = getInfo.allLevel
    for (const id of Object.keys(getInfo.ori_info)) {
      const info = getInfo.ori_info[id]
      if (!info?.chart) continue
      if (info.chart.AT && Number(info.chart.AT.difficulty)) tot[3] = (tot[3] ?? 0) + 1
      if (info.chart.IN && Number(info.chart.IN.difficulty)) tot[2] = (tot[2] ?? 0) + 1
      if (info.chart.HD && Number(info.chart.HD.difficulty)) tot[1] = (tot[1] ?? 0) + 1
      if (info.chart.EZ && Number(info.chart.EZ.difficulty)) tot[0] = (tot[0] ?? 0) + 1
    }
    for (let i = 0; i < 4; i++) {
      stats[i]!.tot = tot[i]!
      stats[i]!.title = Level[i]!
    }
    for (const id of Object.keys(this.gameRecord)) {
      const info = getInfo.ori_info[id]
      if (!info?.chart) continue
      const record = this.gameRecord[id]!
      for (const lv of [0, 1, 2, 3]) {
        const chart = info.chart[Level[lv]!]
        if (!chart || !Number(chart.difficulty)) continue
        if (record.length <= lv || record[lv] === undefined) continue
        ++stats[lv]!.unlock
        if (record[lv] === null) continue
        const rec = record[lv]!
        if (rec.score >= 700000) ++stats[lv]!.cleared
        if (rec.fc || rec.score === 1_000_000) ++stats[lv]!.fc
        if (rec.score === 1_000_000) ++stats[lv]!.phi
        stats[lv]!.real_score += rec.score
        stats[lv]!.tot_score += 1_000_000
        stats[lv]!.highest = Math.max(rec.rks, stats[lv]!.highest)
        stats[lv]!.lowest = Math.min(rec.rks, stats[lv]!.lowest)
      }
    }
    for (const lv of [0, 1, 2, 3]) {
      stats[lv]!.Rating = fCompute.rate(stats[lv]!.real_score, stats[lv]!.fc === stats[lv]!.unlock, stats[lv]!.tot_score)
      if (stats[lv]!.lowest === 18) stats[lv]!.lowest = 0
    }
    return stats
  }

  getScore(id: string, lv: string) {
    return this.gameRecord[id]?.[LEVEL_NUM_SAFE(lv)]
  }
}

function LEVEL_NUM_SAFE(lv: string) {
  return { EZ: 0, HD: 1, IN: 2, AT: 3, LEGACY: 4 }[lv] ?? 0
}
