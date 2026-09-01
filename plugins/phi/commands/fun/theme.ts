import { defineCommand } from "../../../../src/sdk/index.ts"
import { getNotes, setNotes } from "../../lib/notes.ts"
import { isBanned } from "../../lib/util.ts"

const THEMES = [
  { name: "default", value: "default" },
  { name: "snow", value: "snow" },
  { name: "star", value: "star" },
]

export default defineCommand({
  description: "Set your personal card theme (default / snow / star)",
  options: [
    {
      name: "theme",
      description: "Visual theme for rendered cards",
      type: "string",
      required: true,
      choices: THEMES,
    },
  ],
  async execute(ctx, options) {
    if (await isBanned(ctx, "setting")) return
    const theme = String(options.theme || "default")
    if (!THEMES.some(t => t.value === theme)) {
      await ctx.reply({ content: "Unknown theme.", ephemeral: true })
      return
    }
    await setNotes(ctx.db, ctx.userId, { ...(await getNotes(ctx.db, ctx.userId)), theme })
    await ctx.reply({ content: `Theme set to **${theme}**.`, ephemeral: true })
  },
})
