import { defineCommand } from "../../../../src/sdk/index.ts"
import { bindViaQr } from "../../lib/qrbind.ts"
import { isBanned, phiRt } from "../../lib/util.ts"

export default defineCommand({
  description: "Bind Phigros by scanning a TapTap QR",
  ephemeral: true,
  options: [
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
    try {
      await bindViaQr(ctx, phiRt(ctx), options.server === "gb")
    } catch (err) {
      await ctx.reply({
        content: `QR bind failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 1800),
        ephemeral: true,
      })
    }
  },
})
