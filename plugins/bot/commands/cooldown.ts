import { defineCommand } from "../../../src/sdk/index.ts"

export default defineCommand({
  description: "Set a per-user command cooldown in seconds (0 = off)",
  permission: "owner",
  options: [{ name: "seconds", description: "Cooldown", type: "integer", required: true }],
  async execute(ctx, options) {
    const n = Math.max(0, Number(options.seconds) || 0)
    await ctx.db.set("bot:cooldown", String(n))
    await ctx.reply({ content: `Cooldown set to ${n}s.`, ephemeral: true })
  },
})
