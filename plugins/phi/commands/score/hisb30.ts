import { defineCommand } from "../../../../src/sdk/index.ts"
import type { Catalog } from "../../lib/catalog.ts"
import { buildHisb30Rows, loadHisb30Snaps, loadSaveHistory, playerBlock } from "../../lib/history.ts"
import { getToken } from "../../lib/saves.ts"
import { isBanned, needSave, replyCard, themeOf } from "../../lib/util.ts"

export default defineCommand({
  description: "B30 membership changes across save history",
  async execute(ctx) {
    if (await isBanned(ctx, "b19")) return
    const got = await needSave(ctx)
    if (!got) return
    const token = await getToken(got.rt, ctx.userId)
    const snaps = await loadHisb30Snaps(ctx.db, ctx.userId)
    const history = token ? await loadSaveHistory(got.rt, ctx.db, token) : await loadSaveHistory(got.rt, ctx.db, "")
    const rows = await buildHisb30Rows(got.rt, history, snaps)
    if (!rows.length) {
      await ctx.reply("Need score history or at least two `/phi account update` snapshots to show B30 changes.")
      return
    }
    const catalog = ctx.service<Catalog>("phi.catalog")
    await replyCard(ctx, "phi/historyB30/historyB30", {
      rows,
      Date: got.save.saveInfo.summary.updatedAt,
      gameuser: playerBlock(got.rt, got.save),
      background: catalog.randomIll("blur"),
      theme: await themeOf(ctx),
    }, "hisb30")
  },
})
