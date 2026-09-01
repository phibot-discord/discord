import { defineCommand } from "../../../../src/sdk/index.ts"
import type { PhiRuntime } from "../../lib/runtime.ts"
import { getToken, loadSave, moneyText, NOT_BOUND } from "../../lib/saves.ts"

export default defineCommand({
  description: "Show in-game data currency from the bound save",
  async execute(ctx) {
    const rt = ctx.service<PhiRuntime>("phi.runtime")
    const token = await getToken(rt, ctx.userId)
    if (!token) {
      await ctx.reply({ content: NOT_BOUND, ephemeral: true })
      return
    }
    const save = await loadSave(rt, ctx.db, ctx.userId)
    if (!save) {
      await ctx.reply({ content: "Bound, but no save is cached yet. Run `/phi account update`.", ephemeral: true })
      return
    }
    await ctx.reply(`Data: ${moneyText(save.gameProgress?.money)}`)
  },
})
