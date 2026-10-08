import { defineCommand } from "../../../../src/sdk/index.ts"
import { parsePhiLocale, resolvePhiLocale } from "../../lib/card-i18n.ts"
import { knownBackground } from "../../lib/catalog.ts"
import { getNotes, setNotes, setUserLocale } from "../../lib/notes.ts"
import { SETTING_VALUES, userSettingCard } from "../../lib/user-setting.ts"
import { isBanned, phiCatalog, replyCard, resolveSong } from "../../lib/util.ts"

const FIELDS = [
  "lang",
  "theme",
  "avgkind",
  "avgcolor",
  "rankscope",
  "rankshow",
  "peerwait",
  "api",
  "analysis",
  "tags",
  "stats",
  "quality",
  "background",
] as const

/** `[n]` from the settings card, or the value itself */
function pick<T extends string>(list: readonly T[], raw: string): T | undefined {
  const v = raw.trim().toLowerCase()
  if (/^\d+$/.test(v)) return list[Number(v)]
  return list.find(x => x.toLowerCase() === v)
}

/** Same order as the settings card: [0] On, [1] Off */
function onOff(raw: string): boolean | undefined {
  const v = raw.trim().toLowerCase()
  if (["0", "on", "true", "yes"].includes(v)) return true
  if (["1", "off", "false", "no"].includes(v)) return false
  return undefined
}

export default defineCommand({
  description: "Personal card settings (language, theme, peer badges, quality, background…)",
  options: [
    { name: "field", description: "Setting name (omit to view)", type: "string", choices: FIELDS.map(f => ({ name: f, value: f })) },
    { name: "value", description: "Value or its [index] from the settings card", type: "string" },
  ],
  async execute(ctx, options) {
    if (await isBanned(ctx, "setting")) return
    const notes = await getNotes(ctx.db, ctx.userId)
    const locale = resolvePhiLocale(notes.locale, ctx.locale)
    const catalog = phiCatalog(ctx)
    const field = String(options.field || "") as (typeof FIELDS)[number] | ""
    const value = String(options.value ?? "").trim()
    if (!field) {
      const bg = knownBackground(notes.cardBackground)
      await replyCard(
        ctx,
        "phi/setting/userSetting",
        {
          ...userSettingCard(notes, locale, bg ? catalog.info(bg)?.song || bg : undefined),
          theme: notes.theme,
          background: catalog.randomIll("blur"),
          locale,
        },
        "myset",
        undefined,
        notes,
      )
      return
    }
    if (!value) {
      await ctx.reply({ content: "Pass `value` as well, or omit `field` to view.", ephemeral: true })
      return
    }
    const invalid = (allowed: string) => ctx.reply({ content: `\`${field}\` must be ${allowed}.`, ephemeral: true })
    const bool = onOff(value)
    let shown = value
    switch (field) {
      case "lang": {
        const next = parsePhiLocale(pick(["en", "zh"], value) || value)
        if (!next) return invalid("`en` or `zh`")
        await setUserLocale(ctx.db, ctx.userId, next)
        await ctx.reply({
          content: next === "zh" ? "已设为中文。网页和成绩图都会使用这个语言。" : "Language set to English. The web UI and cards will use this.",
          ephemeral: true,
        })
        return
      }
      case "theme":
        notes.theme = pick(["default", "snow", "star", "dss2"], value) || value
        shown = notes.theme
        break
      case "avgkind": {
        const kind = pick(SETTING_VALUES.avgkind, value)
        if (!kind) return invalid(SETTING_VALUES.avgkind.map(v => `\`${v}\``).join(" / "))
        notes.b30AvgKind = kind
        shown = kind
        break
      }
      case "avgcolor": {
        const color = pick(SETTING_VALUES.avgcolor, value)
        if (!color) return invalid(SETTING_VALUES.avgcolor.map(v => `\`${v}\``).join(" / "))
        notes.b30AvgColor = color
        shown = color
        break
      }
      case "rankscope": {
        const scope = pick(SETTING_VALUES.rankscope, value)
        if (!scope) return invalid(SETTING_VALUES.rankscope.map(v => `\`${v}\``).join(" / "))
        notes.rankScope = scope
        shown = scope
        break
      }
      case "rankshow": {
        const show = pick(SETTING_VALUES.rankshow, value)
        if (!show) return invalid(SETTING_VALUES.rankshow.map(v => `\`${v}\``).join(" / "))
        notes.rankBandShow = show
        shown = show
        break
      }
      case "quality": {
        const quality = pick(SETTING_VALUES.quality, value)
        if (!quality) return invalid(SETTING_VALUES.quality.map(v => `\`${v}\``).join(" / "))
        notes.cardQuality = quality
        shown = quality
        break
      }
      case "background": {
        if (["0", "random", "none", "off"].includes(value.toLowerCase())) {
          notes.cardBackground = undefined
          shown = "random"
          break
        }
        const hit = resolveSong(catalog, value)
        const id = knownBackground(hit?.id)
        if (!hit || !id) {
          await ctx.reply({ content: `No song illustration matching \`${value}\`.`, ephemeral: true })
          return
        }
        notes.cardBackground = id
        shown = hit.song.song
        break
      }
      default: {
        if (bool == null) return invalid("`0` / `on` or `1` / `off`")
        if (field === "peerwait") notes.peerWait = bool
        else if (field === "api") notes.allowApiUsage = bool
        else if (field === "analysis") notes.showB30Analysis = bool
        else if (field === "tags") notes.showTagAnalysis = bool
        else if (field === "stats") notes.showRecordStats = bool
        shown = bool ? "on" : "off"
      }
    }
    await setNotes(ctx.db, ctx.userId, notes)
    await ctx.reply({ content: `Updated **${field}** → ${shown}. Shared with the web UI.`, ephemeral: true })
  },
})
