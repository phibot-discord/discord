import { defineCommand } from "../../../../src/sdk/index.ts"
import { b19Card } from "../../lib/cards.ts"
import type { Catalog } from "../../lib/catalog.ts"
import { isBanned, needSave, replyCard } from "../../lib/util.ts"

export default defineCommand({
  description: "1-Good B30 (x30)",
  options: [{ name: "count", description: "How many best charts (min 33)", type: "integer" }],
  async execute(ctx, options) {
    if (await isBanned(ctx, "b19")) return
    const got = await needSave(ctx)
    if (!got) return
    const nnum = Math.max(33, Math.min(99, Number(options.count) || 33))
    const data = await b19Card(got.rt, got.save, ctx.db, ctx.userId, ctx.service<Catalog>("phi.catalog"), { nnum, mode: "x30", locale: ctx.locale })
    await replyCard(ctx, "phi/b19/b19", data, "x30")
  },
})
