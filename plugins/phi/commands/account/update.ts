import { defineCommand } from "../../../../src/sdk/index.ts"
import type { PhiRuntime } from "../../lib/runtime.ts"
import { updateSave } from "../../lib/saves.ts"
import { sendCard } from "../../lib/send-card.ts"
import { isBanned } from "../../lib/util.ts"

export default defineCommand({
  description: "Refresh the bound Phigros save from TapTap and send the update card",
  options: [{ name: "global", description: "International server", type: "boolean" }],
  async execute(ctx, options) {
    if (await isBanned(ctx, "update")) return
    let got: { rt: PhiRuntime; save: Awaited<ReturnType<typeof updateSave>> }
    try {
      const rt = ctx.service<PhiRuntime>("phi.runtime")
      got = { rt, save: await updateSave(rt, ctx.db, ctx.userId, { global: !!options.global }) }
    } catch (err) {
      await ctx.reply({ content: String(err instanceof Error ? err.message : err), ephemeral: true })
      return
    }
    const { save } = got
    const rks = Number(save.saveInfo.summary.rankingScore).toFixed(4)
    // The history card in the user's saved layout (classic: the update card)
    await sendCard(ctx, "hisb30", {
      got,
      filename: "update",
      caption: data => {
        const head = `Updated **${save.saveInfo.PlayerId}** · RKS ${rks}`
        if (!data) return head
        const n = Number(data.show) || 0
        return `${head} · ${n ? `updated ${n} scores` : "no new scores"}`
      },
    })
  },
})
