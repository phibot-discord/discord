import { defineCommand } from "../../../../src/sdk/index.ts"
import type { Catalog } from "../../lib/catalog.ts"
import { cardCopy, resolvePhiLocale } from "../../lib/card-i18n.ts"
import { getNotes } from "../../lib/notes.ts"
import { isBanned, needSave, RANKS, replyCard, themeOf } from "../../lib/util.ts"

function suggestType(n: number) {
  if (n < 98.5) return 0
  if (n < 99) return 1
  if (n < 99.5) return 2
  if (n < 99.7) return 3
  if (n < 99.85) return 4
  return 5
}

import type { PhiRuntime } from "../../lib/runtime.ts"
import type { Save } from "../../lib/save.ts"

export function collectSuggest(rt: PhiRuntime, save: Save) {
  const Record = save.gameRecord
  const buckets: Array<Array<{ suggest: number } & Record<string, unknown>>> = [[], [], [], [], [], []]
  for (const [id, recs] of Object.entries(Record || {})) {
    const info = rt.getInfo.info(id)
    if (!info) continue
    for (const [lv, level] of RANKS.entries()) {
      if (!info.chart[level]?.difficulty) continue
      const rec = recs[lv] || { suggest: -1 }
      const rawSuggest = save.getSuggest(id, lv, undefined, info.chart[level]!.difficulty)
      const suggest = typeof rawSuggest === "number" ? rawSuggest : -1
      if (suggest == null || suggest === -1) continue
      rec.suggest = suggest
      buckets[suggestType(suggest)]!.push({
        ...info,
        difficulty: info.chart[level].difficulty,
        ...rec,
        rank: level,
        illustration: rt.getInfo.getill(id, "low"),
        suggest,
        avg: 0,
      })
    }
  }
  for (const b of buckets) b.sort((a, b) => a.suggest - b.suggest).splice(3)
  return buckets
}

export default defineCommand({
  description: "Charts that raise RKS by ~0.01 (suggest.art)",
  async execute(ctx) {
    if (await isBanned(ctx, "b19")) return
    const got = await needSave(ctx)
    if (!got) return
    const buckets = collectSuggest(got.rt, got.save)
    const catalog = ctx.service<Catalog>("phi.catalog")
    const notes = await getNotes(ctx.db, ctx.userId)
    const locale = resolvePhiLocale(notes.locale, ctx.locale)
    const t = cardCopy(locale)
    await replyCard(ctx, "phi/suggest/suggest", {
      head_title: t.suggestTitle,
      song: buckets,
      phisong: [],
      background: catalog.randomIll(),
      theme: await themeOf(ctx),
      PlayerId: got.save.saveInfo.PlayerId,
      Rks: Number(got.save.saveInfo.summary.rankingScore).toFixed(4),
      Date: got.save.saveInfo.summary.updatedAt,
      ChallengeMode: Math.floor(got.save.saveInfo.summary.challengeModeRank / 100),
      ChallengeModeRank: got.save.saveInfo.summary.challengeModeRank % 100,
    }, "suggest")
  },
})
