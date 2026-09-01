import { defineCommand } from "../../../src/sdk/index.ts"
import { isPhiLocale, parsePhiLocale, resolvePhiLocale } from "../lib/card-i18n.ts"
import { getNotes, setUserLocale } from "../lib/notes.ts"
import { isBanned } from "../lib/util.ts"

export default defineCommand({
  description: "Language for the web UI and every rendered card (en / zh)",
  options: [
    {
      name: "language",
      description: "English or 中文. Omit to see the current value.",
      type: "string",
      choices: [
        { name: "English", value: "en" },
        { name: "中文", value: "zh" },
      ],
    },
  ],
  async execute(ctx, options) {
    if (await isBanned(ctx, "setting")) return
    const notes = await getNotes(ctx.db, ctx.userId)
    const current = resolvePhiLocale(notes.locale, ctx.locale)
    const raw = String(options.language || "")
    if (!raw) {
      await ctx.reply({
        content:
          current === "zh"
            ? `当前语言：**中文**。用 \`/phi language language:English\` 改成英文。网页和出图共用这个设置。`
            : `Language is **English**. Use \`/phi language language:中文\` to switch. Shared with the web UI and all cards.`,
        ephemeral: true,
      })
      return
    }
    const next = parsePhiLocale(raw)
    if (!next || !isPhiLocale(next)) {
      await ctx.reply({ content: "Language must be English or 中文.", ephemeral: true })
      return
    }
    await setUserLocale(ctx.db, ctx.userId, next)
    await ctx.reply({
      content:
        next === "zh"
          ? "已设为中文。网页和所有成绩图都会使用这个语言。"
          : "Language set to English. The web UI and every card will use this.",
      ephemeral: true,
    })
  },
})
