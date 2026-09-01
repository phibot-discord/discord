import { defineCommand } from "../../../../src/sdk/index.ts"
import type { Catalog } from "../../lib/catalog.ts"
import { buildUpdateCard, loadHisb30Snaps, loadSaveHistory } from "../../lib/history.ts"
import { getNotes } from "../../lib/notes.ts"
import { getToken } from "../../lib/saves.ts"
import { isBanned, needSave, replyCard } from "../../lib/util.ts"

export default defineCommand({
  description: "Score changes since last update and RKS history graph",
  async execute(ctx) {
    if (await isBanned(ctx, "update")) return
    const got = await needSave(ctx)
    if (!got) return
    const catalog = ctx.service<Catalog>("phi.catalog")
    const notes = await getNotes(ctx.db, ctx.userId)
    const token = await getToken(got.rt, ctx.userId)
    const snaps = await loadHisb30Snaps(ctx.db, ctx.userId)
    const history = await loadSaveHistory(got.rt, ctx.db, token || "")
    const data = await buildUpdateCard(got.rt, got.save, catalog, history, notes, snaps, { locale: ctx.locale })
    const hasSongs = Array.isArray(data.box_line) && data.box_line.length > 0
    const hasGraph = Array.isArray(data.rks_history) && data.rks_history.length > 0
    if (!hasSongs && !hasGraph) {
      await ctx.reply("No score-change history yet. Run `/phi account update` after playing, then try again.")
      return
    }
    await replyCard(ctx, "phi/update/update", data, "history")
  },
})
