import { fCompute } from "./fcompute.ts"
import { getInfo } from "./get-info.ts"

type ScoreDetail = [string | number, number, string | Date, boolean?]

const ScoreHistory = {
  create(acc: number, score: number, date: Date, fc: boolean) {
    return [acc.toFixed(4), score, date, fc]
  },

  extend(songId: string, level: string, now: ScoreDetail, old?: ScoreDetail) {
    const song = getInfo.idgetsong(songId) || songId
    const nowAcc = Number(now[0])
    const oldAcc = old ? Number(old[0]) : undefined
    const info = getInfo.info(songId, true)
    const base = {
      song,
      rank: level,
      illustration: getInfo.getill(songId),
      Rating: fCompute.rate(Number(now[1]), Boolean(now[3])),
      acc_new: nowAcc,
      acc_old: old ? oldAcc : undefined,
      score_new: now[1],
      score_old: old ? old[1] : undefined,
      date_new: new Date(now[2]),
      date_old: old ? new Date(old[2]) : undefined,
    }
    const difficulty = info?.chart?.[level]?.difficulty
    if (difficulty) {
      return {
        ...base,
        rks_new: fCompute.rks(nowAcc, difficulty),
        rks_old: oldAcc != null ? fCompute.rks(oldAcc, difficulty) : undefined,
      }
    }
    return base
  },

  open(data: ScoreDetail) {
    return {
      acc: Number(data[0]),
      score: Number(data[1]),
      date: new Date(data[2]),
      fc: Boolean(data[3]),
    }
  },

  date(data: ScoreDetail) {
    return new Date(data[2])
  },
}

export default ScoreHistory
