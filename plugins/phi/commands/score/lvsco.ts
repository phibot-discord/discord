import { defineCommand } from "../../../../src/sdk/index.ts"
import type { Catalog } from "../../lib/catalog.ts"
import { isBanned, needSave, RANKS, ratingOf, replyCard, themeOf } from "../../lib/util.ts"

export default defineCommand({
  description: "Scores in a difficulty range (lvsco.art)",
  options: [
    { name: "min", description: "Min difficulty", type: "number", required: true },
    { name: "max", description: "Max difficulty (default = min)", type: "number" },
    {
      name: "rank",
      description: "Limit to one difficulty",
      type: "string",
      choices: [
        { name: "EZ", value: "EZ" },
        { name: "HD", value: "HD" },
        { name: "IN", value: "IN" },
        { name: "AT", value: "AT" },
      ],
    },
  ],
  async execute(ctx, options) {
    if (await isBanned(ctx, "b19")) return
    const got = await needSave(ctx)
    if (!got) return
    let lo = Number(options.min)
    let hi = Number(options.max ?? lo)
    if (lo > hi) [lo, hi] = [hi, lo]
    if (hi % 1 === 0 && options.max == null) hi += 0.9
    const ask = [true, true, true, true]
    if (options.rank) {
      ask.fill(false)
      const i = RANKS.indexOf(String(options.rank) as (typeof RANKS)[number])
      if (i >= 0) ask[i] = true
    }
    const infoAll = got.rt.getInfo.ori_info as Record<string, { chart?: Record<string, { difficulty?: number }> }>
    let totcharts = 0
    const totRank = { AT: 0, IN: 0, HD: 0, EZ: 0 }
    const unlockRank = { AT: 0, IN: 0, HD: 0, EZ: 0 }
    let totsongs = 0
    let unlocksongs = 0
    let unlockcharts = 0
    let totcleared = 0
    let totfc = 0
    let totphi = 0
    let totreal_score = 0
    let tottot_score = 0
    let totacc = 0
    let tothighest = 0
    let totlowest = 17
    const totRating: Record<string, number> = { phi: 0, FC: 0, V: 0, S: 0, A: 0, B: 0, C: 0, F: 0, NEW: 0 }
    for (const info of Object.values(infoAll || {})) {
      if (!info?.chart) continue
      let vis = false
      for (const [i, lv] of RANKS.entries()) {
        const d = info.chart[lv]?.difficulty
        if (d == null || d < lo || d > hi || !ask[i]) continue
        totcharts++
        totRank[lv]++
        if (!vis) {
          totsongs++
          vis = true
        }
      }
    }
    const Record = got.save.gameRecord
    for (const [id, record] of Object.entries(Record || {})) {
      const info = got.rt.getInfo.info(id, true)
      if (!info?.chart) continue
      let vis = false
      for (const [lv, levelName] of RANKS.entries()) {
        const d = info.chart[levelName]?.difficulty
        if (d == null || d < lo || d > hi || !ask[lv]) continue
        const rec = record[lv]
        if (!rec) continue
        unlockcharts++
        unlockRank[levelName]++
        if (!vis) {
          unlocksongs++
          vis = true
        }
        if (rec.score >= 700000) totcleared++
        if (rec.fc || rec.score === 1e6) totfc++
        if (rec.score === 1e6) totphi++
        totRating[rec.Rating || ratingOf(rec.score, rec.fc)] = (totRating[rec.Rating || ratingOf(rec.score, rec.fc)] || 0) + 1
        totacc += rec.acc || 0
        totreal_score += rec.score || 0
        tottot_score += 1_000_000
        tothighest = Math.max(tothighest, rec.rks || 0)
        totlowest = Math.min(totlowest, rec.rks || 17)
      }
    }
    const maxDif = got.rt.getInfo.MAX_DIFFICULTY || 16.9
    const catalog = ctx.service<Catalog>("phi.catalog")
    await replyCard(ctx, "phi/lvsco/lvsco", {
      tot: { at: totRank.AT, in: totRank.IN, hd: totRank.HD, ez: totRank.EZ, songs: totsongs, charts: totcharts, score: tottot_score },
      real: { at: unlockRank.AT, in: unlockRank.IN, hd: unlockRank.HD, ez: unlockRank.EZ, songs: unlocksongs, charts: unlockcharts, score: totreal_score },
      rating: { ...totRating, tot: ratingOf(totreal_score, totfc === totcharts) },
      range: { bottom: lo, top: hi, left: (lo / maxDif) * 100, length: ((hi - lo) / maxDif) * 100 },
      illustration: catalog.randomIll(),
      highest: tothighest,
      lowest: totlowest === 17 ? 0 : totlowest,
      tot_cleared: totcleared,
      tot_fc: totfc,
      tot_phi: totphi,
      tot_acc: totcharts ? totacc / totcharts : 0,
      date: got.save.saveInfo.summary.updatedAt,
      progress_phi: totcharts ? Number(((totphi / totcharts) * 100).toFixed(2)) : 0,
      progress_fc: totcharts ? Number(((totfc / totcharts) * 100).toFixed(2)) : 0,
      avatar: got.rt.getInfo.idgetavatar(got.save.gameuser.avatar),
      ChallengeMode: Math.floor(got.save.saveInfo.summary.challengeModeRank / 100),
      ChallengeModeRank: got.save.saveInfo.summary.challengeModeRank % 100,
      rks: got.save.saveInfo.summary.rankingScore,
      PlayerId: got.rt.fCompute.convertRichText(got.save.saveInfo.PlayerId),
      background: catalog.randomIll("blur"),
      theme: await themeOf(ctx),
    }, "lvsco")
  },
})
