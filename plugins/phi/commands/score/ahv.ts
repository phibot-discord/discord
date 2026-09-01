import { defineCommand } from "../../../../src/sdk/index.ts"
import type { Catalog } from "../../lib/catalog.ts"
import { isBanned, needSave, ratingOf, replyCard, themeOf } from "../../lib/util.ts"

export default defineCommand({
  description: "Achievement table for a difficulty (table.art with scores)",
  options: [
    { name: "difficulty", description: "Integer difficulty (e.g. 14)", type: "number", required: true },
    { name: "version", description: "Version label or code", type: "string" },
  ],
  async execute(ctx, options) {
    if (await isBanned(ctx, "b19")) return
    const got = await needSave(ctx)
    if (!got) return
    const dif = Math.floor(Number(options.difficulty))
    const max = got.rt.getInfo.MAX_DIFFICULTY || 16.9
    if (!dif || dif < 1 || dif > max) {
      await ctx.reply({ content: `difficulty must be 1-${max}.`, ephemeral: true })
      return
    }
    let matchVerCode: number | undefined
    const verArg = String(options.version || "")
    if (verArg.includes(".")) matchVerCode = got.rt.getInfo.versionInfoByLabel?.[verArg]?.version_code
    else if (verArg) matchVerCode = Number(verArg)
    else matchVerCode = Object.keys(got.rt.getInfo.versionInfoByCode || {}).map(Number).sort((a: number, b: number) => b - a)[0]
    const versionInfo = matchVerCode != null ? got.rt.getInfo.versionInfoByCode?.[matchVerCode] : undefined
    if (!versionInfo) {
      await ctx.reply("Version info missing. Runtime getInfo.init may still be loading history.")
      return
    }
    const byDif = got.rt.getInfo.historyDifficultyByVerDifficulty?.[versionInfo.version_code] || {}
    const table = []
    let total = 0
    for (let i = 0; i < 10; i++) {
      const difStr = (Math.round((dif + i * 0.1) * 10) / 10).toFixed(1)
      const charts = byDif[difStr]
      if (!charts) continue
      total += charts.length
      let minScore = Infinity
      let fcFlag = true
      const songs = charts.map((chart: { id: string; rank: string }) => {
        const playerRecord = got.save.getScore?.(chart.id, chart.rank)
        minScore = Math.min(minScore, playerRecord?.score || 0)
        if (!playerRecord?.fc) fcFlag = false
        return { rank: chart.rank, illustration: got.rt.getInfo.getill(chart.id, "low"), score: playerRecord?.acc || 0 }
      })
      table.push({ difficulty: difStr, songs, rating: got.rt.fCompute.rate?.(minScore === Infinity ? 0 : minScore, fcFlag) || ratingOf(minScore === Infinity ? 0 : minScore, fcFlag) })
    }
    const catalog = ctx.service<Catalog>("phi.catalog")
    await replyCard(ctx, "phi/table/table", {
      title: { difficulty: dif, total, version: versionInfo.version_label, dec: "Player Achievements" },
      table,
      background: catalog.randomIll("blur"),
      theme: await themeOf(ctx),
      gameuser: got.save.getPlayerInfo?.() || { PlayerId: got.save.saveInfo.PlayerId },
    }, "ahv")
  },
})
