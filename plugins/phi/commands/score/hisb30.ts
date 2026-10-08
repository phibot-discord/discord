import { defineCommand } from "../../../../src/sdk/index.ts"
import { buildHisb30Rows, loadHisb30Snaps, loadSaveHistory, playerBlock } from "../../lib/history.ts"
import { getNotes } from "../../lib/notes.ts"
import { getToken } from "../../lib/saves.ts"
import { STYLE_OPTION_DESC, sendCard, styleChoices } from "../../lib/send-card.ts"
import { isBanned, needSave, phiCatalog, replyCard } from "../../lib/util.ts"

export default defineCommand({
  description: "Score history card: recent updates, B30 changes and RKS trend",
  options: [
    {
      name: "style",
      description: STYLE_OPTION_DESC,
      type: "string",
      choices: styleChoices("hisb30", [{ name: "Legacy (B30 changes)", value: "legacy" }]),
    },
  ],
  async execute(ctx, options) {
    if (await isBanned(ctx, "b19")) return
    const style = options.style ? String(options.style) : undefined
    if (style !== "legacy") {
      await sendCard(ctx, "hisb30", { style })
      return
    }
    // Bot-only layout: B30 membership changes across save history, outside the shared cache
    const [got, notes] = await Promise.all([needSave(ctx), getNotes(ctx.db, ctx.userId)])
    if (!got) return
    const [token, snaps] = await Promise.all([getToken(got.rt, ctx.userId), loadHisb30Snaps(ctx.db, ctx.userId)])
    const history = await loadSaveHistory(got.rt, ctx.db, token || "")
    const rows = await buildHisb30Rows(got.rt, history, snaps)
    if (!rows.length) {
      await ctx.reply("Need score history or at least two `/phi account update` snapshots to show B30 changes.")
      return
    }
    await replyCard(
      ctx,
      "phi/historyB30/historyB30",
      {
        rows,
        Date: got.save.saveInfo.summary.updatedAt,
        gameuser: playerBlock(got.rt, got.save),
        background: phiCatalog(ctx).randomIll("blur"),
        theme: notes.theme || "default",
      },
      "hisb30",
      undefined,
      notes,
    )
  },
})
