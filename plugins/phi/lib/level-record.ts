import { ALL_LEVEL } from "./const.ts"
import { fCompute } from "./fcompute.ts"
import { getInfo } from "./get-info.ts"

export class LevelRecordInfo {
  fc: boolean
  score: number
  acc: number
  id: string
  rank: string
  Rating: string
  rks: number
  difficulty: number
  song?: string
  illustration?: string
  num?: number | string
  suggest?: string
  suggestType?: number
  accAvg?: string | number
  accKind?: string
  cpToOld?: { type: string; dif: string; rks: string }
  date?: Date

  constructor(data: { fc?: boolean | number; score?: number; acc?: number }, id: string, rank: number, ver?: string) {
    this.fc = Boolean(data.fc)
    this.score = data.score || 0
    this.acc = data.acc || 0
    this.id = id
    this.rank = ALL_LEVEL[rank] || String(rank)
    this.Rating = fCompute.rate(this.score, this.fc)
    const info = getInfo.info(id, true)
    if (!info) {
      this.difficulty = 0
      this.rks = 0
      return
    }
    this.song = info.song
    this.illustration = getInfo.getill(id)
    if (!ver || this.rank === "LEGACY") {
      const difficulty = info.chart?.[this.rank]?.difficulty
      this.difficulty = difficulty || 0
      this.rks = difficulty ? fCompute.rks(this.acc, difficulty) : 0
    } else {
      const difficulty = getInfo.historyDifficultyBySongId[id]?.[ver]?.[this.rank]
      this.difficulty = difficulty || 0
      this.rks = difficulty ? fCompute.rks(this.acc, difficulty) : 0
    }
  }
}
