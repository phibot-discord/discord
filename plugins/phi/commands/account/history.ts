import { defineCommand } from "../../../../src/sdk/index.ts"
import { STYLE_OPTION_DESC, sendCard, styleChoices } from "../../lib/send-card.ts"
import { isBanned } from "../../lib/util.ts"

export default defineCommand({
  description: "Score changes since last update and RKS history graph",
  options: [{ name: "style", description: STYLE_OPTION_DESC, type: "string", choices: styleChoices("hisb30") }],
  async execute(ctx, options) {
    if (await isBanned(ctx, "update")) return
    await sendCard(ctx, "hisb30", { style: options.style ? String(options.style) : undefined, filename: "history" })
  },
})
