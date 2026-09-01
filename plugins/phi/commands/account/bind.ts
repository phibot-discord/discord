import { defineCommand } from "../../../../src/sdk/index.ts"
import { bindViaQr } from "../../lib/qrbind.ts"
import type { PhiRuntime } from "../../lib/runtime.ts"
import { ALREADY_BOUND, getToken, updateSave } from "../../lib/saves.ts"
import { isBanned } from "../../lib/util.ts"

export default defineCommand({
  description: "Bind Phigros: TapTap QR (default) or sessionToken modal",
  options: [
    {
      name: "method",
      description: "qrcode = scan TapTap (default); token = paste sessionToken in a modal",
      type: "string",
      choices: [
        { name: "qrcode", value: "qrcode" },
        { name: "token", value: "token" },
      ],
    },
    {
      name: "server",
      description: "cn = China, gb = international",
      type: "string",
      choices: [
        { name: "cn", value: "cn" },
        { name: "gb", value: "gb" },
      ],
    },
  ],
  async execute(ctx, options) {
    if (await isBanned(ctx, "bind")) return
    const rt = ctx.service<PhiRuntime>("phi.runtime")
    if (await getToken(rt, ctx.userId)) {
      await ctx.reply({ content: ALREADY_BOUND, ephemeral: true })
      return
    }
    const global = options.server === "gb"
    const method = String(options.method || "qrcode")
    if (method !== "token") {
      try {
        await bindViaQr(ctx, rt, global)
      } catch (err) {
        await ctx.reply({
          content: `QR bind failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 1800),
          ephemeral: true,
        })
      }
      return
    }

    const values = await ctx.showModal({
      customId: "phi:account:bind",
      title: "Bind Phigros sessionToken",
      fields: [
        {
          id: "token",
          label: "sessionToken",
          style: "paragraph",
          placeholder: "25-character TapTap / cloud-save token. Never paste it in chat.",
          required: true,
          minLength: 8,
          maxLength: 400,
        },
      ],
    })
    if (!values) return
    const token = values.token?.replace(/\s/g, "") || ""
    if (!/[a-z0-9A-Z]{25}/.test(token)) {
      await ctx.reply({ content: "That does not look like a 25-character sessionToken.", ephemeral: true })
      return
    }
    await ctx.defer(true)
    try {
      const save = await updateSave(rt, ctx.db, ctx.userId, { token, global })
      const rks = save.saveInfo.summary.rankingScore
      await ctx.reply({
        content: `Bound and fetched save. Player **${save.saveInfo.PlayerId}** · RKS ${Number(rks).toFixed(4)}. Use \`/phi score b30\`.`,
        ephemeral: true,
      })
    } catch (err) {
      await ctx.reply({
        content: `Bind failed: ${err instanceof Error ? err.message : String(err)}`,
        ephemeral: true,
      })
    }
  },
})
