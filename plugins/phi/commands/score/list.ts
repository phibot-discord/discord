import { defineCommand } from "../../../../src/sdk/index.ts"
import type { Catalog } from "../../lib/catalog.ts"
import { displaySuggest, cardCopy, resolvePhiLocale } from "../../lib/card-i18n.ts"
import { getNotes } from "../../lib/notes.ts"
import { isBanned, needSave, RANKS, rankIndex, ratingOf, replyCard, themeOf } from "../../lib/util.ts"

export default defineCommand({
  description: "List chart scores in a range (list.art)",
  options: [
    { name: "min", description: "Min difficulty", type: "number" },
    { name: "max", description: "Max difficulty", type: "number" },
    { name: "acc_min", description: "Min ACC", type: "number" },
    { name: "acc_max", description: "Max ACC", type: "number" },
    { name: "rank", description: "EZ/HD/IN/AT", type: "string", choices: [{ name: "EZ", value: "EZ" }, { name: "HD", value: "HD" }, { name: "IN", value: "IN" }, { name: "AT", value: "AT" }] },
    { name: "grade", description: "NEW/C/B/A/S/V/FC/PHI", type: "string" },
  ],
  async execute(ctx, options) {
    if (await isBanned(ctx, "b19")) return
    const got = await needSave(ctx)
    if (!got) return
    const notes = await getNotes(ctx.db, ctx.userId)
    const t = cardCopy(resolvePhiLocale(notes.locale, ctx.locale))
    const lo = Number(options.min ?? 0)
    const hi = Number(options.max ?? got.rt.getInfo.MAX_DIFFICULTY ?? 16.9)
    const accLo = Number(options.acc_min ?? 0)
    const accHi = Number(options.acc_max ?? 100)
    const ask = [true, true, true, true]
    if (options.rank) {
      ask.fill(false)
      const i = rankIndex(String(options.rank))
      if (i >= 0) ask[i] = true
    }
    const grade = String(options.grade || "").toUpperCase()
    const Record = got.save.gameRecord
    const song: { difficulty: number; [key: string]: unknown }[] = []
    for (const [id, recs] of Object.entries(Record || {})) {
      const info = got.rt.getInfo.info(id, true)
      if (!info) continue
      for (const [lv, levelName] of RANKS.entries()) {
        if (!ask[lv] || !info.chart[levelName]) continue
        const d = info.chart[levelName].difficulty
        if (d < lo || d > hi) continue
        const rec = recs[lv]
        const acc = rec?.acc ?? 0
        if (acc < accLo || acc > accHi) continue
        const rating = rec ? rec.Rating || ratingOf(rec.score, rec.fc) : "NEW"
        const tag = rating === "phi" ? "PHI" : rating
        if (grade && tag !== grade && !(grade === "AP" && tag === "PHI")) continue
        song.push({
          song: info.song,
          composer: info.composer,
          rank: levelName,
          difficulty: d,
          illustration: got.rt.getInfo.getill(id, "low"),
          acc: rec?.acc,
          score: rec?.score,
          Rating: rec ? rating : undefined,
          suggest: rec ? displaySuggest(got.save.getSuggest?.(id, lv, 4, d) as string | number | undefined, t) : undefined,
        })
      }
    }
    song.sort((a, b) => (b.difficulty || 0) - (a.difficulty || 0))
    const catalog = ctx.service<Catalog>("phi.catalog")
    await replyCard(ctx, "phi/list/list", {
      head_title: "Score list",
      song: song.slice(0, 80),
      background: catalog.randomIll("blur"),
      theme: await themeOf(ctx),
      PlayerId: got.save.saveInfo.PlayerId,
      Rks: Number(got.save.saveInfo.summary.rankingScore).toFixed(4),
    }, "list")
  },
})
