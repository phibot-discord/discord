import { defineCommand } from "../../../../src/sdk/index.ts"
import { infoCard } from "../../lib/cards.ts"
import type { Catalog } from "../../lib/catalog.ts"
import { isBanned, needSave, replyCard } from "../../lib/util.ts"

export default defineCommand({
  description: "Player stats card (userinfo.art)",
  options: [
    { name: "version", description: "1 = current, 2 = old layout", type: "integer", choices: [{ name: "1", value: 1 }, { name: "2", value: 2 }] },
  ],
  async execute(ctx, options) {
    if (await isBanned(ctx, "b19")) return
    const got = await needSave(ctx)
    if (!got) return
    const catalog = ctx.service<Catalog>("phi.catalog")
    const data = await infoCard(got.rt, got.save, ctx.db, ctx.userId, catalog, { locale: ctx.locale })
    const tpl = Number(options.version) === 2 ? "phi/userinfo/userinfo-old" : "phi/userinfo/userinfo"
    await replyCard(ctx, tpl, data, "info")
  },
})
