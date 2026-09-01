import { defineCommand } from "../../../../src/sdk/index.ts"
import type { PhiRuntime } from "../../lib/runtime.ts"
import { clearUser, NOT_BOUND } from "../../lib/saves.ts"
import { isBanned } from "../../lib/util.ts"

export default defineCommand({
  description: "Remove the locally stored sessionToken",
  async execute(ctx) {
    if (await isBanned(ctx, "bind")) return
    const rt = ctx.service<PhiRuntime>("phi.runtime")
    const had = await clearUser(rt, ctx.db, ctx.userId)
    await ctx.reply({
      content: had ? "Unbound this Discord account." : NOT_BOUND,
      ephemeral: true,
    })
  },
})
