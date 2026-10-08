import { defineCommand } from "../../../../src/sdk/index.ts"
import { STYLE_OPTION_DESC, sendCard, styleChoices } from "../../lib/send-card.ts"
import { isBanned } from "../../lib/util.ts"

export default defineCommand({
  description: "1-Good B30 (x30)",
  options: [
    { name: "count", description: "How many best charts (min 33)", type: "integer" },
    { name: "style", description: STYLE_OPTION_DESC, type: "string", choices: styleChoices("x30") },
  ],
  async execute(ctx, options) {
    if (await isBanned(ctx, "b19")) return
    await sendCard(ctx, "x30", {
      count: Number(options.count) || undefined,
      style: options.style ? String(options.style) : undefined,
    })
  },
})
