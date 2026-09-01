import { defineCommand } from "../../../../src/sdk/index.ts"
import { kvKey } from "../../lib/const.ts"
import type { PhiRuntime } from "../../lib/runtime.ts"
import { clearUser } from "../../lib/saves.ts"
import { isBanned } from "../../lib/util.ts"

export default defineCommand({
  description: "Delete token, save, notes, and jrrp for this user",
  async execute(ctx) {
    if (await isBanned(ctx, "bind")) return
    const rt = ctx.service<PhiRuntime>("phi.runtime")
    const hadBind = await clearUser(rt, ctx.db, ctx.userId)
    const notesKey = kvKey("notes", ctx.userId)
    const jrrpKey = kvKey("jrrp", ctx.userId)
    const hadNotes = Boolean(await ctx.db.get(notesKey))
    const hadJrrp = Boolean(await ctx.db.get(jrrpKey))
    if (!hadBind && !hadNotes && !hadJrrp) {
      await ctx.reply({ content: "Nothing to clean.", ephemeral: true })
      return
    }
    await ctx.db.del(notesKey)
    await ctx.db.del(jrrpKey)
    await ctx.reply({ content: "All local records for you were deleted.", ephemeral: true })
  },
})
