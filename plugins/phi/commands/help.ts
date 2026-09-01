import { defineCommand } from "../../../src/sdk/index.ts"

export default defineCommand({
  description: "How to see the command list",
  async execute(ctx) {
    await ctx.reply("Type `/phi` to see the command list.")
  },
})
