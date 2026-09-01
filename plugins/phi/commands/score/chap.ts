import { defineCommand } from "../../../../src/sdk/index.ts"
import type { Catalog } from "../../lib/catalog.ts"
import { displaySuggest, cardCopy, resolvePhiLocale } from "../../lib/card-i18n.ts"
import { getNotes } from "../../lib/notes.ts"
import { isBanned, needSave, RANKS, replyCard, themeOf } from "../../lib/util.ts"

export default defineCommand({
  description: "Chapter completion card",
  options: [{ name: "chapter", description: "Chapter name or ALL / help", type: "string", required: true }],
  async execute(ctx, options) {
    if (await isBanned(ctx, "b19")) return
    const msg = String(options.chapter || "").trim().toUpperCase()
    if (!msg || msg === "HELP") {
      await ctx.reply("Use `/phi score chap chapter:ALL` or a chapter nick (e.g. 单曲精选集).")
      return
    }
    const got = await needSave(ctx)
    if (!got) return
    const notes = await getNotes(ctx.db, ctx.userId)
    const t = cardCopy(resolvePhiLocale(notes.locale, ctx.locale))
    const chapNick = got.rt.getInfo.chapNick || {}
    let chap = msg
    if (msg !== "ALL") {
      const fuzzy = got.rt.fCompute.fuzzySearch?.(msg, chapNick)?.[0]?.value
      chap = fuzzy || msg
    }
    const song_box: Record<string, unknown> = {}
    const count: Record<string, number> = { tot: 0, phi: 0, FC: 0, V: 0, S: 0, A: 0, B: 0, C: 0, F: 0, NEW: 0 }
    const rankAcc: Record<string, number> = { EZ: 0, HD: 0, IN: 0, AT: 0 }
    const rankN: Record<string, number> = { EZ: 0, HD: 0, IN: 0, AT: 0 }
    const ori = got.rt.getInfo.ori_info as Record<string, { chapter?: string; chart?: Record<string, { difficulty?: number }> }>
    for (const id of Object.keys(ori || {})) {
      if (!(ori[id]?.chapter === chap || msg === "ALL")) continue
      song_box[id] = { illustration: got.rt.getInfo.getill(id, "low"), chart: {} }
      const songRecord = got.save.getSongsRecord?.(id)
      const info = got.rt.getInfo.info(id, true)
      if (!info) continue
      for (const [i, level] of RANKS.entries()) {
        if (!info.chart[level]?.difficulty) continue
        const Record = songRecord?.[i]
        const cell: Record<string, unknown> = {
          difficulty: info.chart[level].difficulty,
          Rating: Record?.Rating || "NEW",
          suggest: displaySuggest(got.save.getSuggest?.(id, i, 4, info.chart[level].difficulty) as string | number | undefined, t),
        }
        if (Record) {
          cell.score = Record.score
          cell.acc = Number(Record.acc).toFixed(4)
          cell.rks = Number(Record.rks).toFixed(4)
          cell.fc = Record.fc
        }
        ;(song_box[id] as { chart: Record<string, unknown> }).chart[level] = cell
        count.tot = (count.tot || 0) + 1
        if (Record?.Rating) count[Record.Rating] = (count[Record.Rating] || 0) + 1
        else count.NEW = (count.NEW || 0) + 1
        rankN[level] = (rankN[level] || 0) + 1
        rankAcc[level] = (rankAcc[level] || 0) + Number(Record?.acc || 0)
      }
    }
    const progress: Record<string, number> = {}
    for (const level of RANKS) if (rankN[level]) progress[level] = rankAcc[level]! / rankN[level]!
    const catalog = ctx.service<Catalog>("phi.catalog")
    await replyCard(ctx, "phi/chap/chap", {
      player: { id: got.save.saveInfo.PlayerId },
      count,
      song_box,
      progress,
      num: rankN.EZ,
      chapName: msg === "ALL" ? "AllSong" : chap,
      chapIll: got.rt.getInfo.getChapIll?.(msg === "ALL" ? "AllSong" : chap) || catalog.randomIll(),
      theme: await themeOf(ctx),
      background: catalog.randomIll("blur"),
    }, "chap")
  },
})
