import type { Kv } from "../../../src/sdk/index.ts"
import { buildRksHistogram, getB30AnalysisRecords } from "./b30-analysis.ts"
import { cardCopy, fill, localizeSuggestFields, resolvePhiLocale, type PhiLocale } from "./card-i18n.ts"
import type { Catalog } from "./catalog.ts"
import { accRksLines, loadHisb30Snaps, loadSaveHistory, rksLineFor } from "./history.ts"
import { getNotes, type UserNotes } from "./notes.ts"
import type { PhiRuntime } from "./runtime.ts"
import type { Save } from "./save.ts"
import { getToken, moneyText } from "./saves.ts"

async function b30AnalysisFor(save_b19: { phi?: unknown[]; b19_list?: unknown[] }, notes: UserNotes, nnum: number) {
  if (notes.showB30Analysis === false || nnum !== 33) return null
  const records = getB30AnalysisRecords(save_b19)
  const histogram = buildRksHistogram(records)
  return {
    histogram,
    tagAnalysis: null,
    showTags: false,
    histogramWide: true,
  }
}

export async function b19Card(
  rt: PhiRuntime,
  save: Save,
  db: Kv,
  userId: string,
  catalog: Catalog,
  extra: { nnum?: number; spInfo?: string[]; mode?: "b30" | "x30" | "fc30" | "p30"; accMin?: number; locale?: PhiLocale | string } = {},
) {
  const notes = await getNotes(db, userId)
  const locale = resolvePhiLocale(notes.locale, extra.locale)
  const t = cardCopy(locale)
  const nnum = extra.nnum ?? 33
  let save_b19: { phi?: unknown[]; b19_list?: unknown[] }
  const spInfo = [...(extra.spInfo || [])]
  if (extra.accMin != null) {
    save_b19 = await save.getBestWithLimit(nnum, [{ type: "acc", value: [extra.accMin, 100] }])
    spInfo.push(fill(t.accLimited, { n: extra.accMin }))
  } else if (extra.mode === "p30") {
    save_b19 = await save.getBestWithLimit(nnum, [{ type: "acc", value: [100, 100] }])
    spInfo.push(t.apMode)
  } else if (extra.mode === "fc30") {
    save_b19 = await save.getBestWithLimit(nnum, [{ type: "custom", value: (record: { fc?: boolean; score?: number }) => record.fc === true && record.score !== 1e6 }], false)
    spInfo.push(t.fcMode)
  } else if (extra.mode === "x30") {
    save_b19 = await save.getBestWithLimit(nnum, [{
      type: "custom",
      value: (record: { score: number; id: string; rank: string }) =>
        rt.fCompute.comJust1Good(record.score, rt.getInfo.ori_info[record.id]?.chart?.[record.rank]?.combo || 1e9),
    }], false)
    spInfo.push(t.x30Mode)
  } else {
    save_b19 = await save.getB19(undefined, nnum, { avgType: notes.b30AvgKind, color: notes.b30AvgColor })
  }
  localizeSuggestFields(save_b19.phi as Array<{ suggest?: string }> | undefined, t)
  localizeSuggestFields(save_b19.b19_list as Array<{ suggest?: string }> | undefined, t)
  const stats = await save.getStats()
  const money = save.gameProgress?.money || [0, 0, 0, 0, 0]
  const gameuser = {
    avatar: rt.getInfo.idgetavatar(save.gameuser.avatar),
    ChallengeMode: Math.floor(save.saveInfo.summary.challengeModeRank / 100),
    ChallengeModeRank: save.saveInfo.summary.challengeModeRank % 100,
    rks: save.saveInfo.summary.rankingScore,
    data: moneyText(money),
    selfIntro: rt.fCompute.convertRichText(save.gameuser.selfIntro),
    backgroundUrl: await rt.fCompute.getBackground(save.gameuser.background),
    PlayerId: rt.fCompute.convertRichText(save.saveInfo.PlayerId),
  }
  return {
    phi: save_b19.phi,
    b19_list: save_b19.b19_list,
    PlayerId: gameuser.PlayerId,
    Rks: Number(save.saveInfo.summary.rankingScore).toFixed(4),
    Date: rt.fCompute.formatDate(save.saveInfo.summary.updatedAt),
    ChallengeMode: gameuser.ChallengeMode,
    ChallengeModeRank: gameuser.ChallengeModeRank,
    background: catalog.randomIll("blur"),
    theme: notes.theme || "default",
    gameuser,
    nnum,
    stats,
    spInfo,
    locale,
    b30Analysis: await b30AnalysisFor(save_b19, notes, nnum),
    BSIllPath: rt.getInfo.getill("BANGINGSTRIKE.DewPleiades.0", "common"),
  }
}

export async function infoCard(rt: PhiRuntime, save: Save, db: Kv, userId: string, catalog: Catalog, extra: { locale?: PhiLocale | string } = {}) {
  const notes = await getNotes(db, userId)
  const locale = resolvePhiLocale(notes.locale, extra.locale)
  const stats = await save.getStats()
  const money = save.gameProgress?.money || [0, 0, 0, 0, 0]
  let backgroundurl = ""
  try {
    backgroundurl = await rt.fCompute.getBackground(save.gameuser.background)
  } catch {
    /* optional */
  }
  if (!backgroundurl || /^(https?:|data:)/i.test(backgroundurl)) {
    backgroundurl = catalog.randomIll("common") || catalog.fallbackIll || ""
  }
  const gameuser = {
    avatar: rt.getInfo.idgetavatar(save.gameuser.avatar),
    ChallengeMode: Math.floor(save.saveInfo.summary.challengeModeRank / 100),
    ChallengeModeRank: save.saveInfo.summary.challengeModeRank % 100,
    rks: Number(save.saveInfo.summary.rankingScore) || 0,
    data: moneyText(money),
    selfIntro: rt.fCompute.convertRichText(save.gameuser.selfIntro),
    backgroundurl,
    PlayerId: rt.fCompute.convertRichText(save.saveInfo.PlayerId),
  }
  let acc: ReturnType<typeof accRksLines> = { acc_rks_data: [], acc_rks_range: [0, 1], acc_rks_AccRange: [] }
  try {
    acc = accRksLines(save)
  } catch {
    /* chart stays empty */
  }
  let rks_history: number[][] = []
  let data_history: number[][] = []
  let rks_range: number[] = [0, 1]
  let data_range: Array<number | string> = [0, 1]
  let data_date: [string, string] = ["", ""]
  let rks_date: [string, string] = ["", ""]
  try {
    const token = await getToken(rt, userId)
    const snaps = await loadHisb30Snaps(db, userId)
    if (token) {
      const history = await loadSaveHistory(rt, db, token)
      const line = await rksLineFor(rt, history, snaps)
      rks_history = line.rks_history
      rks_range = line.rks_range
      rks_date = line.rks_date
      const dataLine = history.getDataLine()
      data_history = (dataLine.data_history || []) as number[][]
      data_range = dataLine.data_range || [0, 1]
      data_date = [
        dataLine.data_date?.[0] ? rt.fCompute.formatDate(dataLine.data_date[0]) : "",
        dataLine.data_date?.[1] ? rt.fCompute.formatDate(dataLine.data_date[1]) : "",
      ]
    } else if (snaps.length) {
      const line = await rksLineFor(rt, await loadSaveHistory(rt, db, ""), snaps)
      rks_history = line.rks_history
      rks_range = line.rks_range
      rks_date = line.rks_date
    }
  } catch {
    /* charts stay empty */
  }
  return {
    gameuser,
    userstats: stats,
    rks_history,
    data_history,
    rks_range,
    data_range,
    data_date,
    rks_date,
    acc_rks_data: acc.acc_rks_data,
    acc_rks_range: acc.acc_rks_range,
    acc_rks_AccRange: acc.acc_rks_AccRange,
    background: catalog.randomIll("blur"),
    theme: notes.theme || "default",
    locale,
  }
}
