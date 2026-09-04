import { defineCommand } from "../../../../src/sdk/index.ts"
import type { Catalog } from "../../lib/catalog.ts"
import { parsePhiLocale, resolvePhiLocale } from "../../lib/card-i18n.ts"
import { getNotes, setNotes, setUserLocale } from "../../lib/notes.ts"
import { userSettingCard } from "../../lib/user-setting.ts"
import { isBanned, replyCard, themeOf } from "../../lib/util.ts"

const FIELDS = ["lang", "theme", "avgkind", "avgcolor", "api", "analysis", "tags"] as const

export default defineCommand({
  description: "Personal render settings (language, theme, b30 avg, API, tags)",
  options: [
    { name: "field", description: "Setting name (omit to view)", type: "string", choices: FIELDS.map(f => ({ name: f, value: f })) },
    { name: "value", description: "Value or index", type: "string" },
  ],
  async execute(ctx, options) {
    if (await isBanned(ctx, "setting")) return
    const notes = await getNotes(ctx.db, ctx.userId)
    const locale = resolvePhiLocale(notes.locale, ctx.locale)
    const field = String(options.field || "")
    const value = String(options.value || "")
    if (!field) {
      await replyCard(ctx, "phi/setting/userSetting", {
        ...userSettingCard(notes, locale),
        theme: notes.theme,
        background: ctx.service<Catalog>("phi.catalog").randomIll("blur"),
        locale,
      }, "myset")
      return
    }
    if (!value) {
      await ctx.reply({ content: "Pass `value` as well, or omit `field` to view.", ephemeral: true })
      return
    }
    if (field === "lang") {
      const map = ["en", "zh"] as const
      const next = parsePhiLocale(map[Number(value)] || value)
      if (!next) {
        await ctx.reply({ content: "Language must be `en` or `zh`.", ephemeral: true })
        return
      }
      await setUserLocale(ctx.db, ctx.userId, next)
      await ctx.reply({
        content: next === "zh" ? "已设为中文。网页和成绩图都会使用这个语言。" : "Language set to English. The web UI and cards will use this.",
        ephemeral: true,
      })
      return
    }
    if (field === "theme") {
      const map = ["default", "snow", "star", "dss2"]
      notes.theme = map[Number(value)] || value
    } else if (field === "avgkind") {
      const map = ["all", "b30", "top", "none"] as const
      notes.b30AvgKind = (map[Number(value)] || value) as typeof notes.b30AvgKind
    } else if (field === "avgcolor") {
      const map = ["red", "gold", "blue", "green"] as const
      notes.b30AvgColor = (map[Number(value)] || value) as typeof notes.b30AvgColor
    } else if (field === "api") {
      notes.allowApiUsage = value === "1" || value === "true" || value === "on"
    } else if (field === "analysis") {
      notes.showB30Analysis = value === "1" || value === "true" || value === "on"
    } else if (field === "tags") {
      notes.showTagAnalysis = value === "1" || value === "true" || value === "on"
    }
    await setNotes(ctx.db, ctx.userId, notes)
    await ctx.reply({ content: `Updated **${field}**. Theme is ${await themeOf(ctx)}.`, ephemeral: true })
  },
})
