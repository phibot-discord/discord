import { defineCommand } from "../../../../src/sdk/index.ts"
import { isBanned, phiCatalog } from "../../lib/util.ts"

export default defineCommand({
  description: "Random Phigros tip",
  async execute(ctx) {
    if (await isBanned(ctx, "fnc")) return
    const tips = phiCatalog(ctx).tips
    if (!tips.length) {
      await ctx.reply("No tips loaded.")
      return
    }
    await ctx.reply(tips[Math.floor(Math.random() * tips.length)]!)
  },
})
