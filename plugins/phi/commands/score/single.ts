import { defineCommand } from "../../../../src/sdk/index.ts"
import { displaySuggest, cardCopy, resolvePhiLocale } from "../../lib/card-i18n.ts"
import { getNotes } from "../../lib/notes.ts"
import { isBanned, needSave, phiCatalog, RANK_CHOICES, replyCard, resolveSong, songChoices, themeOf } from "../../lib/util.ts"

export default defineCommand({
  description: "Single-song score card (score.art)",
  options: [
    { name: "name", description: "Song name or alias", type: "string", required: true, autocomplete: true },
    { name: "rank", description: "Difficulty", type: "string", choices: RANK_CHOICES },
  ],
  autocomplete: songChoices,
  async execute(ctx, options) {
    if (await isBanned(ctx, "b19")) return
    const catalog = phiCatalog(ctx)
    const hit = resolveSong(catalog, String(options.name || ""))
    if (!hit) {
      await ctx.reply({ content: `No song matching \`${options.name}\`.`, ephemeral: true })
      return
    }
    const got = await needSave(ctx)
    if (!got) return
    const info = got.rt.getInfo.info(hit.id, true) || hit.song
    const Record = got.save.gameRecord?.[hit.id]
    if (!Record) {
      await ctx.reply(`No record for **${info.song}**. Update your save.`)
      return
    }
    const notes = await getNotes(ctx.db, ctx.userId)
    const t = cardCopy(resolvePhiLocale(notes.locale, ctx.locale))
    const Level = ["EZ", "HD", "IN", "AT"]
    const scoreData: Record<string, unknown> = {}
    for (const level of Level) {
      if (!info.chart?.[level]) break
      scoreData[level] = { difficulty: info.chart[level].difficulty }
    }
    Record.forEach?.((record, i) => {
      const level = Level[i]
      if (!record || !level) return
      const chartInfo = info.chart?.[level]
      if (!chartInfo) return
      const suggest = got.save.getSuggest?.(hit.id, i, undefined, chartInfo.difficulty)
      const formatted = typeof suggest === "number" && suggest !== -1 ? `${suggest.toFixed(4)}%` : suggest
      scoreData[level] = {
        ...record,
        acc: Number(record.acc).toFixed(4),
        rks: Number(record.rks).toFixed(4),
        suggest: displaySuggest(formatted as string | number | undefined, t),
        difficulty: chartInfo.difficulty,
      }
    })
    await replyCard(ctx, "phi/score/score", {
      songName: info.song,
      PlayerId: got.save.saveInfo.PlayerId,
      avatar: got.rt.getInfo.idgetavatar(String(got.save.saveInfo.summary.avatar ?? "")),
      Rks: Number(got.save.saveInfo.summary.rankingScore).toFixed(2),
      Date: got.save.saveInfo.summary.updatedAt,
      ChallengeMode: Math.floor(got.save.saveInfo.summary.challengeModeRank / 100),
      ChallengeModeRank: got.save.saveInfo.summary.challengeModeRank % 100,
      scoreData,
      history: await songHist(got.rt, ctx.db, ctx.userId, hit.id),
      illustration: got.rt.getInfo.getill(hit.id),
      theme: await themeOf(ctx),
      rank: options.rank,
    }, "score")
  },
})

async function songHist(rt: import("../../lib/runtime.ts").PhiRuntime, db: import("../../../../src/sdk/index.ts").Kv, userId: string, songId: string) {
  try {
    const { getToken } = await import("../../lib/saves.ts")
    const { loadSaveHistory, songScoreHistory } = await import("../../lib/history.ts")
    const token = await getToken(rt, userId)
    if (!token) return []
    return await songScoreHistory(rt, await loadSaveHistory(rt, db, token), songId)
  } catch {
    return []
  }
}
