import { defineCommand } from "../../../../src/sdk/index.ts"
import { b19Card } from "../../lib/cards.ts"
import type { Catalog } from "../../lib/catalog.ts"
import { isBanned, needSave, replyCard } from "../../lib/util.ts"

export default defineCommand({
  description: "RKS if every chart below this ACC is ignored",
  options: [{ name: "acc", description: "Minimum ACC 0-100", type: "number", required: true }],
  async execute(ctx, options) {
    if (await isBanned(ctx, "b19")) return
    const acc = Number(options.acc)
    if (!Number.isFinite(acc) || acc < 0 || acc > 100) {
      await ctx.reply({ content: "acc must be 0-100.", ephemeral: true })
      return
    }
    const got = await needSave(ctx)
    if (!got) return
    const catalog = ctx.service<Catalog>("phi.catalog")
    const data = await b19Card(got.rt, got.save, ctx.db, ctx.userId, catalog, { nnum: 33, accMin: acc, locale: ctx.locale })
    const rks = Number((data as { Rks?: string }).Rks)
    await replyCard(ctx, "phi/b19/b19", data, "lmtacc", `Limited RKS ${rks.toFixed(4)} vs save ${Number(got.save.saveInfo.summary.rankingScore).toFixed(4)}`)
  },
})
