import { defineCommand } from "../../../src/sdk/index.ts"

export default defineCommand({
  description: "Health check",
  async execute(ctx) {
    await ctx.reply("pong")
  },
})
