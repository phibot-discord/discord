import { defineCommand } from "../../../../src/sdk/index.ts"
import type { Catalog } from "../../lib/catalog.ts"
import { buildUpdateCard, loadHisb30Snaps, loadSaveHistory } from "../../lib/history.ts"
import { getNotes } from "../../lib/notes.ts"
import type { PhiRuntime } from "../../lib/runtime.ts"
import { getToken, updateSave } from "../../lib/saves.ts"
import { isBanned, replyCard } from "../../lib/util.ts"

export default defineCommand({
  description: "Refresh the bound Phigros save from TapTap and send the update card",
  options: [{ name: "global", description: "International server", type: "boolean" }],
  async execute(ctx, options) {
    if (await isBanned(ctx, "update")) return
    try {
      const rt = ctx.service<PhiRuntime>("phi.runtime")
      const catalog = ctx.service<Catalog>("phi.catalog")
      const save = await updateSave(rt, ctx.db, ctx.userId, { global: !!options.global })
      const notes = await getNotes(ctx.db, ctx.userId)
      const token = await getToken(rt, ctx.userId)
      const snaps = await loadHisb30Snaps(ctx.db, ctx.userId)
      const history = await loadSaveHistory(rt, ctx.db, token || "")
      const data = await buildUpdateCard(rt, save, catalog, history, notes, snaps, { locale: ctx.locale })
      const rks = Number(save.saveInfo.summary.rankingScore).toFixed(4)
      const n = Number(data.show) || 0
      const caption = `Updated **${save.saveInfo.PlayerId}** · RKS ${rks} · ${n ? `updated ${n} scores` : "no new scores"}`
      await replyCard(ctx, "phi/update/update", data, "update", caption)
    } catch (err) {
      await ctx.reply({ content: String(err instanceof Error ? err.message : err), ephemeral: true })
    }
  },
})
