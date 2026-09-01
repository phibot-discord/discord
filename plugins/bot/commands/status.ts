import { defineCommand } from "../../../src/sdk/index.ts"

export default defineCommand({
  description: "Show loaded plugins, commands, and templates",
  async execute(ctx) {
    const meta = ctx.service<{ commands: { plugin: string; path: string }[]; templates: string[]; plugins: string[] }>("meta")
    await ctx.reply(
      [
        `plugins: ${meta.plugins.join(", ") || "(none)"}`,
        `commands: ${meta.commands.map(c => `/${c.plugin} ${c.path}`).join(", ")}`,
        `templates: ${meta.templates.join(", ") || "(none)"}`,
      ].join("\n"),
    )
  },
})
